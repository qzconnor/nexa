import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type {
  AgentItem,
  ContextDetail,
  InteractionItem,
  InteractionRequest,
  InteractionResponse,
  PermissionMode,
  PermissionOption,
  Question,
  ShellState,
  ShellStatus,
  ToolItem,
} from '@shared/chat'
import { compactionNotice } from '@shared/chat'
import type { McpAuthStart, ShellOutput, UsageWindow } from '@shared/types'
import { renderSpecOf } from '@shared/render'
import { appResultOf, claudeServerKey, type McpAppToolResult, type McpToolUi } from '@shared/mcp-apps'
import { isPlainObject, withTimeout } from '@shared/utils'
import type { CliBinary } from '../cli-binary'
import { cliEnv } from '../cli-binary'
import { consoleDecoder } from '../../lib/console-code-page'
import { claudeToolNames } from '../../mcp/tool-grant'
import { JsonlProcess } from '../jsonl-process'
import { claudeMcpServers, claudeToolUis, type McpToolUis } from '../mcp-servers'
import { claudeAuthStart } from '../plugins'
import type { AgentRun, McpServerState, RunInput, RunOptions, RunSink } from '../provider'
import { TITLE_TIMEOUT_MS, cleanTitle, titleDescription } from '../titles'
import { contextDetailOf } from './claude-context'
import { AGENT_TOOLS, changesFromResult, compactionOf, resultText, splitMcpName, todosOf, viewOfClaudeTool } from './claude-tools'
import { outputFilesOf, readTaskOutput, repairReadFile } from './output-encoding'

type Json = Record<string, unknown>

/** How long the context's count may take before the card makes do with the last one. */
const CONTEXT_TIMEOUT_MS = 8000

/**
 * Nexa shows MCP Apps: Claude Code then tells the servers so (the extension `io.modelcontextprotocol/ui`
 * in `initialize`, which servers check before they offer pages) and `mcp_status` lists the tools' `_meta`.
 */
export const CLAUDE_MCP_APPS_ENV = { CLAUDE_CODE_MCP_APPS_HOST: '1' } as const
/** An MCP tool the list doesn't know yet (a server connected since): the list is asked again after this long. */
const TOOL_UIS_STALE_MS = 5000

const MODE_FLAG: Record<PermissionMode, string> = {
  ask: 'default',
  edits: 'acceptEdits',
  plan: 'plan',
  auto: 'auto',
  full: 'bypassPermissions',
}

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

interface StreamBlock {
  itemId: string
  kind: 'text' | 'thinking' | 'tool'
  /** The final `assistant` message of the block arrived. */
  done: boolean
  /** A thinking block is only shown once it has text. */
  shown: boolean
}

interface OpenInteraction {
  requestId: string
  item: InteractionItem
  toolName: string
  input: Json
  suggestions: unknown[]
  kind: 'tool' | 'elicitation'
}

/** The arguments Claude Code is started with (stream-json both ways, Nexa answers its questions). */
export function claudeArgs(options: RunOptions): string[] {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--forward-subagent-text',
    '--permission-prompt-tool',
    'stdio',
    '--permission-mode',
    MODE_FLAG[options.permissionMode],
    // Lets the user switch to full permissions while the session runs.
    '--allow-dangerously-skip-permissions',
  ]
  if (options.model) args.push('--model', options.model)
  if (options.effort) args.push('--effort', options.effort)
  // Only for the session, without touching the user's settings.
  if (options.ultracode !== undefined) args.push('--settings', JSON.stringify({ ultracode: options.ultracode }))
  if (options.resumeId) {
    args.push('--resume', options.resumeId)
    if (options.fork) {
      args.push('--fork-session')
      // The Agent SDK's `resumeSessionAt`: the conversation up to this message only.
      if (options.fork.at) args.push('--resume-session-at', options.fork.at)
    }
  }
  if (options.instructions) args.push('--append-system-prompt', options.instructions)
  if (options.mcp) {
    const config = {
      mcpServers: {
        nexa: { type: 'http', url: options.mcp.url, headers: { Authorization: `Bearer ${options.mcp.token}` } },
      },
    }
    args.push('--mcp-config', JSON.stringify(config))
    // Tool by tool: the ones left out (the browser's sensitive tools) go through Nexa's permission prompt.
    // The `=` form, as the option takes several values and would swallow what follows.
    if (options.mcp.allowed.length) args.push(`--allowedTools=${claudeToolNames(options.mcp.allowed).join(',')}`)
  }
  if (options.noChrome) args.push('--no-chrome')
  // `=` form, one each: the option takes several values and would swallow what follows.
  for (const dir of options.dirs ?? []) args.push(`--add-dir=${dir}`)
  args.push(...options.extraArgs)
  return args
}

/**
 * One Claude Code process in `-p` mode with stream-json in and out. Maps its stream onto Nexa's
 * chat items and answers its control requests (permissions, AskUserQuestion, plans, elicitations)
 * with what the user chooses in the chat. Protocol: docs/PROTOCOLS.md.
 */
export class ClaudeRun implements AgentRun {
  private readonly process: JsonlProcess
  private readonly blocks = new Map<string, StreamBlock>()
  private readonly tools = new Map<string, ToolItem | AgentItem>()
  private readonly interactions = new Map<string, OpenInteraction>()
  private readonly pending = new Map<string, { resolve: (value: Json) => void; reject: (error: Error) => void }>()
  /** Agents by the id of their task, for the task events of background agents. */
  private readonly tasks = new Map<string, string>()
  /** The files Claude Code writes its shells' output to, by task id (see shellOutput). */
  private readonly outputFiles = new Map<string, string>()
  private turnStartedAt: number | null = null
  private compactingSince: number | null = null
  /** The model's context window from the last result, for the context after a compaction. */
  private contextWindow: number | undefined
  /**
   * What the main thread's last API call took up: the context. The turn's result can't tell, its
   * usage adds up every call of the turn (each tool call is one), many times the context.
   */
  private lastContext: number | undefined
  /** The last count of what fills the context (`get_context_usage`). */
  private lastDetail: ContextDetail | null = null
  private interrupting = false
  /** The turn ran into a usage limit (`rate_limit_event` rejected, or an answer with `error: rate_limit`). */
  private limitHit = false
  private model: string | undefined
  private stopping = false
  /** The user's MCP servers switched off for the project, as this process knows them. */
  private readonly mcpOff = new Set<string>()
  /** What the servers' tools say about pages (MCP Apps), from `mcp_status`, by the server's key in tool names. */
  private toolUis: Map<string, McpToolUis> | null = null
  private toolUisAt = 0
  private toolUisLoading: Promise<void> | null = null
  /**
   * Results of MCP tools whose page is still being looked up, by tool id: the result can come before
   * `mcp_status` answers.
   */
  private readonly appResults = new Map<string, McpAppToolResult>()
  /** MCP tools whose page is being looked up, by tool id. */
  private readonly appLookups = new Set<string>()

  constructor(
    binary: CliBinary,
    options: RunOptions,
    private readonly sink: RunSink,
  ) {
    this.model = options.model
    this.process = new JsonlProcess(binary.command(claudeArgs(options)), {
      cwd: options.cwd,
      env: cliEnv({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', ...CLAUDE_MCP_APPS_ENV, ...options.account.set }, options.account.unset),
      onMessage: (m) => this.onMessage(m),
      onExit: (code, stderr) => this.onExit(code, stderr),
    })
    sink.runtime({ status: 'starting', connected: true })
    // Counted at once, not only after the first answer: a resumed conversation is as full as it was,
    // a new one starts with the system prompt and the tools.
    void this.request({ subtype: 'initialize' })
      .then(() => {
        // Started without a prompt (a restart): ready now. Its `init` only comes with the first prompt.
        if (this.turnStartedAt === null) sink.runtime({ status: 'idle' })
        return this.contextDetail()
      })
      .catch(() => undefined)
    // Claude Code keeps a switch only for the process, so each start applies the project's again;
    // written before the first prompt, they are through before it is read.
    for (const name of options.mcpOff ?? []) this.mcpOff.add(name)
    this.applyMcpOff()
  }

  private applyMcpOff(): void {
    for (const name of this.mcpOff) {
      void this.request({ subtype: 'mcp_toggle', serverName: name, enabled: false }).catch(() => undefined)
    }
  }

  get alive(): boolean {
    return this.process.alive
  }

  get pid(): number | undefined {
    return this.process.pid
  }

  // ------------------------------------------------------------------------------------------
  // Commands from Nexa

  async send(input: RunInput): Promise<void> {
    const content: Json[] = []
    for (const path of input.images ?? []) {
      const type = IMAGE_TYPES[extname(path).toLowerCase()]
      if (!type) continue
      const data = await readFile(path)
      content.push({ type: 'image', source: { type: 'base64', media_type: type, data: data.toString('base64') } })
    }
    content.push({ type: 'text', text: input.text })
    // The uuid comes back in `command_lifecycle` when Claude Code takes the prompt up (see onLifecycle).
    this.process.write({ type: 'user', uuid: input.id, message: { role: 'user', content }, parent_tool_use_id: null, session_id: '' })
    this.turnStarted()
  }

  async interrupt(): Promise<void> {
    if (!this.process.alive) return
    this.interrupting = true
    await this.request({ subtype: 'interrupt' }).catch(() => undefined)
  }

  async shellOutput(taskId: string): Promise<ShellOutput> {
    // From its file where Nexa knows it: Claude Code's answer has the umlauts of console programs as `�`.
    const file = this.outputFiles.get(taskId)
    if (file) {
      const output = await readTaskOutput(file, await consoleDecoder()).catch(() => null)
      if (output) return output
    }
    if (!this.process.alive) throw new Error('Claude Code läuft nicht mehr, die Ausgabe ist nicht mehr abrufbar.')
    const answer = await this.request({ subtype: 'get_task_output', task_id: taskId })
    return { text: str(answer.output) ?? '', truncated: answer.truncated === true }
  }

  async stopShell(taskId: string): Promise<void> {
    if (!this.process.alive) return
    await this.request({ subtype: 'stop_task', task_id: taskId })
  }

  async mcpServers(): Promise<McpServerState[]> {
    if (!this.process.alive) throw new Error('Claude Code läuft nicht mehr.')
    return claudeMcpServers(await this.request({ subtype: 'mcp_status' }))
  }

  async setMcpEnabled(name: string, enabled: boolean): Promise<boolean> {
    if (!this.process.alive) return false
    if (enabled) this.mcpOff.delete(name)
    else this.mcpOff.add(name)
    // A server the CLI doesn't know (gone from its config) has nothing to switch.
    await this.request({ subtype: 'mcp_toggle', serverName: name, enabled }).catch(() => undefined)
    return true
  }

  async reconnectMcp(name: string): Promise<void> {
    if (!this.process.alive) throw new Error('Claude Code läuft nicht mehr.')
    await this.request({ subtype: 'mcp_reconnect', serverName: name })
  }

  async readMcpResource(server: string, uri: string): Promise<unknown> {
    if (!this.process.alive) throw new Error('Claude Code läuft nicht mehr.')
    return this.request({ subtype: 'mcp_read_resource', serverName: server, uri })
  }

  async callMcpTool(server: string, tool: string, args: Record<string, unknown>): Promise<McpAppToolResult> {
    if (!this.process.alive) throw new Error('Claude Code läuft nicht mehr.')
    // `soft_error_result`: a tool that fails says why in its own result, as the page expects it.
    const answer = await this.request({ subtype: 'mcp_call', tool: `mcp__${claudeServerKey(server)}__${tool}`, arguments: args, soft_error_result: true })
    return appResultOf(answer)
  }

  async mcpToolUi(server: string, tool: string): Promise<McpToolUi | null> {
    return (await this.toolUiOf(claudeServerKey(server), tool))?.ui ?? null
  }

  /** What a tool's descriptor says about pages, by the server's key in tool names; asks `mcp_status` once more for a tool it doesn't know. */
  private async toolUiOf(key: string, tool: string): Promise<{ server: string; ui: McpToolUi } | null> {
    const find = () => {
      const entry = this.toolUis?.get(key)
      const ui = entry?.tools.get(tool)
      return entry && ui ? { server: entry.server, ui } : null
    }
    if (!this.toolUis || (!find() && Date.now() - this.toolUisAt > TOOL_UIS_STALE_MS)) await this.loadToolUis()
    return find()
  }

  private loadToolUis(): Promise<void> {
    this.toolUisLoading ??= this.request({ subtype: 'mcp_status' })
      .then((answer) => {
        this.toolUis = claudeToolUis(answer)
        this.toolUisAt = Date.now()
      })
      .catch(() => undefined)
      .finally(() => {
        this.toolUisLoading = null
      })
    return this.toolUisLoading
  }

  /** An MCP tool with a page of its own (MCP Apps): the item learns it, with the result if that came first. */
  private async attachApp(toolId: string, key: string, tool: string): Promise<void> {
    this.appLookups.add(toolId)
    try {
      const found = this.process.alive ? await this.toolUiOf(key, tool) : null
      const current = this.tools.get(toolId)
      if (!found?.ui.resourceUri || current?.kind !== 'tool') return
      const next: ToolItem = { ...current, app: { server: found.server, tool, resourceUri: found.ui.resourceUri } }
      const result = this.appResults.get(toolId)
      if (result) next.appResult = result
      this.tools.set(toolId, next)
      this.sink.item(next)
    } finally {
      this.appLookups.delete(toolId)
      this.appResults.delete(toolId)
    }
  }

  /**
   * The process takes the browser's answer itself (its own OAuth) or the sign-in is on claude.ai (a
   * connector), after which `reconnectMcp` connects it.
   */
  async authenticateMcp(name: string): Promise<McpAuthStart | null> {
    if (!this.process.alive) throw new Error('Claude Code läuft nicht mehr.')
    return claudeAuthStart(await this.request({ subtype: 'mcp_authenticate', serverName: name }))
  }

  /**
   * `/reload-plugins`: commands, agents, hooks and servers of the plugins as the settings now say. The
   * servers it brings anew start switched on, so the project's switches go out again.
   */
  async reloadPlugins(): Promise<boolean> {
    if (!this.process.alive) return false
    await this.request({ subtype: 'reload_plugins' })
    this.applyMcpOff()
    return true
  }

  /**
   * What fills the context, counted by Claude Code (`/context`). `summary` answers from the last
   * response's usage and local estimates, without calls to the API, so it is quick and free. Once the
   * process is gone, the last count stands.
   */
  /** What the context is measured against: Claude Code's own limit once counted, else the model's window. */
  private contextLimit(): number | undefined {
    return this.lastDetail?.window ?? this.contextWindow
  }

  /** The context after an answer of the main thread, in the ring while the turn still runs. */
  private showContext(used: number): void {
    if (used === this.lastContext) return
    this.lastContext = used
    const max = this.contextLimit()
    if (max) this.sink.runtime({ context: { used, window: max } })
  }

  async contextDetail(): Promise<ContextDetail | null> {
    if (!this.process.alive) return this.lastDetail
    const answer = await withTimeout(this.request({ subtype: 'get_context_usage', detail: 'summary' }), CONTEXT_TIMEOUT_MS).catch(() => null)
    const detail = contextDetailOf(answer)
    if (!detail) return this.lastDetail
    this.lastDetail = detail
    this.lastContext = detail.used
    this.sink.runtime({ context: { used: detail.used, window: detail.window } })
    return detail
  }

  async respond(itemId: string, response: InteractionResponse): Promise<void> {
    const open = this.interactions.get(itemId)
    if (!open) throw new Error('Die Frage ist nicht mehr offen.')
    this.interactions.delete(itemId)
    const answer = open.kind === 'elicitation' ? this.elicitationAnswer(response) : await this.toolAnswer(open, response)
    this.process.write({ type: 'control_response', response: { subtype: 'success', request_id: open.requestId, response: answer } })
    this.sink.item({ ...open.item, state: 'answered', response })
    this.questionsSettled()
  }

  /**
   * Claude Code's own title for the session (`/rename` without a name). `persist` saves it as the
   * session's `ai-title`, the one its own title would have been: it gives back that one when it came
   * first, so `claude --resume` shows the same.
   */
  async title(prompt: string): Promise<string | null> {
    if (!this.process.alive) return null
    const request = this.request({ subtype: 'generate_session_title', description: titleDescription(prompt), persist: true })
    const answer = await withTimeout(request, TITLE_TIMEOUT_MS)
    return cleanTitle(str(answer.title))
  }

  async setModel(model: string | undefined): Promise<void> {
    this.model = model
    await this.request({ subtype: 'set_model', model: model ?? 'default' })
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.request({ subtype: 'set_permission_mode', mode: MODE_FLAG[mode] })
  }

  async stop(): Promise<void> {
    this.stopping = true
    await this.process.stop()
  }

  // ------------------------------------------------------------------------------------------
  // Answers to control requests

  private async toolAnswer(open: OpenInteraction, response: InteractionResponse): Promise<Json> {
    if (response.type === 'question') {
      // Claude Code keys the answers by the question's text; several choices are joined.
      const answers: Record<string, string> = {}
      for (const [question, values] of Object.entries(response.answers)) answers[question] = values.join(', ')
      return { behavior: 'allow', updatedInput: { ...open.input, answers } }
    }
    if (response.type === 'plan') {
      if (!response.approve) {
        return { behavior: 'deny', message: response.feedback?.trim() || 'Der Nutzer hat den Plan abgelehnt. Frag nach, was er anders haben möchte.' }
      }
      if (response.mode && response.mode !== 'plan') await this.setPermissionMode(response.mode).catch(() => undefined)
      return { behavior: 'allow', updatedInput: open.input }
    }
    if (response.type === 'permission') {
      if (response.decision === 'deny') {
        return { behavior: 'deny', message: response.message?.trim() || 'Der Nutzer hat das abgelehnt.' }
      }
      return {
        behavior: 'allow',
        updatedInput: open.input,
        ...(response.decision === 'allow-session' && open.suggestions.length ? { updatedPermissions: open.suggestions } : {}),
      }
    }
    return { behavior: 'deny', message: 'Unerwartete Antwort.' }
  }

  private elicitationAnswer(response: InteractionResponse): Json {
    if (response.type !== 'elicitation') return { action: 'cancel' }
    return { action: response.action, ...(response.content ? { content: response.content } : {}) }
  }

  // ------------------------------------------------------------------------------------------
  // The stream

  private onMessage(raw: unknown): void {
    if (!isPlainObject(raw)) return
    const m = raw
    switch (m.type) {
      case 'stream_event':
        return this.onStreamEvent(m)
      case 'assistant':
        return this.onAssistant(m)
      case 'user':
        return this.onUser(m)
      case 'system':
        return this.onSystem(m)
      case 'result':
        return this.onResult(m)
      case 'rate_limit_event':
        return this.onRateLimit(m)
      case 'control_request':
        return this.onControlRequest(m)
      case 'control_cancel_request':
        return this.onControlCancel(m)
      case 'control_response':
        return this.onControlResponse(m)
      case 'command_lifecycle':
        return this.onLifecycle(m)
    }
  }

  /**
   * A prompt from stdin goes `queued` → `started` → `completed` (or `cancelled`). One sent during a turn
   * starts at the next step of it, or after an interrupt as a turn of its own: then Claude Code works
   * again without a prompt of Nexa's.
   */
  private onLifecycle(m: Json): void {
    const id = str(m.command_uuid)
    if (!id || m.state !== 'started') return
    this.turnStarted()
    this.sink.taken(id)
  }

  private parentOf(m: Json): string | null {
    return str(m.parent_tool_use_id) ?? null
  }

  private onStreamEvent(m: Json): void {
    const event = isPlainObject(m.event) ? m.event : null
    if (!event) return
    const messageId = str(m.api_message_id) ?? (isPlainObject(event.message) ? str(event.message.id) : undefined)
    if (!messageId) return
    const parentId = this.parentOf(m)
    if (event.type === 'message_start') this.ownTurn(parentId)
    if (event.type === 'content_block_start' && isPlainObject(event.content_block)) {
      const block = event.content_block
      const key = `${messageId}:${String(event.index)}`
      if (block.type === 'text') {
        const itemId = key
        this.blocks.set(key, { itemId, kind: 'text', done: false, shown: true })
        this.sink.item({ kind: 'assistant', id: itemId, ts: Date.now(), provider: 'claude', parentId, text: '', streaming: true })
      } else if (block.type === 'thinking') {
        this.blocks.set(key, { itemId: key, kind: 'thinking', done: false, shown: false })
      } else if (block.type === 'tool_use' && typeof block.id === 'string') {
        this.blocks.set(key, { itemId: block.id, kind: 'tool', done: false, shown: false })
      }
      return
    }
    if (event.type === 'content_block_delta' && isPlainObject(event.delta)) {
      const block = this.blocks.get(`${messageId}:${String(event.index)}`)
      if (!block || block.done) return
      const delta = event.delta
      if (delta.type === 'text_delta' && typeof delta.text === 'string' && block.kind === 'text') {
        this.sink.delta(block.itemId, 'text', delta.text)
      } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && block.kind === 'thinking') {
        if (!block.shown) {
          block.shown = true
          this.sink.item({ kind: 'thinking', id: block.itemId, ts: Date.now(), provider: 'claude', parentId, text: '', streaming: true })
        }
        this.sink.delta(block.itemId, 'text', delta.thinking)
      }
    }
  }

  /** The stream block of this message that the next finished block of `kind` belongs to. */
  private takeBlock(messageId: string, kind: StreamBlock['kind']): StreamBlock | undefined {
    for (const [key, block] of this.blocks) {
      if (key.startsWith(`${messageId}:`) && block.kind === kind && !block.done) return block
    }
    return undefined
  }

  private onAssistant(m: Json): void {
    const message = isPlainObject(m.message) ? m.message : null
    if (!message || !Array.isArray(message.content)) return
    const messageId = str(message.id) ?? randomUUID()
    const parentId = this.parentOf(m)
    this.ownTurn(parentId)
    // Claude Code's own answer at a limit ("You've hit your limit · resets …").
    if (m.error === 'rate_limit' && !parentId) this.limitHit = true
    if (typeof message.model === 'string' && !parentId) this.model = message.model
    if (!parentId && isPlainObject(message.usage)) {
      const used = contextOf(message.usage)
      // Claude Code's own messages (`<synthetic>`) come without usage.
      if (used > 0) this.showContext(used)
    }
    for (const raw of message.content) {
      if (!isPlainObject(raw)) continue
      if (raw.type === 'text') {
        const block = this.takeBlock(messageId, 'text')
        if (block) block.done = true
        const text = str(raw.text) ?? ''
        if (!text.trim() && !block) continue
        this.sink.item({
          kind: 'assistant',
          id: block?.itemId ?? `${messageId}:t${randomUUID().slice(0, 8)}`,
          ts: Date.now(),
          provider: 'claude',
          parentId,
          text,
          streaming: false,
        })
      } else if (raw.type === 'thinking') {
        const block = this.takeBlock(messageId, 'thinking')
        if (block) block.done = true
        const text = str(raw.thinking) ?? ''
        // Without a summary Claude Code sends the block empty: nothing to show.
        if (!text.trim()) continue
        this.sink.item({
          kind: 'thinking',
          id: block?.itemId ?? `${messageId}:k${randomUUID().slice(0, 8)}`,
          ts: Date.now(),
          provider: 'claude',
          parentId,
          text,
          streaming: false,
        })
      } else if (raw.type === 'tool_use' && typeof raw.id === 'string' && typeof raw.name === 'string') {
        const block = this.takeBlock(messageId, 'tool')
        if (block) block.done = true
        this.onToolUse(raw.id, raw.name, isPlainObject(raw.input) ? raw.input : {}, parentId)
      }
    }
  }

  private onToolUse(id: string, name: string, input: Json, parentId: string | null): void {
    const now = Date.now()
    if (AGENT_TOOLS.has(name)) {
      const agent: AgentItem = {
        kind: 'agent',
        id,
        ts: now,
        provider: 'claude',
        parentId,
        agentType: str(input.subagent_type) ?? 'general-purpose',
        description: str(input.description) ?? 'Subagent',
        prompt: str(input.prompt),
        model: str(input.model),
        background: input.run_in_background === true,
        status: 'running',
        toolCount: 0,
        startedAt: now,
      }
      this.tools.set(id, agent)
      this.sink.item(agent)
      return
    }
    const view = viewOfClaudeTool(name, input)
    const tool: ToolItem = {
      kind: 'tool',
      id,
      ts: now,
      provider: 'claude',
      parentId,
      tool: view.tool,
      name,
      title: view.title,
      detail: view.detail,
      input,
      changes: view.changes,
      server: view.server,
      render: renderSpecOf(view.server, view.shortName, input),
      status: 'running',
      startedAt: now,
    }
    this.tools.set(id, tool)
    this.sink.item(tool)
    if (view.server && !tool.render && view.shortName) void this.attachApp(id, view.server, view.shortName)
    if (name === 'TodoWrite') {
      const entries = todosOf(input)
      if (entries) this.sink.item({ kind: 'todo', id: `todo:${parentId ?? 'main'}`, ts: now, provider: 'claude', parentId, entries })
    }
    if (parentId) this.bumpAgent(parentId, view.title + (view.detail ? ` · ${view.detail}` : ''))
  }

  /**
   * A Read of a file that isn't UTF-8 has `�` for its umlauts (see output-encoding.ts): read from the
   * file itself, while it still is what Claude Code read.
   */
  private async repairRead(toolId: string, text: string): Promise<void> {
    const tool = this.tools.get(toolId)
    const path = tool?.kind === 'tool' && isPlainObject(tool.input) ? str(tool.input.file_path) : undefined
    if (!path) return
    const repaired = await repairReadFile(path, text).catch(() => null)
    const current = this.tools.get(toolId)
    if (!repaired || current?.kind !== 'tool' || current.output !== text) return
    const next: ToolItem = { ...current, output: repaired }
    this.tools.set(toolId, next)
    this.sink.item(next)
  }

  private putShell(tool: ToolItem, shell: ShellState): void {
    const next: ToolItem = { ...tool, shell }
    this.tools.set(tool.id, next)
    this.sink.item(next)
  }

  private bumpAgent(agentId: string, activity: string): void {
    const agent = this.tools.get(agentId)
    if (agent?.kind !== 'agent') return
    const next: AgentItem = { ...agent, activity, toolCount: (agent.toolCount ?? 0) + 1 }
    this.tools.set(agentId, next)
    this.sink.item(next)
  }

  private onUser(m: Json): void {
    const message = isPlainObject(m.message) ? m.message : null
    if (!message || !Array.isArray(message.content)) return
    for (const block of message.content) {
      if (!isPlainObject(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue
      const known = this.tools.get(block.tool_use_id)
      if (!known) continue
      const text = resultText(block.content)
      const isError = block.is_error === true
      const now = Date.now()
      if (known.kind === 'agent') {
        // A background agent answers at once that it was started; its end comes as a task event.
        // Its task_started says so; the answer itself too, should that event not have come.
        if (!isError && (known.background || /^Async agent launched/i.test(text.trim()))) {
          if (!known.background) {
            const next: AgentItem = { ...known, background: true }
            this.tools.set(known.id, next)
            this.sink.item(next)
          }
          continue
        }
        const next: AgentItem = { ...known, status: isError ? 'error' : 'done', result: text, endedAt: now, activity: undefined }
        this.tools.set(known.id, next)
        this.sink.item(next)
      } else {
        const denied = isError && /permission|denied|abgelehnt|rejected/i.test(text) && text.length < 400
        const next: ToolItem = { ...known, status: denied ? 'denied' : isError ? 'error' : 'done', output: text, endedAt: now }
        // A shell in the background says where its output goes.
        if (known.tool === 'bash') for (const { taskId, file } of outputFilesOf(text)) this.outputFiles.set(taskId, file)
        if (known.tool === 'read' && !isError && text.includes('�')) void this.repairRead(known.id, text)
        const changes = isError ? null : changesFromResult(known.changes, m.tool_use_result)
        if (changes) next.changes = changes
        // The page of an MCP tool gets the result as the server gave it, beyond the text for the model.
        if (known.server && !known.render) {
          const result = appResultOf(m.tool_use_result ?? { content: block.content }, isError)
          if (known.app) next.appResult = result
          else if (this.appLookups.has(known.id)) this.appResults.set(known.id, result)
        }
        // A shell in the foreground ends with its call; one in the background runs on.
        if (next.shell && !next.shell.background && next.shell.status === 'running') {
          next.shell = { ...next.shell, status: isError ? 'error' : 'done', endedAt: now }
        }
        this.tools.set(known.id, next)
        this.sink.item(next)
      }
    }
  }

  private onSystem(m: Json): void {
    switch (m.subtype) {
      case 'init': {
        if (typeof m.session_id === 'string') this.sink.cliSession(m.session_id)
        if (typeof m.model === 'string') this.model = m.model
        this.sink.runtime({ connected: true, model: this.model, ...(this.turnStartedAt === null && this.interactions.size === 0 ? { status: 'idle' } : {}) })
        return
      }
      case 'status': {
        // `compacting` comes when a compaction starts and again every 30 s while it runs; any other
        // status (null, `requesting`) means it is over.
        if (m.status === 'compacting') {
          if (this.compactingSince !== null) return
          this.compactingSince = Date.now()
          this.sink.runtime({ compactingSince: this.compactingSince })
          return
        }
        if (this.compactingSince === null) return
        this.compactingSince = null
        this.sink.runtime({ compactingSince: undefined })
        if (m.compact_result === 'failed') {
          this.sink.item({
            kind: 'notice',
            id: randomUUID(),
            ts: Date.now(),
            provider: 'claude',
            level: 'warning',
            text: 'Kontext ließ sich nicht zusammenfassen',
            detail: str(m.compact_error),
          })
        }
        return
      }
      case 'compact_boundary': {
        const meta = isPlainObject(m.compact_metadata) ? m.compact_metadata : {}
        const compaction = compactionOf(meta)
        this.sink.item(compactionNotice({ id: str(m.uuid) ?? randomUUID(), ts: Date.now(), provider: 'claude' }, compaction))
        // The result of a /compact reports no usage: the context shrinks here or not until the next turn.
        const after = compaction.after
        if (after !== undefined) this.lastContext = after
        this.compactingSince = null
        const max = this.contextLimit()
        this.sink.runtime({ compactingSince: undefined, ...(after !== undefined && max ? { context: { used: after, window: max } } : {}) })
        return
      }
      case 'api_retry': {
        const attempt = typeof m.attempt === 'number' ? m.attempt : 1
        const max = typeof m.max_retries === 'number' ? m.max_retries : undefined
        this.sink.item({
          kind: 'notice',
          id: 'claude:api-retry',
          ts: Date.now(),
          provider: 'claude',
          level: 'warning',
          text: `API nicht erreichbar, neuer Versuch ${attempt}${max ? ` von ${max}` : ''}`,
          detail: typeof m.error_status === 'number' ? `Status ${m.error_status}` : undefined,
        })
        return
      }
      case 'notification':
        if (typeof m.text === 'string' && m.priority !== 'low') {
          this.sink.item({ kind: 'notice', id: str(m.uuid) ?? randomUUID(), ts: Date.now(), provider: 'claude', level: 'info', text: m.text })
        }
        return
      case 'task_started': {
        const toolId = str(m.tool_use_id)
        if (!toolId || typeof m.task_id !== 'string') return
        this.tasks.set(m.task_id, toolId)
        const tool = this.tools.get(toolId)
        // A shell (Bash, also in the foreground): its process gets an id to read and stop it by.
        if (tool?.kind === 'tool' && (m.task_type === 'local_bash' || tool.tool === 'bash')) {
          const background = m.is_backgrounded === true || (isPlainObject(tool.input) && tool.input.run_in_background === true)
          this.putShell(tool, { taskId: m.task_id, background, status: 'running' })
        }
        // Claude Code runs agents in the background unless told otherwise: its call returns at once
        // („Async agent launched“), the agent works on until its task_notification.
        if (tool?.kind === 'agent' && m.is_backgrounded === true && !tool.background) {
          const next: AgentItem = { ...tool, background: true }
          this.tools.set(tool.id, next)
          this.sink.item(next)
        }
        return
      }
      case 'task_updated': {
        const tool = typeof m.task_id === 'string' ? this.tools.get(this.tasks.get(m.task_id) ?? '') : undefined
        const patch = isPlainObject(m.patch) ? m.patch : {}
        if (tool?.kind !== 'tool' || !tool.shell) return
        const status = shellStatusOf(patch.status)
        if (status && status !== 'running') {
          this.putShell(tool, { ...tool.shell, status, endedAt: tool.shell.endedAt ?? Date.now() })
        } else if (patch.is_backgrounded === true) {
          // Sent to the background: its call returned (and may have looked like its end), the process runs on.
          this.putShell(tool, { ...tool.shell, background: true, status: 'running', endedAt: undefined })
        }
        return
      }
      case 'background_tasks_changed': {
        // The level of what runs in the background: a shell that left it has ended, also when its
        // own notification got lost (that one, if it still comes, tells how).
        if (!Array.isArray(m.tasks)) return
        const live = new Set(m.tasks.filter(isPlainObject).map((t) => str(t.task_id)))
        for (const [, tool] of this.tools) {
          if (tool.kind !== 'tool' || !tool.shell?.background || tool.shell.status !== 'running' || live.has(tool.shell.taskId)) continue
          this.putShell(tool, { ...tool.shell, status: 'done', endedAt: Date.now() })
        }
        // An agent in the background as well.
        for (const [taskId, toolId] of this.tasks) {
          const agent = this.tools.get(toolId)
          if (agent?.kind !== 'agent' || !agent.background || agent.status !== 'running' || live.has(taskId)) continue
          const next: AgentItem = { ...agent, status: 'done', endedAt: Date.now(), activity: undefined }
          this.tools.set(agent.id, next)
          this.sink.item(next)
        }
        return
      }
      case 'task_progress': {
        const toolId = str(m.tool_use_id) ?? (typeof m.task_id === 'string' ? this.tasks.get(m.task_id) : undefined)
        const agent = toolId ? this.tools.get(toolId) : undefined
        if (agent?.kind !== 'agent') return
        const usage = isPlainObject(m.usage) ? m.usage : {}
        const next: AgentItem = {
          ...agent,
          // Its own tool calls (streamed into its thread) say better what it does than the tool's name.
          activity: agent.activity || str(m.summary) || str(m.last_tool_name),
          toolCount: typeof usage.tool_uses === 'number' ? usage.tool_uses : agent.toolCount,
        }
        this.tools.set(agent.id, next)
        this.sink.item(next)
        return
      }
      case 'task_notification': {
        if (typeof m.task_id === 'string' && str(m.output_file)) this.outputFiles.set(m.task_id, m.output_file as string)
        const toolId = str(m.tool_use_id) ?? (typeof m.task_id === 'string' ? this.tasks.get(m.task_id) : undefined)
        const agent = toolId ? this.tools.get(toolId) : undefined
        if (agent?.kind === 'tool' && agent.shell) {
          const status = m.status === 'failed' ? 'error' : m.status === 'stopped' ? 'stopped' : 'done'
          this.putShell(agent, { ...agent.shell, status, endedAt: agent.shell.endedAt ?? Date.now() })
          return
        }
        if (agent?.kind !== 'agent') return
        const status = m.status === 'failed' ? 'error' : m.status === 'stopped' ? 'stopped' : 'done'
        const next: AgentItem = { ...agent, status, result: str(m.summary) ?? agent.result, endedAt: Date.now(), activity: undefined }
        this.tools.set(agent.id, next)
        this.sink.item(next)
        return
      }
    }
  }

  private onResult(m: Json): void {
    const usage = isPlainObject(m.usage) ? m.usage : {}
    const num = (v: unknown) => (typeof v === 'number' ? v : 0)
    const input = num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens)
    const output = num(usage.output_tokens)
    const modelUsage = isPlainObject(m.modelUsage) ? m.modelUsage : {}
    const ofModel = this.model && isPlainObject(modelUsage[this.model]) ? (modelUsage[this.model] as Json) : (Object.values(modelUsage).find(isPlainObject) as Json | undefined)
    const window = ofModel && typeof ofModel.contextWindow === 'number' ? ofModel.contextWindow : undefined
    const failed = m.is_error === true || (typeof m.subtype === 'string' && m.subtype !== 'success')
    const status = this.interrupting ? 'interrupted' : failed ? 'error' : 'done'
    const errorText =
      failed && !this.interrupting
        ? (Array.isArray(m.errors) ? m.errors.filter((e) => typeof e === 'string').join('\n') : '') || str(m.result) || 'Der Turn ist fehlgeschlagen.'
        : undefined
    this.finishStreaming()
    this.cancelInteractions()
    this.sink.item({
      kind: 'turn',
      id: str(m.uuid) ?? randomUUID(),
      ts: Date.now(),
      provider: 'claude',
      status,
      durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : undefined,
      costUsd: typeof m.total_cost_usd === 'number' ? m.total_cost_usd : undefined,
      inputTokens: input,
      outputTokens: output,
      model: this.model,
      error: errorText,
      ...(status === 'error' && this.limitHit ? { limit: true } : {}),
    })
    this.turnStartedAt = null
    this.compactingSince = null
    this.interrupting = false
    this.limitHit = false
    if (window) this.contextWindow = window
    const used = this.lastContext
    const max = this.contextLimit()
    this.sink.runtime({
      status: 'idle',
      turnStartedAt: undefined,
      compactingSince: undefined,
      model: this.model,
      ...(max && used ? { context: { used, window: max } } : {}),
    })
    // Claude Code's own count measures against the window its settings allow (it may compact before
    // the model's is full); it replaces the estimate above a moment later.
    void this.contextDetail()
  }

  private onRateLimit(m: Json): void {
    const info = isPlainObject(m.rate_limit_info) ? m.rate_limit_info : null
    if (!info) return
    const windows: UsageWindow[] = []
    const unified = isPlainObject(info.unifiedWindows) ? info.unifiedWindows : {}
    const labels: Record<string, string> = { five_hour: '5 Stunden', seven_day: 'Woche', seven_day_opus: 'Woche Opus', seven_day_sonnet: 'Woche Sonnet' }
    for (const [key, value] of Object.entries(unified)) {
      if (!isPlainObject(value) || typeof value.utilization !== 'number') continue
      windows.push({
        key,
        label: labels[key] ?? key,
        usedPercent: Math.round(value.utilization * 1000) / 10,
        resetsAt: typeof value.resetsAt === 'number' ? value.resetsAt * 1000 : undefined,
      })
    }
    if (info.status === 'rejected') this.limitHit = true
    if (windows.length === 0) return
    this.sink.usage({ provider: 'claude', windows, limited: info.status === 'rejected', updatedAt: Date.now(), source: 'session' })
  }

  // ------------------------------------------------------------------------------------------
  // Control protocol

  private request(request: Json): Promise<Json> {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.process.write({ type: 'control_request', request_id: id, request })
      } catch (error) {
        this.pending.delete(id)
        reject(error as Error)
      }
    })
  }

  private onControlResponse(m: Json): void {
    const response = isPlainObject(m.response) ? m.response : null
    const id = response ? str(response.request_id) : undefined
    if (!response || !id) return
    const waiter = this.pending.get(id)
    if (!waiter) return
    this.pending.delete(id)
    if (response.subtype === 'error') waiter.reject(new Error(str(response.error) ?? 'Claude Code hat die Anfrage abgelehnt.'))
    else waiter.resolve(isPlainObject(response.response) ? response.response : {})
  }

  private onControlRequest(m: Json): void {
    const requestId = str(m.request_id)
    const request = isPlainObject(m.request) ? m.request : null
    if (!requestId || !request) return
    if (request.subtype === 'can_use_tool') return this.onPermissionRequest(requestId, request)
    if (request.subtype === 'elicitation') return this.onElicitation(requestId, request)
    // Nothing else is announced in `initialize`; answer so Claude Code doesn't wait.
    this.process.write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: 'Wird von Nexa nicht unterstützt.' } })
  }

  private onPermissionRequest(requestId: string, request: Json): void {
    const toolName = str(request.tool_name) ?? 'Werkzeug'
    const input = isPlainObject(request.input) ? request.input : {}
    const toolItemId = str(request.tool_use_id)
    let interaction: InteractionRequest
    if (toolName === 'AskUserQuestion') {
      interaction = { type: 'question', questions: questionsOf(input) }
    } else if (toolName === 'ExitPlanMode') {
      interaction = { type: 'plan', plan: str(input.plan) ?? '' }
    } else {
      const mcp = splitMcpName(toolName)
      const view = viewOfClaudeTool(toolName, input)
      const suggestions = Array.isArray(request.permission_suggestions) ? request.permission_suggestions : []
      const options: PermissionOption[] = [{ id: 'allow', label: 'Erlauben' }]
      if (suggestions.length && request.suppress_always_allow_rule !== true) options.push({ id: 'allow-session', label: 'Für diese Session erlauben' })
      options.push({ id: 'deny', label: 'Ablehnen' })
      interaction = {
        type: 'permission',
        toolName,
        title: str(request.title) ?? (mcp ? `${mcp.server}: ${mcp.tool}` : view.title),
        description: str(request.description),
        detail: view.tool === 'bash' && typeof input.command === 'string' ? input.command : view.detail,
        input,
        changes: view.changes,
        reason: str(request.decision_reason)?.replace(/\u001b\[[0-9;]*m/g, ''),
        options,
      }
    }
    const item: InteractionItem = {
      kind: 'interaction',
      id: `interaction:${requestId}`,
      ts: Date.now(),
      provider: 'claude',
      parentId: toolItemId ? (this.tools.get(toolItemId)?.parentId ?? null) : null,
      request: interaction,
      state: 'pending',
      toolItemId,
    }
    this.interactions.set(item.id, {
      requestId,
      item,
      toolName,
      input,
      suggestions: Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [],
      kind: 'tool',
    })
    this.sink.item(item)
    this.sink.runtime({ status: 'waiting' })
  }

  private onElicitation(requestId: string, request: Json): void {
    const item: InteractionItem = {
      kind: 'interaction',
      id: `interaction:${requestId}`,
      ts: Date.now(),
      provider: 'claude',
      request: {
        type: 'elicitation',
        server: str(request.mcp_server_name) ?? 'MCP',
        message: str(request.message) ?? '',
        schema: isPlainObject(request.requested_schema) ? request.requested_schema : undefined,
        url: str(request.url),
      },
      state: 'pending',
    }
    this.interactions.set(item.id, { requestId, item, toolName: 'elicitation', input: {}, suggestions: [], kind: 'elicitation' })
    this.sink.item(item)
    this.sink.runtime({ status: 'waiting' })
  }

  /**
   * Claude Code takes a question back, e.g. in auto mode once its classifier allowed the tool itself:
   * the turn goes on, so the chat no longer waits for the user.
   */
  private onControlCancel(m: Json): void {
    const requestId = str(m.request_id)
    let cancelled = false
    for (const [id, open] of this.interactions) {
      if (open.requestId !== requestId) continue
      this.interactions.delete(id)
      this.sink.item({ ...open.item, state: 'cancelled' })
      cancelled = true
    }
    if (cancelled) this.questionsSettled()
  }

  /**
   * No question is open any more: the turn goes on, or, when an agent in the background asked after the
   * turn had ended, the chat is at rest again rather than waiting for nobody.
   */
  private questionsSettled(): void {
    if (this.interactions.size > 0) return
    this.sink.runtime({ status: this.turnStartedAt !== null ? 'running' : 'idle' })
  }

  // ------------------------------------------------------------------------------------------

  private turnStarted(): void {
    if (this.turnStartedAt === null) this.turnStartedAt = Date.now()
    this.sink.runtime({ status: 'running', turnStartedAt: this.turnStartedAt, error: undefined })
  }

  /**
   * Claude Code goes on with a turn of its own, without a prompt of Nexa's: once a shell or an agent in
   * the background has ended (`task_notification`), it sends `system/init` and answers, with no
   * `command_lifecycle`. Its first answer in the main thread starts that turn for Nexa as well, else the
   * chat would look at rest while it works, and stay on „wartet“ after a question in it.
   */
  private ownTurn(parentId: string | null): void {
    if (parentId !== null || this.turnStartedAt !== null) return
    if (this.interactions.size === 0) return this.turnStarted()
    // An agent in the background still asks: the chat waits for that answer while the turn runs.
    this.turnStartedAt = Date.now()
    this.sink.runtime({ turnStartedAt: this.turnStartedAt, error: undefined })
  }

  /** Items still streaming when a turn ends are finished as they are. */
  private finishStreaming(): void {
    for (const [, block] of this.blocks) block.done = true
    this.blocks.clear()
    const now = Date.now()
    for (const [id, tool] of this.tools) {
      if (tool.kind === 'tool' && (tool.status === 'running' || tool.status === 'pending')) {
        const next: ToolItem = { ...tool, status: this.interrupting ? 'denied' : 'done', endedAt: now }
        if (next.shell && !next.shell.background && next.shell.status === 'running') {
          next.shell = { ...next.shell, status: this.interrupting ? 'stopped' : 'done', endedAt: now }
        }
        this.tools.set(id, next)
        this.sink.item(next)
      } else if (tool.kind === 'agent' && tool.status === 'running' && !tool.background) {
        const next: AgentItem = { ...tool, status: this.interrupting ? 'stopped' : 'done', endedAt: now, activity: undefined }
        this.tools.set(id, next)
        this.sink.item(next)
      }
    }
  }

  private cancelInteractions(): void {
    for (const [, open] of this.interactions) this.sink.item({ ...open.item, state: 'cancelled' })
    this.interactions.clear()
  }

  private onExit(code: number | null, stderr: string): void {
    for (const [, waiter] of this.pending) waiter.reject(new Error('Claude Code wurde beendet.'))
    this.pending.clear()
    const wasRunning = this.turnStartedAt !== null
    this.finishStreaming()
    this.cancelInteractions()
    // Its shells and agents in the background ran in this process.
    for (const [, tool] of this.tools) {
      if (tool.kind === 'tool' && tool.shell?.status === 'running') this.putShell(tool, { ...tool.shell, status: 'stopped', endedAt: Date.now() })
      if (tool.kind === 'agent' && tool.status === 'running') {
        const next: AgentItem = { ...tool, status: 'stopped', endedAt: Date.now(), activity: undefined }
        this.tools.set(tool.id, next)
        this.sink.item(next)
      }
    }
    this.turnStartedAt = null
    this.compactingSince = null
    const error = this.stopping || code === 0 ? undefined : lastLines(stderr) || `Claude Code wurde beendet (Code ${code ?? 'unbekannt'}).`
    if (error && wasRunning) {
      this.sink.item({ kind: 'notice', id: randomUUID(), ts: Date.now(), provider: 'claude', level: 'error', text: 'Claude Code wurde unerwartet beendet', detail: error })
    }
    this.sink.exited(error)
  }
}

function questionsOf(input: Json): Question[] {
  const questions = Array.isArray(input.questions) ? input.questions.filter(isPlainObject) : []
  return questions.map((q) => ({
    // Claude Code wants the answers keyed by the question's text.
    id: str(q.question) ?? '',
    header: str(q.header) ?? '',
    question: str(q.question) ?? '',
    multiSelect: q.multiSelect === true,
    allowOther: true,
    options: (Array.isArray(q.options) ? q.options.filter(isPlainObject) : []).map((o) => ({
      label: str(o.label) ?? '',
      description: str(o.description),
      preview: str(o.preview),
    })),
  }))
}

/** A task's state in `task_updated` as a shell's; undefined for what isn't one. */
function shellStatusOf(status: unknown): ShellStatus | undefined {
  switch (status) {
    case 'pending':
    case 'running':
    case 'paused':
      return 'running'
    case 'completed':
      return 'done'
    case 'failed':
      return 'error'
    case 'killed':
      return 'stopped'
    default:
      return undefined
  }
}

/** The tokens of one API call in the context: everything sent (cached or not) and the answer. */
export function contextOf(usage: Json): number {
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  return num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens) + num(usage.output_tokens)
}

function lastLines(text: string, count = 6): string {
  return text.split(/\r?\n/).filter((l) => l.trim()).slice(-count).join('\n')
}
