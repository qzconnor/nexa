/**
 * The chat model every agent CLI is mapped onto. Claude Code (stream-json), Codex (app-server) and
 * Antigravity CLI (Agent Client Protocol) speak different protocols; their providers in
 * `src/main/providers` translate them into these items, so the renderer draws one timeline no matter
 * which CLI produced it, and a session can move from one CLI to another.
 */

export type ProviderId = 'claude' | 'codex' | 'antigravity'
export const PROVIDER_IDS: readonly ProviderId[] = ['claude', 'codex', 'antigravity']

/** How freely the agent may act. Each provider maps it onto its own flags (see providers/*). */
export type PermissionMode = 'ask' | 'edits' | 'plan' | 'auto' | 'full'

export interface ItemBase {
  /** Stable while an item streams and when it is finished: updates replace the item with the same id. */
  id: string
  /** Milliseconds since the epoch, when the item began. */
  ts: number
  provider: ProviderId
  /** The agent item this one belongs to (work of a subagent), null on the main thread. */
  parentId?: string | null
}

export interface UserItem extends ItemBase {
  kind: 'user'
  text: string
  /** Absolute paths of attached images. */
  images?: string[]
  /** Set on the hidden context Nexa sends when a session moves to another CLI. */
  handoff?: boolean
  /**
   * Sent while the agent was at work: it joins the running turn instead of starting one (Codex
   * steers it, Claude Code takes it up at its next step). It stands in the chat where the CLI took it.
   */
  steer?: boolean
  /** Not the user's: the agent of another chat sent it with Nexa's chat tools (main/mcp/chat-tools.ts). */
  from?: ChatOrigin
}

/** The chat a message came from, as it was when it sent it. */
export interface ChatOrigin {
  sessionId: string
  title: string
  provider: ProviderId
}

export interface AssistantItem extends ItemBase {
  kind: 'assistant'
  text: string
  streaming?: boolean
  /** Codex separates commentary between tool calls from its final answer. */
  phase?: 'commentary' | 'final'
}

export interface ThinkingItem extends ItemBase {
  kind: 'thinking'
  text: string
  streaming?: boolean
}

/** What a tool does, for its icon and how its input and output are shown. */
export type ToolKind =
  | 'bash'
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'web'
  | 'mcp'
  | 'todo'
  | 'plan'
  | 'question'
  | 'render'
  | 'image'
  | 'other'

export type ToolStatus = 'pending' | 'running' | 'done' | 'error' | 'denied'

export interface FileChange {
  path: string
  type: 'add' | 'update' | 'delete'
  /** Unified diff, when the CLI reports one (Codex). */
  diff?: string
  /** Replaced and new text of an edit (Claude's Edit tool), or the whole new file (Write). */
  oldText?: string
  newText?: string
  movePath?: string
}

export interface ToolItem extends ItemBase {
  kind: 'tool'
  tool: ToolKind
  /** The CLI's own name of the tool, e.g. `Bash`, `mcp__nexa__render_chart`, `commandExecution`. */
  name: string
  /** Short label for the row, e.g. "Befehl ausführen". */
  title: string
  /** The main argument in one line: command, path, pattern, URL. */
  detail?: string
  input?: unknown
  output?: string
  status: ToolStatus
  changes?: FileChange[]
  /** MCP server of the tool. */
  server?: string
  /** Something Nexa draws in the chat (its own MCP tools). */
  render?: RenderSpec
  exitCode?: number | null
  /** A command the CLI runs as a task of its own (Claude Code's shells): what became of the process. */
  shell?: ShellState
  /**
   * Run by the user with `!` in the composer, by Nexa in the chat's folder rather than by a CLI. Its
   * command and output are kept with secrets masked; the next prompt hands them to the CLI.
   */
  byUser?: boolean
  startedAt: number
  endedAt?: number
}

export type ShellStatus = 'running' | 'done' | 'error' | 'stopped'

/**
 * The process behind a shell command. In the background it outlives its tool call, which returns at
 * once; this tells whether it still runs.
 */
export interface ShellState {
  /** The CLI's id of the task, to read its output and stop it. */
  taskId: string
  /** Started in the background (or sent there later), rather than the tool call waiting for it. */
  background: boolean
  status: ShellStatus
  endedAt?: number
}

export type AgentStatus = 'running' | 'done' | 'error' | 'stopped'

/** A subagent: its own work is in the items whose `parentId` is this item's id. */
export interface AgentItem extends ItemBase {
  kind: 'agent'
  /** Type of agent, e.g. `Explore`, `general-purpose`, or Codex's spawned agent. */
  agentType: string
  description: string
  prompt?: string
  status: AgentStatus
  model?: string
  /** Its final answer. */
  result?: string
  /** What it does right now, e.g. the title of its running tool. */
  activity?: string
  toolCount?: number
  background?: boolean
  startedAt: number
  endedAt?: number
}

export interface PermissionOption {
  id: 'allow' | 'allow-session' | 'deny'
  label: string
}

export interface QuestionOption {
  label: string
  description?: string
  preview?: string
}

export interface Question {
  id: string
  header: string
  question: string
  options: QuestionOption[]
  multiSelect: boolean
  /** A free answer besides the options. */
  allowOther: boolean
  secret?: boolean
}

export type InteractionRequest =
  | {
      type: 'permission'
      toolName: string
      title: string
      description?: string
      /** Command, path or URL the permission is about. */
      detail?: string
      input?: unknown
      changes?: FileChange[]
      reason?: string
      options: PermissionOption[]
    }
  | { type: 'question'; questions: Question[] }
  | { type: 'plan'; plan: string }
  | { type: 'elicitation'; server: string; message: string; schema?: Record<string, unknown>; url?: string }

export type InteractionResponse =
  | { type: 'permission'; decision: PermissionOption['id']; message?: string }
  | { type: 'question'; answers: Record<string, string[]> }
  | { type: 'plan'; approve: boolean; mode?: PermissionMode; feedback?: string }
  | { type: 'elicitation'; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }

/** A question of the agent to the user: answered right in the chat. */
export interface InteractionItem extends ItemBase {
  kind: 'interaction'
  request: InteractionRequest
  state: 'pending' | 'answered' | 'cancelled'
  response?: InteractionResponse
  /** The tool call it is about. */
  toolItemId?: string
}

export interface TodoEntry {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
  /** Shown while the entry is in progress ("Tests werden ausgeführt"). */
  activeText?: string
}

export interface TodoItem extends ItemBase {
  kind: 'todo'
  entries: TodoEntry[]
  explanation?: string
}

export interface NoticeItem extends ItemBase {
  kind: 'notice'
  level: 'info' | 'warning' | 'error'
  text: string
  detail?: string
  /** The CLI compacted the conversation here; `text` and `detail` say so in words as well. */
  compaction?: Compaction
  /** The context was emptied here (`/clear`): what is above it, no CLI knows any more. */
  cleared?: boolean
}

/**
 * A compaction: the CLI replaced the conversation so far with a summary, and from here on knows only
 * that. Each value is set when the CLI reports it (Codex reports neither trigger nor tokens).
 */
export interface Compaction {
  trigger?: 'auto' | 'manual'
  /** Tokens the conversation took up in the context before and after. */
  before?: number
  after?: number
  durationMs?: number
}

/** The notice of a compaction, with its numbers in words for whatever reads only text. */
export function compactionNotice(base: ItemBase, compaction: Compaction): NoticeItem {
  const k = (n: number) => `${Math.round(n / 1000)}k`
  const { before, after } = compaction
  return {
    ...base,
    kind: 'notice',
    level: 'info',
    text: compaction.trigger === 'auto' ? 'Kontext wurde automatisch zusammengefasst' : 'Kontext wurde zusammengefasst',
    detail: before !== undefined ? (after !== undefined ? `${k(before)} → ${k(after)} Tokens` : `${k(before)} Tokens vorher`) : undefined,
    compaction,
  }
}

/** The end of a turn: how long it took and what it cost. */
export interface TurnItem extends ItemBase {
  kind: 'turn'
  status: 'done' | 'error' | 'interrupted'
  durationMs?: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  model?: string
  error?: string
  /** It stopped at a usage limit of the account: the CLI refuses work until the limit resets. */
  limit?: boolean
}

export type ChatItem =
  | UserItem
  | AssistantItem
  | ThinkingItem
  | ToolItem
  | AgentItem
  | InteractionItem
  | TodoItem
  | NoticeItem
  | TurnItem

export type ChatItemKind = ChatItem['kind']

// ---------------------------------------------------------------------------------------------
// Things Nexa draws in the chat: the input of its own MCP tools (src/main/mcp/render-tools.ts).

export interface ChartSeries {
  key: string
  label?: string
}

export type RenderSpec =
  | {
      type: 'chart'
      chart: 'bar' | 'line' | 'area' | 'pie' | 'donut'
      title?: string
      description?: string
      /** Rows of the data; `x` names the column of the categories. */
      data: Record<string, string | number>[]
      x: string
      series: ChartSeries[]
      stacked?: boolean
      unit?: string
    }
  | { type: 'diagram'; title?: string; description?: string; mermaid: string }
  | {
      type: 'table'
      title?: string
      description?: string
      columns: { key: string; label: string; align?: 'left' | 'right' | 'center' }[]
      rows: Record<string, string | number | boolean | null>[]
    }
  | {
      type: 'stats'
      title?: string
      items: { label: string; value: string; hint?: string; trend?: 'up' | 'down' | 'flat' }[]
    }
  | { type: 'callout'; tone: 'info' | 'success' | 'warning' | 'danger'; title?: string; text: string }
  | { type: 'code'; title?: string; language?: string; code: string }

// ---------------------------------------------------------------------------------------------
// Runtime of a session and events from the main process.

export type SessionStatus = 'idle' | 'starting' | 'running' | 'waiting' | 'error' | 'stopped'

export interface ContextUsage {
  /** Tokens the conversation takes up in the model's context. */
  used: number
  window: number
}

/** One kind of what fills the context, as the CLI counts it (Claude Code's `/context`). */
export interface ContextPart {
  /** The CLI's id (`system_prompt`, `messages`, `mcp_tools` …). */
  id: string
  name: string
  tokens: number
  /**
   * `used`: in the context; `deferred`: tools loaded only once searched for, not in it yet; `buffer`:
   * kept free for compacting; `free`: left.
   */
  kind: 'used' | 'deferred' | 'buffer' | 'free'
}

/** Entries behind a part: an MCP server's tools, an agent, a memory file. */
export interface ContextEntry {
  name: string
  tokens: number
  /** How many it stands for (an MCP server's tools). */
  count?: number
  /** Of those, how many are in the context (the others are deferred). */
  loaded?: number
}

/** What the context holds, by kind; asked for when the user looks (the context ring's card). */
export interface ContextDetail {
  used: number
  /** What the context may hold: the model's window, or less where the CLI's settings say so. */
  window: number
  parts: ContextPart[]
  /** At how many tokens the CLI compacts the conversation, if it does. */
  compactAt?: number
  mcpServers?: ContextEntry[]
  agents?: ContextEntry[]
  memoryFiles?: ContextEntry[]
  /** When it was counted. */
  at: number
}

export interface SessionRuntime {
  status: SessionStatus
  /** The CLI process is up (Claude) or the thread is loaded (Codex). */
  connected: boolean
  model?: string
  context?: ContextUsage
  /** Why the session stopped or what failed. */
  error?: string
  /** Since when the current turn runs. */
  turnStartedAt?: number
  /** Since when the CLI compacts the conversation; the turn waits for it. */
  compactingSince?: number
  /**
   * Where else one of the chat's CLI conversations is open right now („Claude Code im Terminal“): both
   * would write to it, each going on from what it knows (Codex refuses Nexa the thread meanwhile).
   * Looked at when the chat opens and the window gets focus.
   */
  openElsewhere?: { provider: ProviderId; where: string }
  /**
   * Prompts sent while the CLI works that it hasn't taken up yet (Claude Code does at its next step,
   * as its own queue): each joins the chat where the CLI takes it, until then it waits below it.
   */
  queued?: UserItem[]
  /** The chat stopped at its account's limit and goes on by itself (main/services/auto-switch.ts). */
  resume?: SessionResume
}

/** When and with which account a chat at its limit goes on: at the first reset of an account it may use. */
export interface SessionResume {
  /** When it goes on; null: no account it may use ever will (all signed out). */
  at: number | null
  /** `at` is a guess: no CLI said when the limit resets. */
  estimated?: boolean
  /** The account it goes on with. */
  accountId: string | null
  /** The user asked for it („Am Reset fortsetzen“); else the automatic account switch waits. */
  byUser: boolean
}

export type SessionEvent =
  | { type: 'item'; sessionId: string; item: ChatItem }
  | { type: 'delta'; sessionId: string; itemId: string; field: 'text' | 'output'; text: string }
  | { type: 'runtime'; sessionId: string; runtime: SessionRuntime }
  /** The chat keeps only its first `length` items: a prompt was edited, what came after it is gone. */
  | { type: 'truncated'; sessionId: string; length: number }

export function isPendingInteraction(item: ChatItem): item is InteractionItem {
  return item.kind === 'interaction' && item.state === 'pending'
}
