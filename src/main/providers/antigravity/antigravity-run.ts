import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { InteractionItem, InteractionRequest, InteractionResponse, PermissionMode, PermissionOption, ToolItem, ToolStatus, TurnItem } from '@shared/chat'
import type { ModelOption } from '@shared/types'
import { RENDER_SERVER, renderSpecOf } from '@shared/render'
import { isPlainObject } from '@shared/utils'
import { AcpError, errorText } from '../acp/acp-connection'
import type { AgentRun, McpServerState, RunInput, RunOptions, RunSink } from '../provider'
import { antigravityMcpServers } from './antigravity-config'
import {
  ANTIGRAVITY_MODES,
  appendsSystemPrompt,
  changesOf,
  commandOutput,
  commandsOf,
  configOf,
  contentText,
  EXECUTOR_ERROR,
  isQuotaError,
  mcpToolOf,
  modelsOf,
  permissionChoices,
  planOf,
  resumesSession,
  stepsOf,
  str,
  tierOf,
  toolView,
  type Json,
} from './antigravity-items'
import { withAgyMcpStates, type AgyLocalServer } from './antigravity-server'

/** What the run needs of its ACP connection (acp/acp-connection.ts; a fake in tests). */
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

/** How long a title may take after the first prompt: Antigravity names the conversation early in its turn. */
const TITLE_WAIT_MS = 60_000

interface Prompt {
  /** The prompt's item in the chat; null for one Nexa sends on its own (a plan's answer). */
  id: string | null
  text: string
  images?: string[]
}

interface OpenRequest {
  /** The agent's request; none for a plan, which Antigravity asks for in its answer. */
  requestId: number | string | null
  item: InteractionItem
  options: ReturnType<typeof permissionChoices>
}

interface Streaming {
  id: string
  ts: number
  text: string
}

/** The updates that belong to a turn: the agent's answer, thoughts, tools and todo list. */
const TURN_UPDATES = new Set(['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'])

const IMAGE_TYPES: Record<string, string> ={ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

/** Nexa's instructions before the first prompt, for a version that can't add to its system prompt. */
export function withInstructions(instructions: string, text: string): string {
  return `<nexa-instructions>\n${instructions}\n</nexa-instructions>\n\n${text}`
}

/**
 * One conversation with Antigravity CLI over ACP (`agy acp`), mapped onto Nexa's chat items. The
 * process serves this conversation only; prompts sent while it works wait here and go one after
 * another.
 */
export class AntigravityRun implements AgentRun {
  sessionId = ''
  /** The plan of the login, as `session/new` named it. */
  tier: string | undefined
  private readonly queue: Prompt[] = []
  private prompting = false
  /** The instructions go into the system prompt; a version without that gets them with the first prompt. */
  private instructionsPending = false
  /** `session/load` streams the old conversation before it answers: the chat has it already. */
  private replaying = false
  /** Reading a conversation (`replay`): its stream becomes items, a turn per prompt. */
  private collecting = false
  /** The prompt the stream of a read conversation is at, while its chunks come. */
  private replayedPrompt: { id: string; ts: number; text: string } | null = null
  /** A turn of a read conversation has begun and gets its end. */
  private replayedTurn = false
  private text: Streaming | null = null
  private thought: Streaming | null = null
  /** An error of the agent that came as text of its answer: the turn ends with it. */
  private executorError: string | null = null
  /** A plan Antigravity wrote in this turn and asks feedback for. */
  private plan: string | null = null
  private readonly tools = new Map<string, ToolItem>()
  private readonly rawCalls = new Map<string, { name?: string; args?: Json; title?: string; kind?: unknown; locations?: unknown }>()
  private readonly argsTaken = new Set<string>()
  private readonly open = new Map<string, OpenRequest>()
  private mode: PermissionMode
  private model: string | undefined
  private effort: string | undefined
  private currentModel: string | undefined
  private currentEffort: string | undefined
  private closed = false
  /** The conversation's name from `session_info_update` since the current turn began. */
  private named: string | null = null
  private readonly titleWaiters = new Set<(title: string | null) => void>()

  constructor(
    private readonly conn: AcpLike,
    private readonly options: RunOptions,
    private readonly sink: RunSink,
    private readonly hooks: {
      commands?(commands: { name: string; description?: string }[]): void
      models?(models: ModelOption[]): void
      /** A turn ended (not by the user's cancel); `limit`: at the quota of the login. */
      turnEnded?(limit: boolean): void
      /** The process's local server (antigravity-server.ts), for how its MCP servers are. */
      server?: AgyLocalServer
    } = {},
  ) {
    this.mode = options.permissionMode
    this.model = options.model || undefined
    this.effort = options.effort || undefined
  }

  get alive(): boolean {
    return !this.closed && this.conn.alive
  }

  get pid(): number | undefined {
    return this.conn.pid
  }

  async connect(): Promise<void> {
    this.sink.runtime({ status: 'starting', connected: false })
    // No file system or terminal of the client: Antigravity reads, writes and runs on its own.
    const init = await this.conn.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'nexa', title: 'Nexa', version: '1' },
    })
    const capabilities = init.agentCapabilities
    const instructions = this.options.instructions
    const append = !!instructions && appendsSystemPrompt(capabilities)
    this.instructionsPending = !!instructions && !append
    const mcp = this.options.mcp
    const mcpServers = mcp ? [{ type: 'http', name: RENDER_SERVER, url: mcp.url, headers: [{ name: 'Authorization', value: `Bearer ${mcp.token}` }] }] : []
    const common: Json = {
      cwd: this.options.cwd,
      mcpServers,
      ...(append ? { _meta: { antigravity: { systemPrompt: { append: instructions } } } } : {}),
    }
    // ACP can't fork a conversation: the session service copies it under a new id before the start
    // (antigravity-conversations.ts), so a fork never comes here; were one to, it starts anew.
    const resumeId = this.options.fork ? undefined : this.options.resumeId
    let response: Json
    if (resumeId) {
      response = await this.resume(resumeId, common, resumesSession(capabilities))
      this.sessionId = resumeId
    } else {
      response = await this.conn.request('session/new', common)
      this.sessionId = str(response.sessionId) ?? ''
      if (!this.sessionId) throw new Error('Antigravity CLI hat keine Unterhaltung angelegt.')
    }
    this.sink.cliSession(this.sessionId)
    this.tier = tierOf(response._meta) ?? this.tier
    this.takeConfig(response.configOptions, response.models)
    await this.applyModel()
    const modes = isPlainObject(response.modes) ? response.modes : {}
    if (ANTIGRAVITY_MODES[this.mode] !== str(modes.currentModeId)) await this.applyMode()
    this.sink.runtime({ status: 'idle', connected: true, model: this.model ?? this.currentModel })
  }

  /** `session/resume` streams nothing again; an agent without it replays the conversation with `session/load`. */
  private async resume(sessionId: string, common: Json, resume: boolean): Promise<Json> {
    if (resume) return this.conn.request('session/resume', { ...common, sessionId })
    this.replaying = true
    try {
      return await this.conn.request('session/load', { ...common, sessionId })
    } finally {
      this.replaying = false
    }
  }

  /**
   * Reads a conversation instead of going on with it (antigravity-provider.ts, `history`): `session/load`
   * streams it again, prompts included, and the stream becomes the chat's items as a turn's would. The
   * connection must be initialized; the stream carries no times, the caller stamps them.
   */
  async replay(sessionId: string): Promise<void> {
    this.sessionId = sessionId
    this.collecting = true
    try {
      await this.conn.request('session/load', { sessionId, cwd: this.options.cwd, mcpServers: [] })
    } finally {
      this.endReplayedTurn()
      this.collecting = false
    }
  }

  /** A prompt of the read conversation: one in chunks, the turn before it ends. */
  private replayedUser(content: Json): void {
    const text = content.type === 'text' ? (str(content.text) ?? '') : ''
    if (this.replayedPrompt) this.replayedPrompt.text += text
    else {
      this.endReplayedTurn()
      this.replayedPrompt = { id: `antigravity-user:${randomUUID()}`, ts: Date.now(), text }
      this.replayedTurn = true
    }
    const { id, ts, text: whole } = this.replayedPrompt
    this.sink.item({ kind: 'user', id, ts, provider: 'antigravity', text: whole })
  }

  private endReplayedTurn(): void {
    this.replayedPrompt = null
    if (!this.replayedTurn) return
    this.replayedTurn = false
    this.endStreams()
    this.finishRunning(false)
    const error = this.executorError
    this.executorError = null
    this.sink.item({
      kind: 'turn',
      id: `turn:${randomUUID()}`,
      ts: Date.now(),
      provider: 'antigravity',
      ...(error !== null ? { status: 'error' as const, error: error || 'Antigravity meldet einen Fehler.' } : { status: 'done' as const }),
    })
  }

  /** The session's model and level of thought; its models for the composer. */
  private takeConfig(configOptions: unknown, models: unknown): void {
    if (!Array.isArray(configOptions)) return
    this.currentModel = configOf(configOptions, 'model').value ?? this.currentModel
    this.currentEffort = configOf(configOptions, 'thought_level').value ?? this.currentEffort
    const list = modelsOf(configOptions, models)
    if (list.length && models !== undefined) this.hooks.models?.(list)
  }

  // ------------------------------------------------------------------------------------------
  // Commands from Nexa

  async send(input: RunInput): Promise<void> {
    if (!this.sessionId || this.closed) throw new Error('Antigravity CLI läuft nicht mehr.')
    this.queue.push({ id: input.id, text: input.text, images: input.images })
    // Not awaited: the turn's end comes as its item, the prompt is through once queued.
    if (!this.prompting) void this.pump()
  }

  private async pump(): Promise<void> {
    const next = this.queue.shift()
    if (!next || this.closed) return
    this.prompting = true
    // A plan nobody answered: the next prompt is the answer.
    this.cancelOpen()
    if (next.id) this.sink.taken(next.id)
    const startedAt = Date.now()
    this.executorError = null
    this.plan = null
    // A name from before (a resumed conversation's) isn't the one the first prompt gives.
    this.named = null
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
    if (turn.status !== 'interrupted') this.hooks.turnEnded?.(!!turn.limit)
    if (this.queue.length) return void this.pump()
    const plan = turn.status === 'done' ? this.plan : null
    this.plan = null
    if (plan) this.askPlan(plan)
    else this.sink.runtime({ status: 'idle', turnStartedAt: undefined, model: this.model ?? this.currentModel })
  }

  /** The prompt's content blocks; a command (`/goal`) must start the text, so instructions wait for the next one. */
  private async promptOf(prompt: Prompt): Promise<Json[]> {
    let text = prompt.text
    if (this.instructionsPending && !/^[/$]/.test(text.trimStart())) {
      text = withInstructions(this.options.instructions, text)
      this.instructionsPending = false
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
      max_turn_requests: 'Antigravity hat den Turn beendet (zu viele Schritte)',
      refusal: 'Antigravity hat die Antwort verweigert',
    }
    if (reason && notes[reason]) this.notice('warning', notes[reason])
    const base = { kind: 'turn' as const, id: `turn:${randomUUID()}`, ts: Date.now(), provider: 'antigravity' as const, durationMs: Date.now() - startedAt, model: this.model ?? this.currentModel }
    // Antigravity ends a turn whose request failed as a normal one, the error as its text.
    if (this.executorError !== null && reason !== 'cancelled') {
      const error = this.executorError || 'Antigravity meldet einen Fehler.'
      return { ...base, status: 'error', error, ...(isQuotaError(error) ? { limit: true } : {}) }
    }
    return {
      ...base,
      status: reason === 'cancelled' ? 'interrupted' : 'done',
      inputTokens: typeof usage.inputTokens === 'number' && usage.inputTokens > 0 ? usage.inputTokens : undefined,
      outputTokens: typeof usage.outputTokens === 'number' && usage.outputTokens > 0 ? usage.outputTokens : undefined,
    }
  }

  private failedTurn(error: unknown, startedAt: number): TurnItem {
    const message = error instanceof Error ? errorText(error.message) : String(error)
    const code = error instanceof AcpError ? error.code : null
    const text =
      code === 429
        ? `Antigravity meldet zu viele Anfragen (429). Warte kurz oder nimm ein anderes Modell oder einen anderen Account. ${message}`
        : code === AUTH_REQUIRED
          ? `Antigravity CLI ist nicht angemeldet. Melde den Account unter Einstellungen → Accounts an. ${message}`
          : message
    return {
      kind: 'turn',
      id: `turn:${randomUUID()}`,
      ts: Date.now(),
      provider: 'antigravity',
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: text,
      model: this.model ?? this.currentModel,
      ...(isQuotaError(message) ? { limit: true } : {}),
    }
  }

  /**
   * The name Antigravity gives the conversation by its first prompt (`session_info_update`), which it
   * keeps as the conversation's title too; null when none comes in time or the run ends.
   */
  title(): Promise<string | null> {
    if (this.named) return Promise.resolve(this.named)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      const done = (title: string | null) => {
        clearTimeout(timer)
        this.titleWaiters.delete(done)
        resolve(title)
      }
      const timer = setTimeout(() => done(null), TITLE_WAIT_MS)
      this.titleWaiters.add(done)
    })
  }

  /** A name from Antigravity, or null when none will come (the run ended): to whoever waits for it. */
  private takeTitle(title: string | null): void {
    if (title) this.named = title
    for (const waiter of [...this.titleWaiters]) waiter(title)
  }

  async interrupt(): Promise<void> {
    if (!this.prompting) {
      this.cancelOpen()
      return
    }
    // Open questions first: the agent waits for their answer before it sees the cancel.
    this.cancelOpen()
    this.conn.notify('session/cancel', { sessionId: this.sessionId })
  }

  async respond(itemId: string, response: InteractionResponse): Promise<void> {
    const open = this.open.get(itemId)
    if (!open) throw new Error('Die Frage ist nicht mehr offen.')
    this.open.delete(itemId)
    this.sink.item({ ...open.item, state: 'answered', response })
    if (open.requestId === null) return this.answerPlan(response)
    const { allow, session, deny } = open.options
    let optionId: string | null = null
    if (response.type === 'permission') {
      optionId = response.decision === 'allow' ? allow : response.decision === 'allow-session' ? (session ?? allow) : deny
      if (response.decision === 'deny' && response.message?.trim()) this.queue.unshift({ id: null, text: response.message.trim() })
    }
    this.conn.respond(open.requestId, optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } })
    if (!this.open.size && this.prompting) this.sink.runtime({ status: 'running' })
  }

  /**
   * The answer to a plan, as the next prompt: Antigravity asks for it in its answer and waits for the
   * user's. An approved plan is carried out in the mode the user picked (else Nexa's before the plan).
   */
  private async answerPlan(response: InteractionResponse): Promise<void> {
    if (response.type !== 'plan') return
    if (response.approve) {
      this.mode = response.mode && response.mode !== 'plan' ? response.mode : this.mode === 'plan' ? 'edits' : this.mode
      await this.applyMode().catch(() => undefined)
      this.queue.push({ id: null, text: 'Der Plan ist freigegeben. Setze ihn jetzt um.' })
    } else if (response.feedback?.trim()) {
      this.queue.push({ id: null, text: `Überarbeite den Plan: ${response.feedback.trim()}` })
    }
    if (this.queue.length && !this.prompting) void this.pump()
    else if (!this.prompting) this.sink.runtime({ status: 'idle', turnStartedAt: undefined })
  }

  async setModel(model: string | undefined, effort?: string): Promise<void> {
    this.model = model || undefined
    this.effort = effort || undefined
    if (this.sessionId && !this.closed) await this.applyModel()
    this.sink.runtime({ model: this.model ?? this.currentModel })
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.mode = mode
    if (this.sessionId && !this.closed) await this.applyMode()
  }

  /** Model and level of thought go as the session's config options; a level the model hasn't stays its own. */
  private async applyModel(): Promise<void> {
    if (this.model && this.model !== this.currentModel) {
      const result = await this.conn.request('session/set_config_option', { sessionId: this.sessionId, configId: 'model', value: this.model })
      this.takeConfig(result.configOptions, undefined)
      this.currentModel = this.model
    }
    if (this.effort && this.effort !== this.currentEffort) {
      const result = await this.conn
        .request('session/set_config_option', { sessionId: this.sessionId, configId: 'thought_level', value: this.effort })
        .catch(() => null)
      if (result) {
        this.takeConfig(result.configOptions, undefined)
        this.currentEffort = this.effort
      }
    }
  }

  private async applyMode(): Promise<void> {
    await this.conn.request('session/set_mode', { sessionId: this.sessionId, modeId: ANTIGRAVITY_MODES[this.mode] })
  }

  /** The servers of the files with how the process's local server says they are; without it, the files alone. */
  async mcpServers(): Promise<McpServerState[]> {
    const list = await antigravityMcpServers(this.options.account, this.options.cwd)
    const states = this.alive && this.hooks.server ? await this.hooks.server.call('GetMcpServerStates').catch(() => null) : null
    return states ? withAgyMcpStates(list, states) : list
  }

  /** Starts one server anew (`RefreshMcpServers`), e.g. after it failed. */
  async reconnectMcp(name: string): Promise<void> {
    if (!this.alive) throw new Error('Antigravity CLI läuft nicht mehr.')
    if (!this.hooks.server) throw new Error('Antigravity CLI verbindet Server erst mit dem nächsten Start neu.')
    await this.hooks.server.call('RefreshMcpServers', { serverName: name })
  }

  async stop(): Promise<void> {
    if (this.closed) return
    if (this.prompting) await this.interrupt()
    this.closed = true
    this.cancelOpen()
    this.takeTitle(null)
    await this.conn.stop(2000)
    this.sink.exited()
  }

  /** The process ended on its own (crash, killed). */
  exited(code: number | null, stderr: string): void {
    if (this.closed) return
    this.closed = true
    this.cancelOpen()
    this.takeTitle(null)
    const detail = stderr
      .split(/\r?\n/)
      .filter((l) => l.trim())
      .slice(-6)
      .join('\n')
    const error = code === 0 ? undefined : detail || `Antigravity CLI wurde beendet (Code ${code ?? '?'}).`
    if (this.prompting) {
      this.endStreams()
      this.finishRunning(true)
      if (error) this.notice('error', 'Antigravity CLI wurde unerwartet beendet', error)
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
    if (kind === 'config_option_update') {
      this.takeConfig(update.configOptions, undefined)
      return
    }
    if (kind === 'usage_update') {
      if (typeof update.used === 'number' && typeof update.size === 'number' && update.size > 0) {
        this.sink.runtime({ context: { used: update.used, window: update.size } })
      }
      return
    }
    if (kind === 'session_info_update') {
      // The replay of a loaded or read conversation names it as it was; that isn't a new name.
      const title = this.replaying || this.collecting ? undefined : str(update.title)?.trim()
      if (title) this.takeTitle(title)
      return
    }
    const content = isPlainObject(update.content) ? update.content : {}
    if (this.collecting) {
      if (kind === 'user_message_chunk') return this.replayedUser(content)
      // Mode changes and titles between turns are no turn's.
      if (!kind || !TURN_UPDATES.has(kind)) return
      this.replayedPrompt = null
      this.replayedTurn = true
    }
    // The replay of a loaded conversation, and what comes between turns (mode changes): the chat has it.
    else if (this.replaying || !this.prompting) return
    switch (kind) {
      case 'agent_message_chunk': {
        const text = content.type === 'text' ? (str(content.text) ?? '') : ''
        if (text) this.appendText(text)
        return
      }
      case 'agent_thought_chunk': {
        // Antigravity sends each thought whole, with blank lines after it.
        const text = content.type === 'text' ? (str(content.text) ?? '').replace(/\s+$/, '') : ''
        if (text) this.appendThought(text)
        return
      }
      case 'tool_call':
      case 'tool_call_update':
        this.onTool(update)
        return
      case 'plan': {
        const entries = Array.isArray(update.entries) ? update.entries.filter(isPlainObject) : []
        this.todo(entries.map((e) => ({ text: str(e.content) ?? '', status: e.status === 'completed' ? 'completed' : e.status === 'in_progress' ? 'in_progress' : 'pending' })))
      }
    }
  }

  private todo(entries: { text: string; status: 'pending' | 'in_progress' | 'completed' }[]): void {
    this.sink.item({ kind: 'todo', id: 'todo:antigravity', ts: Date.now(), provider: 'antigravity', parentId: null, entries })
  }

  /** Text of the answer; an error of the agent in it ends the turn as an error instead. */
  private appendText(chunk: string): void {
    if (this.executorError !== null) {
      this.executorError += chunk
      return
    }
    const at = chunk.indexOf(EXECUTOR_ERROR)
    if (at >= 0) {
      this.executorError = chunk.slice(at + EXECUTOR_ERROR.length).trim()
      chunk = chunk.slice(0, at)
      if (!chunk.trim()) return
    }
    this.endThought()
    if (!this.text) {
      this.text = { id: `antigravity:${randomUUID()}`, ts: Date.now(), text: '' }
      this.sink.item({ kind: 'assistant', id: this.text.id, ts: this.text.ts, provider: 'antigravity', parentId: null, text: '', streaming: true })
    }
    this.text.text += chunk
    this.sink.delta(this.text.id, 'text', chunk)
  }

  /** Thoughts in a row make one item. */
  private appendThought(chunk: string): void {
    this.endText()
    if (!this.thought) {
      this.thought = { id: `antigravity:${randomUUID()}`, ts: Date.now(), text: '' }
      this.sink.item({ kind: 'thinking', id: this.thought.id, ts: this.thought.ts, provider: 'antigravity', parentId: null, text: '', streaming: true })
    }
    const piece = this.thought.text ? `\n\n${chunk}` : chunk
    this.thought.text += piece
    this.sink.delta(this.thought.id, 'text', piece)
  }

  private endText(): void {
    if (!this.text) return
    const { id, ts, text } = this.text
    this.text = null
    this.sink.item({ kind: 'assistant', id, ts, provider: 'antigravity', parentId: null, text, streaming: false })
  }

  private endThought(): void {
    if (!this.thought) return
    const { id, ts, text } = this.thought
    this.thought = null
    this.sink.item({ kind: 'thinking', id, ts, provider: 'antigravity', parentId: null, text, streaming: false })
  }

  private endStreams(): void {
    this.endText()
    this.endThought()
  }

  /** A tool call or its update; updates repeat name and arguments, a permission's call is the same. */
  private onTool(update: Json, status?: ToolStatus): ToolItem | null {
    const callId = str(update.toolCallId)
    if (!callId) return null
    this.endStreams()
    const itemId = `antigravity-tool:${callId}`
    const previous = this.tools.get(itemId)
    const now = Date.now()
    const raw = this.rawCalls.get(callId) ?? {}
    const args = isPlainObject(update.args) ? update.args : isPlainObject(update.rawInput) ? update.rawInput : raw.args
    const seen = { name: str(update.name) ?? raw.name, args, title: str(update.title) ?? raw.title, kind: update.kind ?? raw.kind, locations: raw.locations ?? update.locations }
    this.rawCalls.set(callId, seen)
    const name = seen.name ?? str(seen.kind) ?? 'tool'
    const input = seen.args ?? {}
    const state = status ?? toolStatusOf(update.status) ?? previous?.status ?? 'running'
    const done = state === 'done' || state === 'error' || state === 'denied'
    const steps = name === 'update_steps' ? stepsOf(input) : null
    if (steps) {
      // The list itself is the call's row.
      this.todo(steps)
      return null
    }
    if (done && state === 'done') this.plan = planOf(name, input) ?? this.plan
    const changes = changesOf(update.content)
    const text = contentText(update.content)
    const mcp = mcpToolOf(name)
    let fields: Partial<ToolItem>
    if (mcp) {
      let mcpInput: unknown = seen.args
      // Calls to Nexa's server are logged there too; the log is drained so it doesn't fill up.
      if (mcp.server === RENDER_SERVER && done && !this.argsTaken.has(callId)) {
        this.argsTaken.add(callId)
        const logged = this.options.mcp?.calls?.take(mcp.tool)
        mcpInput = seen.args && Object.keys(seen.args).length ? seen.args : (logged ?? mcpInput)
      }
      const render = mcp.server === RENDER_SERVER && isPlainObject(mcpInput) ? renderSpecOf(mcp.server, mcp.tool, mcpInput) : undefined
      fields = {
        tool: render ? 'render' : 'mcp',
        name: `${mcp.server}.${mcp.tool}`,
        title: render ? (render.type === 'diagram' ? 'Diagramm' : 'Darstellung') : mcp.tool.replace(/_/g, ' '),
        server: mcp.server,
        input: mcpInput,
        render,
      }
    } else {
      fields = { ...toolView(name, input, seen.kind, seen.title, seen.locations), name, input }
    }
    let output = done && text ? text : previous?.output
    let exitCode = previous?.exitCode
    if (fields.tool === 'bash' && done && text) {
      const result = commandOutput(text)
      output = result.output
      exitCode = result.exitCode ?? exitCode
    }
    const next: ToolItem = {
      kind: 'tool',
      id: itemId,
      ts: previous?.ts ?? now,
      provider: 'antigravity',
      parentId: null,
      ...previous,
      ...fields,
      status: state,
      changes: changes.length ? changes : previous?.changes,
      output,
      exitCode,
      startedAt: previous?.startedAt ?? now,
      endedAt: done ? (previous?.endedAt ?? now) : undefined,
    } as ToolItem
    this.tools.set(itemId, next)
    this.sink.item(next)
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
      if (open.requestId !== null) this.conn.respond(open.requestId, { outcome: { outcome: 'cancelled' } })
      this.sink.item({ ...open.item, state: 'cancelled' })
    }
    this.open.clear()
  }

  private notice(level: 'info' | 'warning' | 'error', text: string, detail?: string, id: string = randomUUID()): void {
    this.sink.item({ kind: 'notice', id, ts: Date.now(), provider: 'antigravity', parentId: null, level, text, detail })
  }

  private interaction(request: InteractionRequest, requestId: number | string | null, options: OpenRequest['options'], toolItemId?: string): void {
    const item: InteractionItem = {
      kind: 'interaction',
      id: `interaction:${randomUUID()}`,
      ts: Date.now(),
      provider: 'antigravity',
      parentId: null,
      request,
      state: 'pending',
      toolItemId,
    }
    this.open.set(item.id, { requestId, item, options })
    this.sink.item(item)
    this.sink.runtime({ status: 'waiting' })
  }

  /** The plan of the turn, to approve or revise: as Claude Code's, though Antigravity asks in words. */
  private askPlan(plan: string): void {
    this.interaction({ type: 'plan', plan: plan.trim() }, null, { allow: null, session: null, deny: null })
  }

  // ------------------------------------------------------------------------------------------
  // Requests of the agent

  request(id: number | string, method: string, params: Json): void {
    if (method !== 'session/request_permission' || !isPlainObject(params.toolCall)) {
      this.conn.respondError(id, 'Wird von Nexa nicht unterstützt.')
      return
    }
    this.onPermission(id, params, params.toolCall)
  }

  private onPermission(requestId: number | string, params: Json, toolCall: Json): void {
    const callId = str(toolCall.toolCallId) ?? randomUUID()
    const tool = this.onTool({ ...toolCall, toolCallId: callId }, 'pending')
    const options = permissionChoices(params.options)
    const mcp = mcpToolOf(str(toolCall.name) ?? '')
    // „Volle Rechte“ until the process runs with `--dangerously-skip-permissions`, and Nexa's own tools that need no asking.
    const free = this.mode === 'full' || (mcp?.server === RENDER_SERVER && !!this.options.mcp?.allowed.includes(mcp.tool))
    if (free && options.allow) {
      this.conn.respond(requestId, { outcome: { outcome: 'selected', optionId: options.allow } })
      return
    }
    if (this.closed) return
    const name = str(toolCall.name) ?? 'tool'
    const choices: PermissionOption[] = [{ id: 'allow', label: 'Erlauben' }]
    if (options.session) choices.push({ id: 'allow-session', label: 'Für diese Session erlauben' })
    choices.push({ id: 'deny', label: 'Ablehnen' })
    this.interaction(
      {
        type: 'permission',
        toolName: tool?.name ?? name,
        title: tool?.title ?? name,
        detail: tool?.detail,
        description: contentText(toolCall.content),
        changes: tool?.changes,
        options: choices,
      },
      requestId,
      options,
      tool?.id,
    )
  }
}

function toolStatusOf(status: unknown): ToolStatus | null {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'in_progress':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return 'error'
    default:
      return null
  }
}
