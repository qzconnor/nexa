import { randomUUID } from 'node:crypto'
import type { AgentItem, AgentStatus, ChatItem, FileChange, ToolItem, ToolStatus, TurnItem, UserItem } from '@shared/chat'
import { compactionNotice } from '@shared/chat'
import { renderSpecOf } from '@shared/render'
import { firstLine, isPlainObject } from '@shared/utils'

/**
 * Codex's thread items (app-server v2 `ThreadItem`) as Nexa's chat items: the ones that stand on their
 * own. The running thread (codex-run.ts) adds what needs its state, the history of a thread
 * (`codexThreadItems`) the rest.
 */

export type Json = Record<string, unknown>

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

export const COLLAB_TITLES: Record<string, string> = {
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

export function agentStatusOf(status: unknown): AgentStatus | null {
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

/** What a reasoning item says: its summary, else (models that give no summary) its text. */
export function reasoningText(item: Json): string {
  const summary = Array.isArray(item.summary) ? item.summary.filter((s): s is string => typeof s === 'string') : []
  const content = Array.isArray(item.content) ? item.content.filter((s): s is string => typeof s === 'string') : []
  return (summary.length ? summary : content).join('\n\n')
}

/**
 * A thread item as a chat item, finished (`completed`) or under way; null for those Nexa shows
 * otherwise (prompts, subagents, compactions) or not at all. `now`: when the item doesn't say when.
 */
export function codexItem(item: Json, parentId: string | null, completed: boolean, now = Date.now()): ChatItem | null {
  const id = str(item.id)
  if (!id) return null
  const startedAt = typeof item.startedAtMs === 'number' ? item.startedAtMs : now
  const endedAt = completed ? (typeof item.completedAtMs === 'number' ? item.completedAtMs : now) : undefined
  const base = { id, ts: startedAt, provider: 'codex' as const, parentId }
  const tool = (fields: Omit<ToolItem, keyof typeof base | 'kind' | 'startedAt' | 'endedAt'>): ToolItem => ({ ...base, kind: 'tool', ...fields, startedAt, endedAt })
  switch (item.type) {
    case 'agentMessage':
      return {
        ...base,
        kind: 'assistant',
        text: str(item.text) ?? '',
        streaming: !completed,
        phase: item.phase === 'final_answer' ? 'final' : item.phase === 'commentary' ? 'commentary' : undefined,
      }
    case 'reasoning': {
      const text = reasoningText(item)
      return text.trim() ? { ...base, kind: 'thinking', text, streaming: false } : null
    }
    case 'commandExecution': {
      const command = str(item.command) ?? ''
      const view = commandView(command, item.commandActions)
      return tool({
        tool: view.tool,
        name: 'commandExecution',
        title: view.title,
        detail: view.detail,
        input: { command, cwd: item.cwd },
        output: str(item.aggregatedOutput),
        exitCode: typeof item.exitCode === 'number' ? item.exitCode : null,
        status: completed ? (typeof item.exitCode === 'number' && item.exitCode !== 0 ? 'error' : toolStatusOf(item.status)) : 'running',
      })
    }
    case 'fileChange': {
      const changes = changesOf(item.changes)
      return tool({
        tool: changes.every((c) => c.type === 'add') ? 'write' : 'edit',
        name: 'fileChange',
        title: changes.length > 1 ? `${changes.length} Dateien ändern` : 'Datei ändern',
        detail: changes[0]?.path,
        changes,
        status: completed ? toolStatusOf(item.status) : 'running',
      })
    }
    case 'mcpToolCall': {
      const server = str(item.server) ?? 'mcp'
      const name = str(item.tool) ?? 'tool'
      const render = renderSpecOf(server, name, item.arguments)
      return tool({
        tool: render ? 'render' : 'mcp',
        name: `${server}.${name}`,
        title: render ? (render.type === 'diagram' ? 'Diagramm' : 'Darstellung') : name.replace(/_/g, ' '),
        server,
        input: item.arguments,
        render,
        output: mcpResultText(item.result, item.error),
        status: completed ? (isPlainObject(item.error) ? 'error' : toolStatusOf(item.status)) : 'running',
      })
    }
    case 'dynamicToolCall': {
      const name = str(item.tool) ?? 'tool'
      return tool({
        tool: 'other',
        name,
        title: name.replace(/_/g, ' '),
        input: item.arguments,
        status: completed ? (item.success === false ? 'error' : 'done') : 'running',
      })
    }
    case 'webSearch': {
      const action = isPlainObject(item.action) ? item.action : {}
      return tool({
        tool: 'web',
        name: 'webSearch',
        title: 'Im Web suchen',
        detail: str(item.query) ?? str(action.query) ?? str(action.url),
        status: completed ? 'done' : 'running',
      })
    }
    case 'imageView':
      return tool({ tool: 'image', name: 'imageView', title: 'Bild ansehen', detail: str(item.path), status: 'done' })
    case 'enteredReviewMode':
    case 'exitedReviewMode':
      return completed
        ? { ...base, kind: 'notice', level: 'info', text: item.type === 'enteredReviewMode' ? 'Review gestartet' : 'Review beendet', detail: str(item.review) }
        : null
  }
  return null
}

/** The end of a turn as Codex reports it (`turn/completed`, and every turn of a thread's history). */
export function codexTurnItem(turn: Json, fields: Partial<TurnItem> = {}): TurnItem {
  const error = isPlainObject(turn.error) ? turn.error : null
  return {
    kind: 'turn',
    id: `turn:${str(turn.id) ?? randomUUID()}`,
    ts: Date.now(),
    provider: 'codex',
    status: turn.status === 'interrupted' ? 'interrupted' : turn.status === 'failed' ? 'error' : 'done',
    durationMs: typeof turn.durationMs === 'number' ? turn.durationMs : undefined,
    error: error ? (str(error.message) ?? 'Fehler') : undefined,
    ...(error?.codexErrorInfo === 'usageLimitExceeded' ? { limit: true } : {}),
    ...fields,
  }
}

/**
 * The chat of a Codex thread as `thread/read` gives it with its turns: the prompts, what Codex did and
 * said, and the end of every turn. A subagent shows as its call with its last answer; its own thread
 * isn't read.
 */
export function codexThreadItems(thread: Json): ChatItem[] {
  const items: ChatItem[] = []
  const turns = Array.isArray(thread.turns) ? thread.turns.filter(isPlainObject) : []
  let last = typeof thread.createdAt === 'number' ? thread.createdAt * 1000 : 0
  for (const turn of turns) {
    if (typeof turn.startedAt === 'number') last = Math.max(last, turn.startedAt * 1000)
    for (const raw of Array.isArray(turn.items) ? turn.items.filter(isPlainObject) : []) {
      const item = historyItem(raw, last, turn.status === 'interrupted')
      if (!item) continue
      last = Math.max(last, item.ts)
      items.push(item)
    }
    // A turn that still runs (in a terminal, say) has no end yet.
    if (turn.status === 'inProgress') continue
    const ended = typeof turn.completedAt === 'number' ? turn.completedAt * 1000 : last
    last = Math.max(last, ended)
    items.push(codexTurnItem(turn, { ts: ended }))
  }
  return items
}

/**
 * The turns in a thread's history (`codexThreadItems`) that came to it outside Nexa: finished, none of
 * their items known to the chat (Nexa's own carry Codex's ids, all but the prompt), and ended from
 * `since` on, which leaves out what a forked thread copied of the one it came from.
 */
export function codexTurnsFromOutside(items: readonly ChatItem[], known: (id: string) => boolean, since: number): ChatItem[] {
  const found: ChatItem[] = []
  let turn: ChatItem[] = []
  for (const item of items) {
    turn.push(item)
    if (item.kind !== 'turn') continue
    // Codex counts in seconds.
    if (item.ts > since - 1000 && !turn.some((i) => known(i.id))) found.push(...turn)
    turn = []
  }
  // What follows the last turn's end still runs.
  return found
}

function historyItem(raw: Json, at: number, interrupted: boolean): ChatItem | null {
  const id = str(raw.id)
  if (!id) return null
  const ts = typeof raw.startedAtMs === 'number' ? raw.startedAtMs : at
  switch (raw.type) {
    case 'userMessage':
      return userItem(raw, id, ts)
    case 'collabAgentToolCall':
      return collabItem(raw, id, ts)
    case 'contextCompaction': {
      const ended = typeof raw.completedAtMs === 'number' ? raw.completedAtMs : undefined
      return compactionNotice({ id, ts, provider: 'codex' }, { durationMs: ended !== undefined ? ended - ts : undefined })
    }
  }
  const item = codexItem(raw, null, true, ts)
  // What still ran when its turn ended was cut off with it, or finished unreported.
  if (item?.kind === 'tool' && item.status === 'running') return { ...item, status: interrupted ? 'denied' : 'done' }
  return item
}

function userItem(raw: Json, id: string, ts: number): UserItem | null {
  const content = Array.isArray(raw.content) ? raw.content.filter(isPlainObject) : []
  const text = content
    .map((c) => (c.type === 'text' ? (str(c.text) ?? '') : ''))
    .filter(Boolean)
    .join('\n')
  const images = content.flatMap((c) => (c.type === 'localImage' && typeof c.path === 'string' ? [c.path] : []))
  if (!text.trim() && !images.length) return null
  return { kind: 'user', id, ts, provider: 'codex', text, ...(images.length ? { images } : {}) }
}

function collabItem(raw: Json, id: string, ts: number): ChatItem {
  const name = str(raw.tool) ?? ''
  const prompt = str(raw.prompt)
  const endedAt = typeof raw.completedAtMs === 'number' ? raw.completedAtMs : ts
  if (name !== 'spawnAgent') {
    const failed = raw.status === 'failed'
    return { kind: 'tool', id, ts, provider: 'codex', parentId: null, tool: 'other', name, title: COLLAB_TITLES[name] ?? name, detail: prompt ? firstLine(prompt, 120) : undefined, status: failed ? 'error' : 'done', startedAt: ts, endedAt }
  }
  // What the call knew of the agent it started: how it ended and its last message.
  const states = isPlainObject(raw.agentsStates) ? Object.values(raw.agentsStates).filter(isPlainObject) : []
  const state = states[0]
  const status = raw.status === 'failed' ? 'error' : (agentStatusOf(state?.status) ?? 'done')
  const agent: AgentItem = {
    kind: 'agent',
    id,
    ts,
    provider: 'codex',
    parentId: null,
    agentType: 'Codex-Agent',
    description: prompt ? firstLine(prompt, 70) : 'Subagent',
    prompt,
    model: str(raw.model),
    // An agent of the past doesn't run anymore, whatever it last said.
    status: status === 'running' ? 'stopped' : status,
    startedAt: ts,
    endedAt,
    ...(typeof state?.message === 'string' ? { result: state.message } : {}),
  }
  return agent
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
