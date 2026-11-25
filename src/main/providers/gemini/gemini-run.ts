import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { InteractionItem, InteractionRequest, InteractionResponse, PermissionMode, PermissionOption, ToolItem, ToolStatus, TurnItem } from '@shared/chat'
import { RENDER_SERVER, renderSpecOf } from '@shared/render'
import { isPlainObject } from '@shared/utils'
import type { AgentRun, RunInput, RunOptions, RunSink } from '../provider'
import { AcpError } from './acp-connection'
import {
  changesOf,
  commandsOf,
  contentText,
  errorText,
  GEMINI_MODES,
  mcpToolOf,
  modelsOf,
  modeUpdateOf,
  permissionChoices,
  permissionMcp,
  planPathOf,
  retryNote,
  str,
  toolNameOf,
  toolView,
  type Json,
} from './gemini-items'

/** What the run needs of its ACP connection (acp-connection.ts; a fake in tests). */
export interface AcpLike {
  request<T extends Json = Json>(method: string, params: Json): Promise<T>
  notify(method: string, params: Json): void
  respond(id: number | string, result: Json): void
  respondError(id: number | string, message: string): void
  stop(graceMs?: number): Promise<void>
  readonly alive: boolean
  readonly pid?: number
}

/** ACP's code for „Authentication required“. */
const AUTH_REQUIRED = -32000

interface Prompt {
  /** The prompt's item in the chat; null for one Nexa sends on its own (a rejected plan's wishes). */
  id: string | null
  text: string
  images?: string[]
}

interface OpenRequest {
  requestId: number | string
  item: InteractionItem
  options: ReturnType<typeof permissionChoices>
  toolCallId: string
}

interface Streaming {
  id: string
  ts: number
  text: string
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

/** Wraps Nexa's instructions for the first prompt: Gemini CLI has no way to add to its system prompt. */
export function withInstructions(instructions: string, text: string): string {
  return `<nexa-instructions>\n${instructions}\n</nexa-instructions>\n\n${text}`
}

/**
 * One conversation with Gemini CLI over ACP (`gemini --acp`), mapped onto Nexa's chat items. The
 * process serves this conversation only. Gemini CLI aborts a prompt when the next one comes, so
 * prompts sent while it works wait here and go one after another.
 */
export class GeminiRun implements AgentRun {
  sessionId = ''
  private readonly queue: Prompt[] = []
  private prompting = false
  /** Nexa's instructions went with a prompt of this process. */
  private instructionsSent = false
  /** `session/load` streams the old conversation before it answers: the chat has it already. */
  private replaying = false
  private text: Streaming | null = null
  private thought: Streaming | null = null
  private readonly tools = new Map<string, ToolItem>()
  private readonly rawCalls = new Map<string, { title?: string; kind?: unknown; locations?: unknown }>()
  /** Tool calls whose arguments were taken from the MCP server's log. */
  private readonly argsTaken = new Set<string>()
  private readonly open = new Map<string, OpenRequest>()
  private mode: PermissionMode
  private model: string | undefined
  private currentModel: string | undefined
  /** An approved plan's tool call: when it is through, Gemini CLI is in its default mode and gets Nexa's. */
  private modeAfter: string | null = null
  private closed = false

  constructor(
    private readonly conn: AcpLike,
    private readonly options: RunOptions,
    private readonly sink: RunSink,
    private readonly hooks: {
      commands?(commands: { name: string; description?: string }[]): void
      models?(models: { id: string; label: string; description?: string }[]): void
    } = {},
  ) {
    this.mode = options.permissionMode
    this.model = options.model || undefined
  }

  get alive(): boolean {
    return !this.closed && this.conn.alive
  }

  get pid(): number | undefined {
    return this.conn.pid
  }

  async connect(): Promise<void> {
    this.sink.runtime({ status: 'starting', connected: false })
    // No file system or terminal of the client: Gemini CLI reads, writes and runs on its own.
    await this.conn.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'nexa', title: 'Nexa', version: '1' },
    })
    const mcp = this.options.mcp
    const mcpServers = mcp ? [{ type: 'http', name: RENDER_SERVER, url: mcp.url, headers: [{ name: 'Authorization', value: `Bearer ${mcp.token}` }] }] : []
    const common = { cwd: this.options.cwd, mcpServers }
    // Gemini CLI can't fork a conversation: the session service starts a new one with the chat as context instead.
    const resumeId = this.options.fork ? undefined : this.options.resumeId
    let response: Json
    if (resumeId) {
      response = await this.load(resumeId, common)
      this.sessionId = resumeId
    } else {
      response = await this.conn.request('session/new', common)
      this.sessionId = str(response.sessionId) ?? ''
      if (!this.sessionId) throw new Error('Gemini CLI hat keine Unterhaltung angelegt.')
    }
    this.sink.cliSession(this.sessionId)
    const models = isPlainObject(response.models) ? response.models : {}
    this.currentModel = str(models.currentModelId)
    const list = modelsOf(models)
    if (list.length) this.hooks.models?.(list)
    if (this.model && this.model !== this.currentModel) await this.applyModel()
    const modes = isPlainObject(response.modes) ? response.modes : {}
    if (GEMINI_MODES[this.mode] !== str(modes.currentModeId)) await this.applyMode()
    this.sink.runtime({ status: 'idle', connected: true, model: this.model ?? this.currentModel })
  }

  /**
   * `session/load`. Gemini CLI resumes only with a sign-in named in its settings; one that signs in
   * with GEMINI_API_KEY alone is asked to take the key first (which writes it to its settings).
   */
  private async load(sessionId: string, common: Json): Promise<Json> {
    this.replaying = true
    try {
      return await this.conn.request('session/load', { ...common, sessionId })
    } catch (error) {
      if (!(error instanceof AcpError) || error.code !== AUTH_REQUIRED || !this.hasApiKey()) throw error
      await this.conn.request('authenticate', { methodId: 'gemini-api-key' })
      return await this.conn.request('session/load', { ...common, sessionId })
    } finally {
      this.replaying = false
    }
  }

  private hasApiKey(): boolean {
    const { set, unset } = this.options.account
    return !!set.GEMINI_API_KEY || (!!process.env.GEMINI_API_KEY && !unset.includes('GEMINI_API_KEY'))
  }

  // ------------------------------------------------------------------------------------------
  // Commands from Nexa

  async send(input: RunInput): Promise<void> {
    if (!this.sessionId || this.closed) throw new Error('Gemini CLI läuft nicht mehr.')
    this.queue.push({ id: input.id, text: input.text, images: input.images })
    // Not awaited: the turn's end comes as its item, the prompt is through once queued.
    if (!this.prompting) void this.pump()
  }

  private async pump(): Promise<void> {
    const next = this.queue.shift()
    if (!next || this.closed) return
    this.prompting = true
    if (next.id) this.sink.taken(next.id)
    const startedAt = Date.now()
    this.sink.runtime({ status: 'running', turnStartedAt: startedAt, error: undefined })
    let turn: TurnItem
    try {
      const result = await this.conn.request('session/prompt', { sessionId: this.sessionId, prompt: await this.promptOf(next) })
      turn = this.turnOf(result, startedAt)
    } catch (error) {
      turn = this.failedTurn(error, startedAt)
    }
    if (this.closed) return
    this.endStreams()
    this.cancelOpen()
    this.finishRunning(turn.status === 'interrupted')
    this.sink.item(turn)
    this.prompting = false
    if (this.queue.length) void this.pump()
    else this.sink.runtime({ status: 'idle', turnStartedAt: undefined, model: this.model ?? this.currentModel })
  }

  /**
   * The prompt's content blocks. Nexa's instructions go before the first prompt of the process; a
   * command of Gemini CLI (`/memory show`) must start the text, so they wait for the next one.
   */
  private async promptOf(prompt: Prompt): Promise<Json[]> {
    let text = prompt.text
    const command = /^[/$]/.test(text.trimStart())
    if (!this.instructionsSent && this.options.instructions && !command) {
      text = withInstructions(this.options.instructions, text)
      this.instructionsSent = true
    }
    const blocks: Json[] = [{ type: 'text', text }]
    for (const path of prompt.images ?? []) {
      const mimeType = IMAGE_TYPES[extname(path).toLowerCase()]
      const data = mimeType ? await readFile(path).catch(() => null) : null
      if (mimeType && data) blocks.push({ type: 'image', mimeType, data: data.toString('base64') })
    }
    return blocks
  }

  private turnOf(result: Json, startedAt: number): TurnItem {
    const usage = isPlainObject(result.usage) ? result.usage : {}
    const reason = str(result.stopReason)
    const notes: Record<string, string> = {
      max_tokens: 'Das Kontextfenster ist voll',
      max_turn_requests: 'Gemini CLI hat den Turn beendet (zu viele Schritte oder eine Schleife)',
      refusal: 'Gemini hat die Antwort verweigert',
    }
    if (reason && notes[reason]) this.notice('warning', notes[reason])
    return {
      kind: 'turn',
      id: `turn:${randomUUID()}`,
      ts: Date.now(),
      provider: 'gemini',
      status: reason === 'cancelled' ? 'interrupted' : 'done',
      durationMs: Date.now() - startedAt,
      inputTokens: typeof usage.inputTokens === 'number' && usage.inputTokens > 0 ? usage.inputTokens : undefined,
      outputTokens: typeof usage.outputTokens === 'number' && usage.outputTokens > 0 ? usage.outputTokens : undefined,
      model: this.model ?? this.currentModel,
    }
  }

  private failedTurn(error: unknown, startedAt: number): TurnItem {
    const message = error instanceof Error ? errorText(error.message) : String(error)
    const code = error instanceof AcpError ? error.code : null
    const text =
      code === 429
        ? `Gemini meldet zu viele Anfragen (429). Warte kurz oder nimm ein anderes Modell oder einen anderen Account. ${message}`
        : code === AUTH_REQUIRED
          ? `Gemini CLI ist nicht angemeldet: ${message}`
          : message
    return { kind: 'turn', id: `turn:${randomUUID()}`, ts: Date.now(), provider: 'gemini', status: 'error', durationMs: Date.now() - startedAt, error: text, model: this.model ?? this.currentModel }
  }

  async interrupt(): Promise<void> {
    if (!this.prompting) return
    // Open questions first: Gemini CLI waits for their answer before it sees the cancel.
    this.cancelOpen()
    this.conn.notify('session/cancel', { sessionId: this.sessionId })
  }

  async respond(itemId: string, response: InteractionResponse): Promise<void> {
    const open = this.open.get(itemId)
    if (!open) throw new Error('Die Frage ist nicht mehr offen.')
    this.open.delete(itemId)
    const { allow, session, deny } = open.options
    let optionId: string | null = null
    if (response.type === 'plan') {
      if (response.approve) {
        optionId = allow
        if (response.mode && response.mode !== 'plan') this.mode = response.mode
        // Gemini CLI goes to its default mode once the plan is through; Nexa's chosen one follows then.
        this.modeAfter = open.toolCallId
      } else {
        optionId = deny
        if (response.feedback?.trim()) this.followUp(`Überarbeite den Plan: ${response.feedback.trim()}`)
      }
    } else if (response.type === 'permission') {
      optionId = response.decision === 'allow' ? allow : response.decision === 'allow-session' ? (session ?? allow) : deny
      if (response.decision === 'deny' && response.message?.trim()) this.followUp(response.message.trim())
    }
    this.conn.respond(open.requestId, optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
    this.sink.item({ ...open.item, state: 'answered', response })
    if (!this.open.size && this.prompting) this.sink.runtime({ status: 'running' })
  }

  /** What the user said along with a „no“: Gemini CLI takes no message with its answer, so it comes next. */
  private followUp(text: string): void {
    this.queue.unshift({ id: null, text })
  }

  async setModel(model: string | undefined): Promise<void> {
    this.model = model || undefined
    if (this.sessionId && !this.closed) await this.applyModel()
    this.sink.runtime({ model: this.model ?? this.currentModel })
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.mode = mode
    if (this.sessionId && !this.closed) await this.applyMode()
  }

  private async applyModel(): Promise<void> {
    await this.conn.request('session/set_model', { sessionId: this.sessionId, modelId: this.model ?? 'auto' })
    this.currentModel = this.model ?? 'auto'
  }

  private async applyMode(): Promise<void> {
    await this.conn.request('session/set_mode', { sessionId: this.sessionId, modeId: GEMINI_MODES[this.mode] })
  }

  async stop(): Promise<void> {
    if (this.closed) return
    if (this.prompting) await this.interrupt()
    this.closed = true
    this.cancelOpen()
    await this.conn.stop(2000)
    this.sink.exited()
  }

  /** The process ended on its own (crash, killed). */
  exited(code: number | null, stderr: string): void {
    if (this.closed) return
    this.closed = true
    this.cancelOpen()
    const detail = stderr.split(/\r?\n/).filter((l) => l.trim() && !/Ripgrep is not available/.test(l)).slice(-6).join('\n')
    const error = code === 0 ? undefined : detail || `Gemini CLI wurde beendet (Code ${code ?? '?'}).`
    if (this.prompting) {
      this.endStreams()
      this.finishRunning(true)
      if (error) this.notice('error', 'Gemini CLI wurde unerwartet beendet', error)
    }
    this.prompting = false
    this.sink.exited(error)
  }

  // ------------------------------------------------------------------------------------------
  // Notifications

  notification(method: string, params: Json): void {
    if (method !== 'session/update' || !isPlainObject(params.update)) return
    if (this.sessionId && params.sessionId !== this.sessionId) return
    const update = params.update
    const kind = str(update.sessionUpdate)
    if (kind === 'available_commands_update') {
      this.hooks.commands?.(commandsOf(update.availableCommands))
      return
    }
    // The replay of a loaded conversation, and what comes between turns (mode changes): the chat has it.
    if (this.replaying || !this.prompting) return
    const content = isPlainObject(update.content) ? update.content : {}
    switch (kind) {
      case 'agent_message_chunk': {
        const text = content.type === 'text' ? (str(content.text) ?? '') : ''
        if (!text || modeUpdateOf(text)) return
        const meta = isPlainObject(update._meta) ? update._meta : {}
        return this.appendText(text, meta.reset === true)
      }
      case 'agent_thought_chunk': {
        const text = content.type === 'text' ? (str(content.text) ?? '') : ''
        if (!text) return
        const retry = retryNote(text)
        if (retry) return this.notice('warning', 'Gemini versucht es erneut', retry, 'gemini:retry')
        return this.appendThought(text)
      }
      case 'tool_call':
      case 'tool_call_update':
        this.onTool(update)
        return
      case 'usage_update':
        if (typeof update.used === 'number' && typeof update.size === 'number' && update.size > 0) {
          this.sink.runtime({ context: { used: update.used, window: update.size } })
        }
        return
      case 'plan': {
        const entries = Array.isArray(update.entries) ? update.entries.filter(isPlainObject) : []
        this.sink.item({
          kind: 'todo',
          id: 'todo:gemini',
          ts: Date.now(),
          provider: 'gemini',
          parentId: null,
          entries: entries.map((e) => ({ text: str(e.content) ?? '', status: e.status === 'completed' ? 'completed' : e.status === 'in_progress' ? 'in_progress' : 'pending' })),
        })
      }
    }
  }

  private appendText(chunk: string, reset: boolean): void {
    this.endThought()
    if (!this.text) {
      this.text = { id: `gemini:${randomUUID()}`, ts: Date.now(), text: '' }
      this.sink.item({ kind: 'assistant', id: this.text.id, ts: this.text.ts, provider: 'gemini', parentId: null, text: '', streaming: true })
    }
    if (reset) {
      // A retry after a broken stream starts the answer anew.
      this.text.text = chunk
      this.sink.item({ kind: 'assistant', id: this.text.id, ts: this.text.ts, provider: 'gemini', parentId: null, text: chunk, streaming: true })
      return
    }
    this.text.text += chunk
    this.sink.delta(this.text.id, 'text', chunk)
  }

  /** Gemini CLI sends each thought whole (`**Subject**\nText`); thoughts in a row make one item. */
  private appendThought(chunk: string): void {
    this.endText()
    if (!this.thought) {
      this.thought = { id: `gemini:${randomUUID()}`, ts: Date.now(), text: '' }
      this.sink.item({ kind: 'thinking', id: this.thought.id, ts: this.thought.ts, provider: 'gemini', parentId: null, text: '', streaming: true })
    }
    const piece = this.thought.text ? `\n\n${chunk}` : chunk
    this.thought.text += piece
    this.sink.delta(this.thought.id, 'text', piece)
  }

  private endText(): void {
    if (!this.text) return
    const { id, ts, text } = this.text
    this.text = null
    this.sink.item({ kind: 'assistant', id, ts, provider: 'gemini', parentId: null, text, streaming: false })
  }

  private endThought(): void {
    if (!this.thought) return
    const { id, ts, text } = this.thought
    this.thought = null
    this.sink.item({ kind: 'thinking', id, ts, provider: 'gemini', parentId: null, text, streaming: false })
  }

  private endStreams(): void {
    this.endText()
    this.endThought()
  }

  /** A tool call or its update: Gemini CLI names the tool only in the call's id and gives no input. */
  private onTool(update: Json, status?: ToolStatus): ToolItem | null {
    const callId = str(update.toolCallId)
    if (!callId) return null
    this.endStreams()
    const itemId = `gemini-tool:${callId}`
    const previous = this.tools.get(itemId)
    const now = Date.now()
    const native = toolNameOf(callId)
    const mcp = mcpToolOf(native)
    // Updates repeat only some fields: the call's own come from its first report.
    const raw = this.rawCalls.get(callId) ?? {}
    const seen = { title: str(update.title) ?? raw.title, kind: update.kind ?? raw.kind, locations: update.locations ?? raw.locations }
    this.rawCalls.set(callId, seen)
    const title = seen.title
    const state = status ?? toolStatusOf(update.status, update.content) ?? previous?.status ?? 'running'
    const done = state === 'done' || state === 'error' || state === 'denied'
    const changes = changesOf(update.content)
    const text = contentText(update.content)
    let fields: Partial<ToolItem>
    if (mcp) {
      let input = previous?.input
      // Its arguments reached Nexa's server while it ran: they are there once it is through.
      if (mcp.server === RENDER_SERVER && done && !this.argsTaken.has(callId)) {
        this.argsTaken.add(callId)
        input = this.options.mcp?.calls?.take(mcp.tool) ?? input
      }
      const render = mcp.server === RENDER_SERVER && input ? renderSpecOf(mcp.server, mcp.tool, input) : undefined
      fields = {
        tool: render ? 'render' : 'mcp',
        name: `${mcp.server}.${mcp.tool}`,
        title: render ? (render.type === 'diagram' ? 'Diagramm' : 'Darstellung') : mcp.tool.replace(/_/g, ' '),
        // Gemini CLI's title of an MCP call lists its arguments, cut short: only for servers Nexa knows no more of.
        detail: mcp.server === RENDER_SERVER ? undefined : title,
        server: mcp.server,
        input,
        render,
      }
    } else {
      fields = { ...toolView(native, seen.kind, title, seen.locations), name: native }
    }
    const next: ToolItem = {
      kind: 'tool',
      id: itemId,
      ts: previous?.ts ?? now,
      provider: 'gemini',
      parentId: null,
      ...previous,
      ...fields,
      status: state,
      changes: changes.length ? changes : previous?.changes,
      output: done && text ? text : previous?.output,
      startedAt: previous?.startedAt ?? now,
      endedAt: done ? (previous?.endedAt ?? now) : undefined,
    } as ToolItem
    this.tools.set(itemId, next)
    this.sink.item(next)
    if (done && this.modeAfter === callId) {
      this.modeAfter = null
      void this.applyMode().catch(() => undefined)
    }
    return next
  }

  private finishRunning(interrupted: boolean): void {
    const now = Date.now()
    for (const [id, tool] of this.tools) {
      if (tool.status !== 'running' && tool.status !== 'pending') continue
      const next: ToolItem = { ...tool, status: interrupted ? 'denied' : 'done', endedAt: now }
      this.tools.set(id, next)
      this.sink.item(next)
    }
  }

  private cancelOpen(): void {
    for (const [, open] of this.open) {
      this.conn.respond(open.requestId, { outcome: { outcome: 'cancelled' } })
      this.sink.item({ ...open.item, state: 'cancelled' })
    }
    this.open.clear()
  }

  private notice(level: 'info' | 'warning' | 'error', text: string, detail?: string, id: string = randomUUID()): void {
    this.sink.item({ kind: 'notice', id, ts: Date.now(), provider: 'gemini', parentId: null, level, text, detail })
  }

  // ------------------------------------------------------------------------------------------
  // Requests of the agent

  request(id: number | string, method: string, params: Json): void {
    if (method !== 'session/request_permission' || !isPlainObject(params.toolCall)) {
      this.conn.respondError(id, 'Wird von Nexa nicht unterstützt.')
      return
    }
    void this.onPermission(id, params, params.toolCall)
  }

  private async onPermission(requestId: number | string, params: Json, toolCall: Json): Promise<void> {
    const callId = str(toolCall.toolCallId) ?? randomUUID()
    const tool = this.onTool({ ...toolCall, toolCallId: callId }, 'pending')
    const options = permissionChoices(params.options)
    const mcp = permissionMcp(toolCall)
    // Nexa's own tools that need no asking (mcp/tool-grant.ts): Gemini CLI asks for every MCP tool.
    if (mcp?.server === RENDER_SERVER && options.allow && this.options.mcp?.allowed.includes(mcp.tool)) {
      this.conn.respond(requestId, { outcome: { outcome: 'selected', optionId: options.allow } })
      return
    }
    const name = toolNameOf(callId)
    const title = str(toolCall.title)
    let request: InteractionRequest
    const planPath = name === 'exit_plan_mode' ? planPathOf(title) : null
    if (name === 'exit_plan_mode') {
      const plan = planPath ? await readFile(planPath, 'utf8').catch(() => null) : null
      request = { type: 'plan', plan: plan?.trim() || title || 'Gemini möchte den Plan-Modus verlassen.' }
    } else {
      const choices: PermissionOption[] = [{ id: 'allow', label: 'Erlauben' }]
      if (options.session) choices.push({ id: 'allow-session', label: 'Für diese Session erlauben' })
      choices.push({ id: 'deny', label: 'Ablehnen' })
      request = {
        type: 'permission',
        toolName: tool?.name ?? name,
        title: tool?.title ?? name,
        detail: tool?.server ? title : tool?.detail,
        description: contentText(toolCall.content),
        changes: tool?.changes,
        options: choices,
      }
    }
    if (this.closed) return
    const item: InteractionItem = {
      kind: 'interaction',
      id: `interaction:${randomUUID()}`,
      ts: Date.now(),
      provider: 'gemini',
      parentId: null,
      request,
      state: 'pending',
      toolItemId: tool?.id,
    }
    this.open.set(item.id, { requestId, item, options, toolCallId: callId })
    this.sink.item(item)
    this.sink.runtime({ status: 'waiting' })
  }
}

function toolStatusOf(status: unknown, content: unknown): ToolStatus | null {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'in_progress':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return /was canceled by the user/i.test(contentText(content) ?? '') ? 'denied' : 'error'
    default:
      return null
  }
}
