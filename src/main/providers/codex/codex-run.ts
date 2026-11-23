import { randomUUID } from 'node:crypto'
import type {
  AgentItem,
  AgentStatus,
  FileChange,
  InteractionItem,
  InteractionRequest,
  InteractionResponse,
  PermissionMode,
  PermissionOption,
  ToolItem,
  ToolStatus,
} from '@shared/chat'
import { renderSpecOf } from '@shared/render'
import type { SendInput } from '@shared/types'
import { firstLine, isPlainObject } from '@shared/utils'
import { codexToolApprovals } from '../../mcp/tool-grant'
import type { AgentRun, RunOptions, RunSink } from '../provider'
import type { CodexClient, CodexServerRequest } from './codex-client'

type Json = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export const CODEX_POLICY: Record<PermissionMode, { approvalPolicy: string; sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' }> = {
  ask: { approvalPolicy: 'untrusted', sandbox: 'workspace-write' },
  edits: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  plan: { approvalPolicy: 'untrusted', sandbox: 'read-only' },
  auto: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  full: { approvalPolicy: 'never', sandbox: 'danger-full-access' },
}

/** Browser tools may wait long (the user has the browser, a page loads); Codex gives up on MCP tools after 60 s by default. */
const MCP_TOOL_TIMEOUT_SEC = 900

/**
 * Nexa's MCP server in a thread's config (dotted keys over the account's config.toml). One app-server
 * serves all threads of an account, so the session's token goes with the thread as a header instead
 * of the server's environment: each thread drives its own chat's browser.
 */
export function codexMcpConfig(mcp: NonNullable<RunOptions['mcp']>, mode: PermissionMode): Json {
  const tools = codexToolApprovals(mcp, mode)
  return {
    'mcp_servers.nexa.url': mcp.url,
    'mcp_servers.nexa.http_headers': { Authorization: `Bearer ${mcp.token}` },
    'mcp_servers.nexa.tool_timeout_sec': MCP_TOOL_TIMEOUT_SEC,
    ...(Object.keys(tools).length ? { 'mcp_servers.nexa.tools': tools } : {}),
  }
}

function sandboxPolicy(mode: PermissionMode, cwd: string): Json {
  switch (CODEX_POLICY[mode].sandbox) {
    case 'read-only':
      return { type: 'readOnly', networkAccess: false }
    case 'danger-full-access':
      return { type: 'dangerFullAccess' }
    default:
      return { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
  }
}

const COLLAB_TITLES: Record<string, string> = {
  spawnAgent: 'Agent starten',
  sendInput: 'Nachricht an Agent',
  sendMessage: 'Nachricht an Agent',
  resumeAgent: 'Agent fortsetzen',
  wait: 'Auf Agents warten',
  closeAgent: 'Agent beenden',
  followupTask: 'Folgeaufgabe an Agent',
  interruptAgent: 'Agent unterbrechen',
  listAgents: 'Agents auflisten',
}

function agentStatusOf(status: unknown): AgentStatus | null {
  switch (status) {
    case 'pendingInit':
    case 'running':
      return 'running'
    case 'completed':
    case 'shutdown':
      return 'done'
    case 'errored':
    case 'notFound':
      return 'error'
    case 'interrupted':
      return 'stopped'
    default:
      return null
  }
}

function toolStatusOf(status: unknown): ToolStatus {
  switch (status) {
    case 'completed':
      return 'done'
    case 'failed':
      return 'error'
    case 'declined':
      return 'denied'
    default:
      return 'running'
  }
}

function changesOf(raw: unknown): FileChange[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(isPlainObject).map((c) => {
    const kind = isPlainObject(c.kind) ? c.kind : {}
    return {
      path: str(c.path) ?? '',
      type: kind.type === 'add' ? 'add' : kind.type === 'delete' ? 'delete' : 'update',
      diff: str(c.diff),
      movePath: str(kind.move_path),
    }
  })
}

function mcpResultText(result: unknown, error: unknown): string | undefined {
  if (isPlainObject(error) && typeof error.message === 'string') return error.message
  if (!isPlainObject(result) || !Array.isArray(result.content)) return undefined
  return result.content
    .map((c) => (isPlainObject(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join('\n')
}

interface OpenRequest {
  request: CodexServerRequest
  item: InteractionItem
}

/**
 * One Codex thread, mapped onto Nexa's chat items. The provider owns the app-server and routes the
 * thread's notifications and requests here (and those of the subagents' threads it spawns).
 */
export class CodexRun implements AgentRun {
  threadId = ''
  private turnId: string | null = null
  private turnStartedAt: number | null = null
  private readonly tools = new Map<string, ToolItem | AgentItem>()
  /** Thread of a subagent → its agent item. */
  private readonly children = new Map<string, string>()
  private readonly openRequests = new Map<string, OpenRequest>()
  private readonly thinking = new Set<string>()
  private model: string | undefined
  private effort: string | undefined
  private mode: PermissionMode
  private modeChanged = false
  private lastTokens: { input: number; output: number } | null = null
  private closed = false

  constructor(
    private readonly client: CodexClient,
    private readonly options: RunOptions,
    private readonly sink: RunSink,
    private readonly routes: { add(threadId: string, run: CodexRun): void; remove(run: CodexRun): void },
  ) {
    this.model = options.model || undefined
    this.effort = options.effort || undefined
    this.mode = options.permissionMode
  }

  get alive(): boolean {
    return !this.closed && this.client.alive
  }

  async connect(): Promise<void> {
    this.sink.runtime({ status: 'starting', connected: false })
    const policy = CODEX_POLICY[this.mode]
    const config: Json = this.options.mcp ? codexMcpConfig(this.options.mcp, this.mode) : {}
    const common: Json = {
      cwd: this.options.cwd,
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
      developerInstructions: this.options.instructions || null,
      ...(this.model ? { model: this.model } : {}),
      ...(Object.keys(config).length ? { config } : {}),
    }
    const response = this.options.resumeId
      ? await this.client.request('thread/resume', {
          ...common,
          threadId: this.options.resumeId,
          // A thread copied from another account: Codex doesn't know it by id yet (accounts/session-transfer.ts).
          ...(this.options.resumePath ? { path: this.options.resumePath } : {}),
          excludeTurns: true,
        })
      : await this.client.request('thread/start', common)
    const thread = isPlainObject(response.thread) ? response.thread : {}
    this.threadId = str(thread.id) ?? ''
    if (!this.threadId) throw new Error('Codex hat keinen Thread angelegt.')
    if (typeof response.model === 'string') this.model = response.model
    this.routes.add(this.threadId, this)
    this.sink.cliSession(this.threadId)
    this.sink.runtime({ status: 'idle', connected: true, model: this.model })
  }

  // ------------------------------------------------------------------------------------------
  // Commands from Nexa

  async send(input: SendInput): Promise<void> {
    const items: Json[] = [{ type: 'text', text: input.text, text_elements: [] }]
    for (const path of input.images ?? []) items.push({ type: 'localImage', path })
    if (this.turnId) {
      // A prompt while Codex works joins the running turn.
      await this.client.request('turn/steer', { threadId: this.threadId, input: items, expectedTurnId: this.turnId })
      return
    }
    const params: Json = { threadId: this.threadId, input: items }
    if (this.model) params.model = this.model
    if (this.effort) params.effort = this.effort
    if (this.modeChanged) {
      params.approvalPolicy = CODEX_POLICY[this.mode].approvalPolicy
      params.sandboxPolicy = sandboxPolicy(this.mode, this.options.cwd)
      this.modeChanged = false
    }
    this.turnStartedAt = Date.now()
    this.sink.runtime({ status: 'running', turnStartedAt: this.turnStartedAt, error: undefined })
    try {
      const response = await this.client.request('turn/start', params)
      const turn = isPlainObject(response.turn) ? response.turn : {}
      this.turnId ??= str(turn.id) ?? null
    } catch (error) {
      this.turnStartedAt = null
      this.sink.runtime({ status: 'idle', turnStartedAt: undefined })
      throw error
    }
  }

  async interrupt(): Promise<void> {
    if (!this.turnId) return
    await this.client.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }).catch(() => undefined)
  }

  async respond(itemId: string, response: InteractionResponse): Promise<void> {
    const open = this.openRequests.get(itemId)
    if (!open) throw new Error('Die Frage ist nicht mehr offen.')
    this.openRequests.delete(itemId)
    this.client.respond(open.request.id, answerFor(open.request, response))
    this.sink.item({ ...open.item, state: 'answered', response })
    if (this.openRequests.size === 0 && this.turnId) this.sink.runtime({ status: 'running' })
  }

  async setModel(model: string | undefined, effort: string | undefined): Promise<void> {
    this.model = model || undefined
    this.effort = effort || undefined
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.mode = mode
    this.modeChanged = true
  }

  async stop(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.turnId) await this.interrupt()
    await this.client.request('thread/unsubscribe', { threadId: this.threadId }).catch(() => undefined)
    this.routes.remove(this)
    this.cancelOpen()
    this.sink.exited()
  }

  /** The app-server died: everything open ends. */
  serverExited(error?: string): void {
    if (this.closed) return
    this.closed = true
    this.cancelOpen()
    if (this.turnId && error) {
      this.sink.item({ kind: 'notice', id: randomUUID(), ts: Date.now(), provider: 'codex', level: 'error', text: 'Codex wurde unerwartet beendet', detail: error })
    }
    this.turnId = null
    this.sink.exited(error)
  }

  // ------------------------------------------------------------------------------------------
  // Notifications

  /** The agent item a notification of this thread belongs under, null on the main thread. */
  private parentFor(threadId: string): string | null {
    return threadId === this.threadId ? null : (this.children.get(threadId) ?? null)
  }

  notification(method: string, params: Json): void {
    const threadId = str(params.threadId) ?? this.threadId
    const parentId = this.parentFor(threadId)
    const isMain = parentId === null
    switch (method) {
      case 'turn/started': {
        const turn = isPlainObject(params.turn) ? params.turn : {}
        if (isMain) {
          this.turnId = str(turn.id) ?? this.turnId
          this.turnStartedAt ??= Date.now()
          this.sink.runtime({ status: 'running', turnStartedAt: this.turnStartedAt })
        } else this.setAgent(parentId, { status: 'running' })
        return
      }
      case 'turn/completed':
        return isMain ? this.onTurnCompleted(params) : this.onChildTurnCompleted(parentId, params)
      case 'item/started':
      case 'item/completed':
        if (isPlainObject(params.item)) this.onItem(params.item, parentId, method === 'item/completed')
        return
      case 'item/agentMessage/delta':
        if (typeof params.itemId === 'string' && typeof params.delta === 'string') this.sink.delta(params.itemId, 'text', params.delta)
        return
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        if (typeof params.itemId === 'string' && typeof params.delta === 'string') {
          if (!this.thinking.has(params.itemId)) {
            this.thinking.add(params.itemId)
            this.sink.item({ kind: 'thinking', id: params.itemId, ts: Date.now(), provider: 'codex', parentId, text: '', streaming: true })
          }
          this.sink.delta(params.itemId, 'text', params.delta)
        }
        return
      case 'item/commandExecution/outputDelta':
        if (typeof params.itemId === 'string' && typeof params.delta === 'string') this.sink.delta(params.itemId, 'output', params.delta)
        return
      case 'turn/plan/updated': {
        const plan = Array.isArray(params.plan) ? params.plan.filter(isPlainObject) : []
        this.sink.item({
          kind: 'todo',
          id: `todo:${parentId ?? 'main'}`,
          ts: Date.now(),
          provider: 'codex',
          parentId,
          explanation: str(params.explanation),
          entries: plan.map((p) => ({
            text: str(p.step) ?? '',
            status: p.status === 'completed' ? 'completed' : p.status === 'inProgress' ? 'in_progress' : 'pending',
          })),
        })
        return
      }
      case 'thread/tokenUsage/updated': {
        if (!isMain || !isPlainObject(params.tokenUsage)) return
        const usage = params.tokenUsage
        const last = isPlainObject(usage.last) ? usage.last : {}
        const input = typeof last.inputTokens === 'number' ? last.inputTokens : 0
        const output = typeof last.outputTokens === 'number' ? last.outputTokens : 0
        this.lastTokens = { input, output }
        if (typeof usage.modelContextWindow === 'number') this.sink.runtime({ context: { used: input + output, window: usage.modelContextWindow } })
        return
      }
      case 'error': {
        const error = isPlainObject(params.error) ? params.error : {}
        const message = str(error.message) ?? 'Unbekannter Fehler'
        this.sink.item({
          kind: 'notice',
          id: params.willRetry === true ? 'codex:retry' : randomUUID(),
          ts: Date.now(),
          provider: 'codex',
          parentId,
          level: params.willRetry === true ? 'warning' : 'error',
          text: params.willRetry === true ? 'Fehler, Codex versucht es erneut' : message,
          detail: params.willRetry === true ? message : str(error.additionalDetails),
        })
        return
      }
      case 'serverRequest/resolved': {
        for (const [id, open] of this.openRequests) {
          if (String(open.request.id) !== String(params.requestId)) continue
          this.openRequests.delete(id)
          this.sink.item({ ...open.item, state: 'cancelled' })
        }
        return
      }
      case 'thread/compacted':
        this.sink.item({ kind: 'notice', id: randomUUID(), ts: Date.now(), provider: 'codex', level: 'info', text: 'Kontext wurde zusammengefasst' })
        return
      case 'model/rerouted':
        if (typeof params.toModel === 'string') {
          this.model = params.toModel
          this.sink.runtime({ model: this.model })
        }
        return
    }
  }

  private onItem(item: Json, parentId: string | null, completed: boolean): void {
    const id = str(item.id)
    if (!id) return
    const now = Date.now()
    const startedAt = typeof item.startedAtMs === 'number' ? item.startedAtMs : now
    const endedAt = completed ? (typeof item.completedAtMs === 'number' ? item.completedAtMs : now) : undefined
    const base = { id, ts: startedAt, provider: 'codex' as const, parentId }
    switch (item.type) {
      case 'agentMessage':
        this.sink.item({
          ...base,
          kind: 'assistant',
          text: str(item.text) ?? '',
          streaming: !completed,
          phase: item.phase === 'final_answer' ? 'final' : item.phase === 'commentary' ? 'commentary' : undefined,
        })
        return
      case 'reasoning': {
        const summary = Array.isArray(item.summary) ? item.summary.filter((s): s is string => typeof s === 'string') : []
        const content = Array.isArray(item.content) ? item.content.filter((s): s is string => typeof s === 'string') : []
        const text = (summary.length ? summary : content).join('\n\n')
        if (!completed || !text.trim()) {
          if (completed && this.thinking.has(id)) this.sink.item({ ...base, kind: 'thinking', text, streaming: false })
          return
        }
        this.thinking.add(id)
        this.sink.item({ ...base, kind: 'thinking', text, streaming: false })
        return
      }
      case 'commandExecution': {
        const command = str(item.command) ?? ''
        const view = commandView(command, item.commandActions)
        return this.putTool({
          ...base,
          kind: 'tool',
          tool: view.tool,
          name: 'commandExecution',
          title: view.title,
          detail: view.detail,
          input: { command, cwd: item.cwd },
          output: str(item.aggregatedOutput),
          exitCode: typeof item.exitCode === 'number' ? item.exitCode : null,
          status: completed ? (typeof item.exitCode === 'number' && item.exitCode !== 0 ? 'error' : toolStatusOf(item.status)) : 'running',
          startedAt,
          endedAt,
        })
      }
      case 'fileChange': {
        const changes = changesOf(item.changes)
        return this.putTool({
          ...base,
          kind: 'tool',
          tool: changes.every((c) => c.type === 'add') ? 'write' : 'edit',
          name: 'fileChange',
          title: changes.length > 1 ? `${changes.length} Dateien ändern` : 'Datei ändern',
          detail: changes[0]?.path,
          changes,
          status: completed ? toolStatusOf(item.status) : 'running',
          startedAt,
          endedAt,
        })
      }
      case 'mcpToolCall': {
        const server = str(item.server) ?? 'mcp'
        const tool = str(item.tool) ?? 'tool'
        const render = renderSpecOf(server, tool, item.arguments)
        return this.putTool({
          ...base,
          kind: 'tool',
          tool: render ? 'render' : 'mcp',
          name: `${server}.${tool}`,
          title: render ? (render.type === 'diagram' ? 'Diagramm' : 'Darstellung') : tool.replace(/_/g, ' '),
          server,
          input: item.arguments,
          render,
          output: mcpResultText(item.result, item.error),
          status: completed ? (isPlainObject(item.error) ? 'error' : toolStatusOf(item.status)) : 'running',
          startedAt,
          endedAt,
        })
      }
      case 'dynamicToolCall': {
        const tool = str(item.tool) ?? 'tool'
        return this.putTool({
          ...base,
          kind: 'tool',
          tool: 'other',
          name: tool,
          title: tool.replace(/_/g, ' '),
          input: item.arguments,
          status: completed ? (item.success === false ? 'error' : 'done') : 'running',
          startedAt,
          endedAt,
        })
      }
      case 'webSearch': {
        const action = isPlainObject(item.action) ? item.action : {}
        return this.putTool({
          ...base,
          kind: 'tool',
          tool: 'web',
          name: 'webSearch',
          title: 'Im Web suchen',
          detail: str(item.query) ?? str(action.query) ?? str(action.url),
          status: completed ? 'done' : 'running',
          startedAt,
          endedAt,
        })
      }
      case 'imageView':
        return this.putTool({ ...base, kind: 'tool', tool: 'image', name: 'imageView', title: 'Bild ansehen', detail: str(item.path), status: 'done', startedAt, endedAt })
      case 'collabAgentToolCall':
        return this.onCollab(item, parentId, completed, startedAt, endedAt)
      case 'subAgentActivity': {
        const agentId = this.children.get(str(item.agentThreadId) ?? '')
        if (!agentId) return
        const status: AgentStatus | null = item.kind === 'completed' ? 'done' : item.kind === 'interrupted' ? 'stopped' : item.kind === 'started' ? 'running' : null
        if (status) this.setAgent(agentId, { status, ...(status !== 'running' ? { endedAt: now, activity: undefined } : {}) })
        return
      }
      case 'contextCompaction':
        if (completed) this.sink.item({ ...base, kind: 'notice', level: 'info', text: 'Kontext wurde zusammengefasst' })
        return
      case 'enteredReviewMode':
      case 'exitedReviewMode':
        if (completed) this.sink.item({ ...base, kind: 'notice', level: 'info', text: item.type === 'enteredReviewMode' ? 'Review gestartet' : 'Review beendet', detail: str(item.review) })
        return
    }
  }

  private putTool(tool: ToolItem): void {
    const previous = this.tools.get(tool.id)
    const next: ToolItem = previous?.kind === 'tool' ? { ...previous, ...tool, output: tool.output ?? previous.output } : tool
    this.tools.set(tool.id, next)
    this.sink.item(next)
    if (!previous && tool.parentId) this.bumpAgent(tool.parentId, tool.title + (tool.detail ? ` · ${tool.detail}` : ''))
  }

  private onCollab(item: Json, parentId: string | null, completed: boolean, startedAt: number, endedAt: number | undefined): void {
    const id = str(item.id) ?? randomUUID()
    const tool = str(item.tool) ?? ''
    const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter((t): t is string => typeof t === 'string') : []
    const states = isPlainObject(item.agentsStates) ? item.agentsStates : {}
    if (tool === 'spawnAgent') {
      const previous = this.tools.get(id)
      const prompt = str(item.prompt)
      const agent: AgentItem = {
        kind: 'agent',
        id,
        ts: startedAt,
        provider: 'codex',
        parentId,
        agentType: 'Codex-Agent',
        description: prompt ? firstLine(prompt, 70) : 'Subagent',
        prompt,
        model: str(item.model),
        status: previous?.kind === 'agent' ? previous.status : 'running',
        toolCount: previous?.kind === 'agent' ? previous.toolCount : 0,
        activity: previous?.kind === 'agent' ? previous.activity : undefined,
        startedAt,
      }
      if (completed && item.status === 'failed') agent.status = 'error'
      this.tools.set(id, agent)
      this.sink.item(agent)
      for (const thread of receivers) {
        this.children.set(thread, id)
        this.routes.add(thread, this)
      }
    } else {
      this.putTool({
        id,
        ts: startedAt,
        provider: 'codex',
        parentId,
        kind: 'tool',
        tool: 'other',
        name: tool,
        title: COLLAB_TITLES[tool] ?? tool,
        detail: str(item.prompt) ? firstLine(str(item.prompt) ?? '', 120) : undefined,
        status: completed ? (item.status === 'failed' ? 'error' : 'done') : 'running',
        startedAt,
        endedAt,
      })
    }
    // What the tool knows of the agents' states.
    for (const [thread, raw] of Object.entries(states)) {
      const agentId = this.children.get(thread)
      if (!agentId || !isPlainObject(raw)) continue
      const status = agentStatusOf(raw.status)
      if (!status) continue
      this.setAgent(agentId, {
        status,
        ...(status !== 'running' ? { endedAt: Date.now(), activity: undefined } : {}),
        ...(typeof raw.message === 'string' && status !== 'running' ? { result: raw.message } : {}),
      })
    }
  }

  private setAgent(agentId: string, patch: Partial<AgentItem>): void {
    const agent = this.tools.get(agentId)
    if (agent?.kind !== 'agent') return
    const next: AgentItem = { ...agent, ...patch }
    this.tools.set(agentId, next)
    this.sink.item(next)
  }

  private bumpAgent(agentId: string, activity: string): void {
    const agent = this.tools.get(agentId)
    if (agent?.kind !== 'agent') return
    this.setAgent(agentId, { activity, toolCount: (agent.toolCount ?? 0) + 1 })
  }

  private onChildTurnCompleted(agentId: string, params: Json): void {
    const turn = isPlainObject(params.turn) ? params.turn : {}
    const status: AgentStatus = turn.status === 'failed' ? 'error' : turn.status === 'interrupted' ? 'stopped' : 'done'
    const items = Array.isArray(turn.items) ? turn.items.filter(isPlainObject) : []
    const final = items.reverse().find((i) => i.type === 'agentMessage' && typeof i.text === 'string')
    this.setAgent(agentId, { status, endedAt: Date.now(), activity: undefined, ...(final ? { result: final.text as string } : {}) })
  }

  private onTurnCompleted(params: Json): void {
    const turn = isPlainObject(params.turn) ? params.turn : {}
    const error = isPlainObject(turn.error) ? turn.error : null
    const status = turn.status === 'interrupted' ? 'interrupted' : turn.status === 'failed' ? 'error' : 'done'
    this.cancelOpen()
    this.finishRunning(status === 'interrupted')
    this.sink.item({
      kind: 'turn',
      id: `turn:${str(turn.id) ?? randomUUID()}`,
      ts: Date.now(),
      provider: 'codex',
      status,
      durationMs: typeof turn.durationMs === 'number' ? turn.durationMs : this.turnStartedAt ? Date.now() - this.turnStartedAt : undefined,
      inputTokens: this.lastTokens?.input,
      outputTokens: this.lastTokens?.output,
      model: this.model,
      error: error ? (str(error.message) ?? 'Fehler') : undefined,
    })
    this.turnId = null
    this.turnStartedAt = null
    this.sink.runtime({ status: 'idle', turnStartedAt: undefined, model: this.model })
  }

  private finishRunning(interrupted: boolean): void {
    const now = Date.now()
    for (const [id, tool] of this.tools) {
      if (tool.kind === 'tool' && tool.status === 'running') {
        const next: ToolItem = { ...tool, status: interrupted ? 'denied' : 'done', endedAt: now }
        this.tools.set(id, next)
        this.sink.item(next)
      }
    }
  }

  private cancelOpen(): void {
    for (const [, open] of this.openRequests) {
      this.client.respondError(open.request.id, 'abgebrochen')
      this.sink.item({ ...open.item, state: 'cancelled' })
    }
    this.openRequests.clear()
  }

  // ------------------------------------------------------------------------------------------
  // Requests of the server

  request(request: CodexServerRequest): void {
    const p = request.params
    const threadId = str(p.threadId) ?? this.threadId
    const parentId = this.parentFor(threadId)
    const toolItemId = str(p.itemId)
    let interaction: InteractionRequest | null = null
    switch (request.method) {
      case 'item/commandExecution/requestApproval': {
        const decisions = Array.isArray(p.availableDecisions) ? p.availableDecisions : null
        const options: PermissionOption[] = [{ id: 'allow', label: 'Erlauben' }]
        if (!decisions || decisions.includes('acceptForSession')) options.push({ id: 'allow-session', label: 'Für diese Session erlauben' })
        options.push({ id: 'deny', label: 'Ablehnen' })
        interaction = {
          type: 'permission',
          toolName: 'commandExecution',
          title: p.kind === 'network' ? 'Netzwerkzugriff' : 'Befehl ausführen',
          detail: p.command ? commandView(String(p.command), p.commandActions).command : undefined,
          reason: str(p.reason),
          description: str(p.cwd),
          options,
        }
        break
      }
      case 'item/fileChange/requestApproval': {
        const tool = toolItemId ? this.tools.get(toolItemId) : undefined
        interaction = {
          type: 'permission',
          toolName: 'fileChange',
          title: 'Dateien ändern',
          reason: str(p.reason),
          detail: str(p.grantRoot),
          changes: tool?.kind === 'tool' ? tool.changes : undefined,
          options: [
            { id: 'allow', label: 'Erlauben' },
            { id: 'allow-session', label: 'Für diese Session erlauben' },
            { id: 'deny', label: 'Ablehnen' },
          ],
        }
        break
      }
      case 'item/permissions/requestApproval':
        interaction = {
          type: 'permission',
          toolName: 'permissions',
          title: 'Zusätzliche Rechte',
          reason: str(p.reason),
          detail: str(p.cwd),
          input: p.permissions,
          options: [
            { id: 'allow', label: 'Für diesen Turn erlauben' },
            { id: 'allow-session', label: 'Für diese Session erlauben' },
            { id: 'deny', label: 'Ablehnen' },
          ],
        }
        break
      case 'item/tool/requestUserInput': {
        const questions = Array.isArray(p.questions) ? p.questions.filter(isPlainObject) : []
        interaction = {
          type: 'question',
          questions: questions.map((q) => ({
            id: str(q.id) ?? randomUUID(),
            header: str(q.header) ?? '',
            question: str(q.question) ?? '',
            multiSelect: false,
            allowOther: q.isOther === true || !Array.isArray(q.options) || q.options.length === 0,
            secret: q.isSecret === true,
            options: (Array.isArray(q.options) ? q.options.filter(isPlainObject) : []).map((o) => ({ label: str(o.label) ?? '', description: str(o.description) })),
          })),
        }
        break
      }
      case 'mcpServer/elicitation/request':
        interaction = {
          type: 'elicitation',
          server: str(p.serverName) ?? 'MCP',
          message: str(p.message) ?? '',
          schema: isPlainObject(p.requestedSchema) ? p.requestedSchema : undefined,
          url: str(p.url),
        }
        break
    }
    if (!interaction) {
      this.client.respondError(request.id, 'Wird von Nexa nicht unterstützt.')
      return
    }
    const item: InteractionItem = {
      kind: 'interaction',
      id: `interaction:${String(request.id)}:${threadId}`,
      ts: Date.now(),
      provider: 'codex',
      parentId,
      request: interaction,
      state: 'pending',
      toolItemId,
    }
    this.openRequests.set(item.id, { request, item })
    this.sink.item(item)
    this.sink.runtime({ status: 'waiting' })
  }
}

function answerFor(request: CodexServerRequest, response: InteractionResponse): Json {
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval': {
      const decision = response.type === 'permission' ? response.decision : 'deny'
      return { decision: decision === 'allow' ? 'accept' : decision === 'allow-session' ? 'acceptForSession' : 'decline' }
    }
    case 'item/permissions/requestApproval': {
      const decision = response.type === 'permission' ? response.decision : 'deny'
      if (decision === 'deny') return { permissions: {}, scope: 'turn' }
      const requested = isPlainObject(request.params.permissions) ? request.params.permissions : {}
      const granted: Json = {}
      if (requested.network) granted.network = requested.network
      if (requested.fileSystem) granted.fileSystem = requested.fileSystem
      return { permissions: granted, scope: decision === 'allow-session' ? 'session' : 'turn' }
    }
    case 'item/tool/requestUserInput': {
      const answers: Json = {}
      if (response.type === 'question') for (const [id, values] of Object.entries(response.answers)) answers[id] = { answers: values }
      return { answers }
    }
    case 'mcpServer/elicitation/request':
      return response.type === 'elicitation'
        ? { action: response.action, content: response.content ?? null, _meta: null }
        : { action: 'cancel', content: null, _meta: null }
  }
  return {}
}

/**
 * What a command of Codex does: its `commandActions` name the command without the shell around it
 * (`powershell.exe -Command …`) and tell reading, listing and searching apart from the rest.
 */
export function commandView(command: string, actions: unknown): { tool: 'bash' | 'read' | 'search'; title: string; detail: string; command: string } {
  const list = Array.isArray(actions) ? actions.filter(isPlainObject) : []
  const inner = list.length ? list.map((a) => String(a.command ?? '')).filter(Boolean).join(' && ') : unwrapShell(command)
  const plain = inner || command
  if (list.length === 1) {
    const action = list[0]
    if (action.type === 'read' && typeof action.path === 'string') return { tool: 'read', title: 'Datei lesen', detail: action.path, command: plain }
    if (action.type === 'listFiles') return { tool: 'search', title: 'Dateien auflisten', detail: String(action.path ?? plain), command: plain }
    if (action.type === 'search') {
      return { tool: 'search', title: 'Suchen', detail: [action.query, action.path].filter((x) => typeof x === 'string' && x).join(' in ') || plain, command: plain }
    }
  }
  return { tool: 'bash', title: 'Befehl ausführen', detail: firstLine(plain, 200), command: plain }
}

/** `"…\powershell.exe" -Command '…'` or `bash -lc '…'` → the command inside. */
export function unwrapShell(command: string): string {
  const match = /^\s*(?:"([^"]+)"|(\S+))\s+(?:[-/]\w+\s+)*?(?:-Command|-c|-lc|\/c)\s+([\s\S]+)$/i.exec(command)
  if (!match) return command
  const exe = (match[1] ?? match[2] ?? '').split(/[\\/]/).pop() ?? ''
  const shell = /^(?:powershell|pwsh)(?:\.exe)?$/i.test(exe)
    ? 'powershell'
    : /^(?:bash|sh|zsh)(?:\.exe)?$/i.test(exe)
      ? 'posix'
      : /^cmd(?:\.exe)?$/i.test(exe)
        ? 'cmd'
        : null
  if (!shell) return command
  const inner = match[3].trim()
  const quoted = /^(['"])([\s\S]*)\1$/.exec(inner)
  if (!quoted) return inner
  const [, quote, body] = quoted
  // Undo the escapes of the shell's quoting: '' in PowerShell's single quotes, \" in POSIX double quotes.
  if (shell === 'powershell') return quote === "'" ? body.replace(/''/g, "'") : body.replace(/`"|""/g, '"')
  if (shell === 'posix' && quote === '"') return body.replace(/\\(["\\$`])/g, '$1')
  return body
}
