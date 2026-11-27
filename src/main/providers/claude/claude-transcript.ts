import { randomUUID } from 'node:crypto'
import type { AgentItem, AgentStatus, ChatItem, ShellStatus, TodoEntry, ToolItem, TurnItem } from '@shared/chat'
import { compactionNotice } from '@shared/chat'
import { renderSpecOf } from '@shared/render'
import { firstLine, isPlainObject } from '@shared/utils'
import { AGENT_TOOLS, ClaudeTasks, HIDDEN_TOOLS, TASK_TOOLS, changesFromResult, compactionOf, resultText, todosOf, viewOfClaudeTool } from './claude-tools'

/**
 * Claude Code's own transcript of a session (`<config>/projects/<key>/<id>.jsonl`) read as Nexa's
 * chat, for sessions that ran without Nexa (in a terminal, in the Claude Manager). It is what the
 * stream of a run would have produced (see ClaudeRun): the same items with the same ids, so a chat
 * read from a transcript goes on with `--resume` as if Nexa had run it. What counts as the user's
 * prompt follows the Claude Manager's conversation view (`readConversation` there).
 */

type Json = Record<string, unknown>

/** Lines never needed: `api-request` lines alone are most of a transcript's bytes. */
const SKIP_PREFIXES = [
  '{"type":"api-request',
  '{"type":"file-history',
  '{"type":"permission-mode"',
  '{"type":"mode"',
  '{"type":"atis-latch"',
  '{"type":"tools-used"',
  '{"type":"queue-operation"',
  '{"type":"cost-state"',
  '{"type":"session-owner"',
  '{"type":"last-prompt"',
  '{"type":"pr-link"',
]

/** What Claude Code puts into a user's message besides what they typed. */
const NOISE_TAGS = [
  'system-reminder',
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'command-message',
  'command-contents',
  'bash-stdout',
  'bash-stderr',
  'user-memory-input',
  // A background task reporting back: Claude Code sends it as a message of the user's.
  'task-notification',
]
const NOISE = new RegExp(`<(${NOISE_TAGS.join('|')})>[\\s\\S]*?</\\1>`, 'g')
/** Pasted text as Claude Code marks it in a prompt (older versions close without the id). */
const PASTED = /<pasted_content id="([^"]*)">\r?\n?([\s\S]*?)\r?\n?<\/pasted_content(?: id="[^"]*")?>/g
const INTERRUPTED = /^\[Request interrupted by user/
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g
const DENIED = /permission|denied|abgelehnt|rejected/i

const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

function time(value: unknown): number | null {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(ms) ? ms : null
}

/** Every JSON line that isn't on the skip list. */
function eachEntry(text: string, onEntry: (entry: Json) => void): void {
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.length < 2 || SKIP_PREFIXES.some((prefix) => line.startsWith(prefix))) continue
    try {
      const entry = JSON.parse(line) as unknown
      if (isPlainObject(entry)) onEntry(entry)
    } catch {
      // A line cut off while it was written.
    }
  }
}

function tagText(raw: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(raw)
  return match ? match[1]! : null
}

/** The text blocks of a message, without images and tool results. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (isPlainObject(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

/** A slash command as typed (`/review 123`); null when the message is none. */
function commandOf(raw: string): string | null {
  const name = tagText(raw, 'command-name')?.trim()
  if (name === undefined) return null
  const args = tagText(raw, 'command-args')?.trim()
  return `${name.startsWith('/') ? name : `/${name}`}${args ? ` ${args}` : ''}`
}

/** What the user typed in a message: their words, a slash command or `! command`; empty for none. */
export function promptOf(content: unknown): string {
  const raw = textOf(content)
  const command = commandOf(raw)
  if (command !== null) return command
  const bash = tagText(raw, 'bash-input')
  if (bash !== null) return `! ${bash.trim()}`
  const text = raw.replace(NOISE, '').replace(PASTED, (_match, _id: string, pasted: string) => pasted).trim()
  return INTERRUPTED.test(text) ? '' : text
}

export interface TranscriptSummary {
  /** Where the session is resumed: where it was moved to last, else where it began. */
  cwd: string | null
  /** The name it was given (`/rename`), else the one Claude Code gave it. */
  title: string | null
  firstPrompt: string | null
  lastPrompt: string | null
  createdAt: number | null
  updatedAt: number | null
  /** Prompts and answers; 0 for a session that never got going. */
  messages: number
}

/** What a list of sessions needs of a transcript, without building its chat. */
export function summarizeClaudeTranscript(text: string): TranscriptSummary {
  let cwd: string | null = null
  let relocated: string | null = null
  let customTitle: string | null = null
  let aiTitle: string | null = null
  let summary: string | null = null
  let firstPrompt: string | null = null
  let lastPrompt: string | null = null
  let createdAt: number | null = null
  let updatedAt: number | null = null
  let prompts = 0
  const answers = new Set<string>()
  eachEntry(text, (e) => {
    const ts = time(e.timestamp)
    if (ts !== null) {
      createdAt ??= ts
      updatedAt = ts
    }
    cwd ??= str(e.cwd) ?? null
    switch (e.type) {
      case 'custom-title':
        customTitle = str(e.customTitle) ?? customTitle
        return
      case 'ai-title':
        aiTitle = str(e.aiTitle) ?? aiTitle
        return
      case 'summary':
        summary = str(e.summary) ?? summary
        return
      case 'relocated':
        relocated = str(e.relocatedCwd) ?? relocated
        return
      case 'user': {
        if (e.isMeta || e.isSidechain || e.isCompactSummary) return
        const prompt = promptOf(isPlainObject(e.message) ? e.message.content : undefined)
        if (!prompt) return
        prompts++
        firstPrompt ??= prompt
        lastPrompt = prompt
        return
      }
      case 'assistant': {
        const message = isPlainObject(e.message) ? e.message : {}
        const id = str(message.id)
        if (!e.isSidechain && id && message.model !== '<synthetic>') answers.add(id)
        return
      }
    }
  })
  return { cwd: relocated ?? cwd, title: customTitle ?? aiTitle ?? summary, firstPrompt, lastPrompt, createdAt, updatedAt, messages: prompts + answers.size }
}

/** A subagent's own transcript (`<id>/subagents/agent-*.jsonl`) and the call that started it. */
export interface SubagentTranscript {
  toolUseId: string
  text: string
}

interface Turn {
  startedAt: number
  inputTokens: number
  outputTokens: number
  model?: string
  interrupted: boolean
  /** Messages whose usage is counted: their blocks come as entries of their own. */
  counted: Set<string>
  /** Something happened in it, so it gets a footer. */
  active: boolean
}

class ChatBuilder {
  readonly items: ChatItem[] = []
  private readonly index = new Map<string, number>()
  /** Items the chat has already (reading on from where it is): found for results, put again when they change. */
  private readonly known = new Map<string, ChatItem>()
  /** Blocks of each message so far: their items are `<message>:<n>`. */
  private readonly blocks = new Map<string, number>()
  private turn: Turn | null = null
  private model: string | undefined
  private lastTs = 0
  /** The user's `! command` whose output comes as an entry of its own. */
  private awaiting: ToolItem | null = null
  /** The list of the task tools (`TaskCreate` & Co.), shown as the chat's todo list. */
  private readonly taskList = new ClaudeTasks()

  get<T extends ChatItem>(id: string): T | undefined {
    const at = this.index.get(id)
    return at === undefined ? (this.known.get(id) as T | undefined) : (this.items[at] as T)
  }

  seed(items: readonly ChatItem[]): void {
    for (const item of items) if (item.kind === 'tool' || item.kind === 'agent' || item.kind === 'todo') this.known.set(item.id, item)
    const todo = this.known.get('todo:main')
    if (todo?.kind === 'todo') this.taskList.seed(todo.entries)
  }

  private putTasks(entries: TodoEntry[] | null, ts: number): void {
    if (entries) this.put({ kind: 'todo', id: 'todo:main', ts, provider: 'claude', entries })
  }

  put(item: ChatItem): void {
    const at = this.index.get(item.id)
    if (at === undefined) {
      this.index.set(item.id, this.items.length)
      this.items.push(item)
    } else this.items[at] = item
  }

  /** One entry of the main transcript (`parentId` null) or of a subagent's. */
  entry(e: Json, parentId: string | null): void {
    if (e.isMeta || (parentId === null && e.isSidechain)) return
    const ts = time(e.timestamp) ?? this.lastTs
    this.lastTs = Math.max(this.lastTs, ts)
    if (e.type === 'user') this.user(e, ts, parentId)
    else if (e.type === 'assistant') this.assistant(e, ts, parentId)
    else if (e.type === 'system' && parentId === null) this.system(e, ts)
  }

  private user(e: Json, ts: number, parentId: string | null): void {
    const message = isPlainObject(e.message) ? e.message : {}
    const content = message.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (isPlainObject(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string') this.result(block, ts, e.toolUseResult)
      }
    }
    // A subagent's only prompt is its task, which its agent item shows.
    if (parentId !== null || e.isCompactSummary) return
    const raw = textOf(content)
    const notice = tagText(raw, 'task-notification')
    if (notice !== null) return this.taskNotification(notice, ts)
    const output = this.commandOutput(raw)
    if (output) return
    if (INTERRUPTED.test(raw.trim())) {
      if (this.turn) this.turn.interrupted = true
      return
    }
    const bash = tagText(raw, 'bash-input')
    if (bash !== null) {
      this.openTurn(ts)
      const tool: ToolItem = {
        kind: 'tool',
        id: str(e.uuid) ?? randomUUID(),
        ts,
        provider: 'claude',
        parentId: null,
        tool: 'bash',
        name: 'Bash',
        title: 'Eigener Befehl',
        detail: firstLine(bash.trim(), 200),
        input: { command: bash.trim() },
        status: 'done',
        startedAt: ts,
        endedAt: ts,
      }
      this.put(tool)
      this.awaiting = tool
      return
    }
    let text = promptOf(content)
    const images = Array.isArray(content) ? content.filter((b) => isPlainObject(b) && b.type === 'image').length : 0
    if (!text && images) text = images > 1 ? `[${images} Bilder]` : '[Bild]'
    if (!text) return
    this.closeTurn()
    this.openTurn(ts)
    this.awaiting = null
    this.put({ kind: 'user', id: str(e.uuid) ?? randomUUID(), ts, provider: 'claude', text })
  }

  /** What a `! command` printed, into its item; true when the entry was such output. */
  private commandOutput(raw: string): boolean {
    const stdout = tagText(raw, 'bash-stdout')
    const stderr = tagText(raw, 'bash-stderr')
    if (stdout === null && stderr === null) return tagText(raw, 'local-command-stdout') !== null || tagText(raw, 'local-command-stderr') !== null
    const clean = (text: string | null) => (text ?? '').replace(ANSI, '').replace(/\s+$/, '')
    const tool = this.awaiting
    if (tool) {
      const output = [clean(stdout), clean(stderr)].filter(Boolean).join('\n')
      this.put({ ...tool, output, status: clean(stderr).trim() ? 'error' : 'done' })
      this.awaiting = null
    }
    return true
  }

  /** `outcome`: the entry's `toolUseResult`, Claude Code's whole result of the call (an edit's patch). */
  private result(block: Json, ts: number, outcome?: unknown): void {
    const known = this.get(block.tool_use_id as string)
    if (!known) return
    const text = resultText(block.content)
    const isError = block.is_error === true
    if (known.kind === 'agent') {
      // A background agent answers at once that it was started; its end comes as a task notification.
      if (!isError && /^Async agent launched/i.test(text.trim())) {
        this.put({ ...known, background: true })
        return
      }
      this.put({ ...known, status: isError ? 'error' : 'done', result: text, endedAt: ts })
      return
    }
    if (known.kind !== 'tool') return
    if (TASK_TOOLS.has(known.name)) this.putTasks(this.taskList.result(known.id, known.name, text, isError, outcome), ts)
    const denied = isError && DENIED.test(text) && text.length < 400
    const next: ToolItem = { ...known, status: denied ? 'denied' : isError ? 'error' : 'done', output: text, endedAt: ts }
    const changes = isError ? null : changesFromResult(known.changes, outcome)
    if (changes) next.changes = changes
    const background = /running in background with ID:\s*(\S+)/i.exec(text)
    if (next.tool === 'bash' && background) next.shell = { taskId: background[1]!, background: true, status: 'stopped' }
    this.put(next)
  }

  /** A background agent or shell reporting its end. */
  private taskNotification(notice: string, ts: number): void {
    const toolId = tagText(notice, 'tool-use-id')?.trim()
    const status = tagText(notice, 'status')?.trim() ?? ''
    const known = toolId ? this.get(toolId) : undefined
    if (known?.kind === 'agent') {
      const ended: AgentStatus = status === 'failed' ? 'error' : status === 'killed' || status === 'stopped' ? 'stopped' : 'done'
      const result = tagText(notice, 'result')?.trim() || tagText(notice, 'summary')?.trim() || known.result
      this.put({ ...known, status: ended, result, endedAt: ts })
    } else if (known?.kind === 'tool' && known.shell) {
      const ended: ShellStatus = status === 'failed' ? 'error' : status === 'killed' || status === 'stopped' ? 'stopped' : 'done'
      this.put({ ...known, shell: { ...known.shell, status: ended, endedAt: ts } })
    }
  }

  private assistant(e: Json, ts: number, parentId: string | null): void {
    const message = isPlainObject(e.message) ? e.message : {}
    // Claude Code's own replies (API errors, „No response requested.“) aren't the model's.
    if (message.model === '<synthetic>') return
    const messageId = str(message.id) ?? str(e.uuid) ?? randomUUID()
    if (parentId === null) {
      const turn = this.openTurn(ts)
      turn.active = true
      if (typeof message.model === 'string') this.model = turn.model = message.model
      const usage = isPlainObject(message.usage) ? message.usage : null
      if (usage && !turn.counted.has(messageId)) {
        turn.counted.add(messageId)
        const num = (v: unknown) => (typeof v === 'number' ? v : 0)
        turn.inputTokens += num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens)
        turn.outputTokens += num(usage.output_tokens)
      }
    }
    if (!Array.isArray(message.content)) return
    for (const block of message.content) {
      if (!isPlainObject(block)) continue
      if (block.type === 'text' || block.type === 'thinking') {
        const text = (block.type === 'text' ? str(block.text) : str(block.thinking)) ?? ''
        if (!text.trim()) continue
        const n = this.blocks.get(messageId) ?? 0
        this.blocks.set(messageId, n + 1)
        const id = `${messageId}:${n}`
        this.put(block.type === 'text' ? { kind: 'assistant', id, ts, provider: 'claude', parentId, text, streaming: false } : { kind: 'thinking', id, ts, provider: 'claude', parentId, text, streaming: false })
      } else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
        this.toolUse(block.id, block.name, isPlainObject(block.input) ? block.input : {}, parentId, ts)
      }
    }
  }

  private toolUse(id: string, name: string, input: Json, parentId: string | null, ts: number): void {
    if (HIDDEN_TOOLS.has(name)) return
    if (AGENT_TOOLS.has(name)) {
      const agent: AgentItem = {
        kind: 'agent',
        id,
        ts,
        provider: 'claude',
        parentId,
        agentType: str(input.subagent_type) ?? 'general-purpose',
        description: str(input.description) ?? 'Subagent',
        prompt: str(input.prompt),
        model: str(input.model),
        background: input.run_in_background === true,
        status: 'running',
        toolCount: 0,
        startedAt: ts,
      }
      this.put(agent)
    } else {
      const view = viewOfClaudeTool(name, input)
      this.put({
        kind: 'tool',
        id,
        ts,
        provider: 'claude',
        parentId,
        tool: view.tool,
        name,
        title: view.title,
        detail: view.detail,
        text: view.text,
        input,
        changes: view.changes,
        server: view.server,
        render: renderSpecOf(view.server, view.shortName, input),
        status: 'running',
        startedAt: ts,
      })
      if (name === 'TodoWrite') {
        const entries = todosOf(input)
        if (entries) this.put({ kind: 'todo', id: `todo:${parentId ?? 'main'}`, ts, provider: 'claude', parentId, entries })
      }
      if (TASK_TOOLS.has(name)) this.putTasks(this.taskList.call(id, name, input), ts)
    }
    const agent = parentId ? this.get(parentId) : undefined
    if (agent?.kind === 'agent') this.put({ ...agent, toolCount: (agent.toolCount ?? 0) + 1 })
  }

  private system(e: Json, ts: number): void {
    if (e.subtype === 'compact_boundary') {
      const meta = isPlainObject(e.compactMetadata) ? e.compactMetadata : isPlainObject(e.compact_metadata) ? e.compact_metadata : {}
      this.put(compactionNotice({ id: str(e.uuid) ?? randomUUID(), ts, provider: 'claude' }, compactionOf(meta)))
    } else if (e.subtype === 'local_command' && typeof e.content === 'string') {
      // Newer versions write slash commands as entries of this kind.
      const command = commandOf(e.content)
      if (command === null) return
      this.closeTurn()
      this.put({ kind: 'user', id: str(e.uuid) ?? randomUUID(), ts, provider: 'claude', text: command })
    } else if (e.subtype === 'turn_duration') {
      this.closeTurn(typeof e.durationMs === 'number' ? e.durationMs : undefined, str(e.uuid))
    }
  }

  private openTurn(ts: number): Turn {
    this.turn ??= { startedAt: ts, inputTokens: 0, outputTokens: 0, model: this.model, interrupted: false, counted: new Set(), active: false }
    return this.turn
  }

  /** The footer of the turn that ran, if one did: how long, how many tokens. */
  closeTurn(durationMs?: number, uuid?: string): void {
    const turn = this.turn
    this.turn = null
    if (!turn?.active) return
    const item: TurnItem = {
      kind: 'turn',
      id: `turn:${uuid ?? randomUUID()}`,
      ts: this.lastTs,
      provider: 'claude',
      status: turn.interrupted ? 'interrupted' : 'done',
      durationMs: durationMs ?? Math.max(0, this.lastTs - turn.startedAt),
      inputTokens: turn.inputTokens || undefined,
      outputTokens: turn.outputTokens || undefined,
      model: turn.model,
    }
    this.put(item)
  }

  /** What still runs at the end of the transcript ran out with its CLI. */
  settle(): void {
    for (const [i, item] of this.items.entries()) {
      if (item.kind === 'agent' && item.status === 'running') this.items[i] = { ...item, status: 'stopped' }
      else if (item.kind === 'tool' && (item.status === 'running' || item.status === 'pending')) this.items[i] = { ...item, status: 'denied' }
    }
  }
}

/** The time of a transcript's first entry, to read subagents in the order they began (nested ones after theirs). */
function startOf(text: string): number {
  const match = /"timestamp":"([^"]+)"/.exec(text.slice(0, 20_000))
  return (match && time(match[1])) ?? Number.MAX_SAFE_INTEGER
}

/**
 * The chat of a Claude Code transcript as Nexa shows it: prompts, answers, thinking, tool calls with
 * their results, subagents with their work (from their own transcripts), compactions and a footer per
 * turn. Subagent entries in the main transcript (older versions) are left out. `known`: the chat's items
 * when it reads on from where the chat is, so later results land on the calls they answer.
 */
export function claudeTranscriptItems(text: string, subagents: readonly SubagentTranscript[] = [], known: readonly ChatItem[] = []): ChatItem[] {
  const chat = new ChatBuilder()
  chat.seed(known)
  eachEntry(text, (e) => chat.entry(e, null))
  chat.closeTurn()
  const ordered = [...subagents].sort((a, b) => startOf(a.text) - startOf(b.text))
  for (const agent of ordered) {
    if (chat.get(agent.toolUseId)?.kind !== 'agent') continue
    eachEntry(agent.text, (e) => chat.entry(e, agent.toolUseId))
  }
  chat.settle()
  return chat.items
}

/** Entries that carry the chat; the rest (titles, bookkeeping) may be written late with older times. */
const CHAT_TYPES = new Set(['user', 'assistant', 'system'])

/** Where a turn of the main thread ends: the model's last answer, an interruption, Claude Code's own mark. */
function endsTurn(e: Json): boolean {
  if (e.isSidechain || e.isMeta) return false
  if (e.type === 'assistant') {
    const reason = isPlainObject(e.message) ? e.message.stop_reason : undefined
    return typeof reason === 'string' && reason !== 'tool_use'
  }
  if (e.type === 'user') return INTERRUPTED.test(textOf(isPlainObject(e.message) ? e.message.content : undefined).trim())
  return e.type === 'system' && e.subtype === 'turn_duration'
}

/**
 * Where a fork of the conversation ends (`--resume-session-at`): the uuid of the main thread's last
 * message from the model that calls no tool. One that calls a tool would leave the call without its
 * result, so a turn cut off in a tool call ends with the text before it. `upTo`: the API's id of a
 * message (`msg_…`) the fork ends with, not later. Null when there is none.
 */
export function forkPoint(text: string, upTo?: string): string | null {
  const lines = text.split('\n')
  let reached = !upTo
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    // Only assistant lines are parsed; the rest of a long transcript isn't worth it.
    if (!line.startsWith('{"') || !line.includes('"assistant"') || (!reached && !line.includes(upTo!))) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!isPlainObject(entry) || entry.type !== 'assistant' || entry.isSidechain || entry.isMeta || !str(entry.uuid)) continue
    if (!reached) {
      if (!isPlainObject(entry.message) || entry.message.id !== upTo) continue
      reached = true
    }
    const content = isPlainObject(entry.message) ? entry.message.content : undefined
    if (Array.isArray(content) && content.some((block) => isPlainObject(block) && block.type === 'tool_use')) continue
    return entry.uuid as string
  }
  return null
}

/**
 * What a transcript gained after `since` (ms), up to the end of its last finished turn: the turns a
 * CLI outside Nexa added, `last` the time to read on from. A turn still at work waits for its end, as
 * its calls would read as cut off. Null when no turn has finished since. Only the tail is parsed.
 * `whole` false: `text` is only the end of the transcript (whole lines); undefined when what came
 * since may begin before it, so the caller reads more.
 */
export function transcriptSince(text: string, since: number, whole = true): { text: string; last: number } | null | undefined {
  const lines = text.split('\n')
  const entries: { at: number; entry: Json | null }[] = []
  let reached = false
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i]!
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.length < 2 || SKIP_PREFIXES.some((prefix) => line.startsWith(prefix))) continue
    let entry: Json | null = null
    try {
      const parsed = JSON.parse(line) as unknown
      if (isPlainObject(parsed)) entry = parsed
    } catch {
      // A line cut off while it was written.
    }
    const ts = entry ? time(entry.timestamp) : null
    if (entry && ts !== null && ts <= since && CHAT_TYPES.has(entry.type as string)) {
      reached = true
      break
    }
    entries.push({ at: i, entry })
  }
  if (!reached && !whole) return undefined
  entries.reverse()
  let end = -1
  let last = since
  for (const [n, { entry }] of entries.entries()) {
    if (!entry || !endsTurn(entry)) continue
    end = n
    last = Math.max(last, time(entry.timestamp) ?? last)
  }
  if (end < 0) return null
  return { text: entries.slice(0, end + 1).map(({ at }) => lines[at]).join('\n'), last }
}
