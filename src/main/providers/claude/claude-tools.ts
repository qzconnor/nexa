import type { Compaction, FileChange, TodoEntry, ToolKind } from '@shared/chat'
import { renderSpecOf } from '@shared/render'
import { firstLine, isPlainObject } from '@shared/utils'

/** How a tool of Claude Code is shown: kind, label and its main argument. */
export interface ToolView {
  tool: ToolKind
  title: string
  detail?: string
  /** Text the call hands on, shown as text rather than inside its input. */
  text?: string
  changes?: FileChange[]
  server?: string
  /** The tool's short name without the MCP prefix. */
  shortName: string
}

/** Tools that start a subagent. */
export const AGENT_TOOLS = new Set(['Task', 'Agent'])

/**
 * Calls the chat leaves out: a subagent handing back its report (`SubagentHandback`) would show it
 * twice, since it is the subagent's result on its card as well.
 */
export const HIDDEN_TOOLS = new Set(['SubagentHandback'])

const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/**
 * The changes of an Edit, MultiEdit or Write as its result reports them (`tool_use_result` in the stream,
 * `toolUseResult` in the transcript): `structuredPatch` holds the hunks with the file's own line
 * numbers, where the call's old and new text only count from their own first line. One change for the
 * file, also for several edits in it. Null when the result has no patch (a failed call, or a new file,
 * whose lines count from 1 anyway).
 */
export function changesFromResult(changes: readonly FileChange[] | undefined, result: unknown): FileChange[] | null {
  if (!changes?.length || !isPlainObject(result) || !Array.isArray(result.structuredPatch)) return null
  const hunks: string[] = []
  for (const hunk of result.structuredPatch) {
    if (!isPlainObject(hunk) || !Array.isArray(hunk.lines)) continue
    const { oldStart, oldLines, newStart, newLines } = hunk
    if (![oldStart, oldLines, newStart, newLines].every((n) => typeof n === 'number')) continue
    const lines = hunk.lines.filter((line): line is string => typeof line === 'string')
    hunks.push([`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`, ...lines].join('\n'))
  }
  if (hunks.length === 0) return null
  const path = s(result.filePath) ?? changes[0]!.path
  return [{ path, type: result.type === 'create' ? 'add' : 'update', diff: hunks.join('\n') }]
}

/** `mcp__server__tool` → server and tool. Server names may contain underscores, tools rarely two. */
export function splitMcpName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const sep = rest.indexOf('__')
  if (sep < 0) return null
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) }
}

export function viewOfClaudeTool(name: string, input: unknown): ToolView {
  const i = isPlainObject(input) ? input : {}
  const path = s(i.file_path) ?? s(i.notebook_path) ?? s(i.path)
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { tool: 'bash', title: s(i.description) ?? 'Befehl ausführen', detail: firstLine(s(i.command) ?? '', 200), shortName: name }
    case 'BashOutput':
    case 'Monitor':
      return { tool: 'bash', title: 'Ausgabe lesen', detail: s(i.bash_id) ?? s(i.shell_id), shortName: name }
    case 'KillShell':
    case 'KillBash':
      return { tool: 'bash', title: 'Prozess beenden', shortName: name }
    case 'Read':
      return { tool: 'read', title: 'Datei lesen', detail: path, shortName: name }
    case 'Edit':
      return {
        tool: 'edit',
        title: 'Datei bearbeiten',
        detail: path,
        changes: path ? [{ path, type: 'update', oldText: s(i.old_string) ?? '', newText: s(i.new_string) ?? '' }] : undefined,
        shortName: name,
      }
    case 'MultiEdit': {
      const edits = Array.isArray(i.edits) ? i.edits.filter(isPlainObject) : []
      return {
        tool: 'edit',
        title: 'Datei bearbeiten',
        detail: path,
        changes: path ? edits.map((e) => ({ path, type: 'update' as const, oldText: s(e.old_string) ?? '', newText: s(e.new_string) ?? '' })) : undefined,
        shortName: name,
      }
    }
    case 'Write':
      return {
        tool: 'write',
        title: 'Datei schreiben',
        detail: path,
        changes: path ? [{ path, type: 'add', newText: typeof i.content === 'string' ? i.content : '' }] : undefined,
        shortName: name,
      }
    case 'NotebookEdit':
      return { tool: 'edit', title: 'Notebook bearbeiten', detail: path, shortName: name }
    case 'Glob':
      return { tool: 'search', title: 'Dateien suchen', detail: s(i.pattern), shortName: name }
    case 'Grep':
      return { tool: 'search', title: 'Im Code suchen', detail: s(i.pattern), shortName: name }
    case 'LS':
      return { tool: 'search', title: 'Ordner auflisten', detail: path, shortName: name }
    case 'WebFetch':
      return { tool: 'web', title: 'Seite abrufen', detail: s(i.url), shortName: name }
    case 'WebSearch':
      return { tool: 'web', title: 'Im Web suchen', detail: s(i.query), shortName: name }
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
    case 'TaskList':
    case 'TaskGet':
      return { tool: 'todo', title: 'Aufgaben aktualisieren', shortName: name }
    case 'AskUserQuestion':
      return { tool: 'question', title: 'Rückfrage', shortName: name }
    case 'ExitPlanMode':
      return { tool: 'plan', title: 'Plan vorlegen', shortName: name }
    case 'EnterPlanMode':
      return { tool: 'plan', title: 'Planmodus', shortName: name }
    case 'Skill':
      return { tool: 'other', title: 'Skill', detail: s(i.skill) ?? s(i.command), shortName: name }
    case 'SlashCommand':
      return { tool: 'other', title: 'Befehl', detail: s(i.command), shortName: name }
    case 'ToolSearch':
      return { tool: 'search', title: 'Werkzeuge laden', detail: s(i.query), shortName: name }
    case 'ListMcpResourcesTool':
      return { tool: 'mcp', title: 'MCP-Ressourcen auflisten', detail: s(i.server), shortName: name }
    case 'ReadMcpResourceTool':
      return { tool: 'mcp', title: 'MCP-Ressource lesen', detail: s(i.uri), shortName: name }
    case 'TaskOutput':
    case 'AgentOutput':
      return { tool: 'other', title: 'Ausgabe abrufen', detail: s(i.task_id) ?? s(i.agent_id), shortName: name }
    case 'TaskStop':
    case 'KillTask':
      return { tool: 'other', title: 'Aufgabe beenden', detail: s(i.task_id), shortName: name }
    case 'SendMessage': {
      const to = s(i.to) ?? s(i.recipient)
      return { tool: 'other', title: to ? `Nachricht an ${to}` : 'Nachricht senden', detail: s(i.summary), text: s(i.message), shortName: name }
    }
    case 'ListAgents':
      return { tool: 'other', title: 'Agenten auflisten', shortName: name }
  }
  const mcp = splitMcpName(name)
  if (mcp) {
    const render = renderSpecOf(mcp.server, mcp.tool, input)
    if (render) return { tool: 'render', title: render.type === 'diagram' ? 'Diagramm' : 'Darstellung', server: mcp.server, shortName: mcp.tool }
    return {
      tool: 'mcp',
      title: mcp.tool.replace(/_/g, ' '),
      detail: s(i.url) ?? s(i.query) ?? s(i.path) ?? s(i.name),
      server: mcp.server,
      shortName: mcp.tool,
    }
  }
  return { tool: 'other', title: name, detail: path, shortName: name }
}

/** Todo entries of TodoWrite's input. */
export function todosOf(input: unknown): { text: string; status: 'pending' | 'in_progress' | 'completed'; activeText?: string }[] | null {
  if (!isPlainObject(input) || !Array.isArray(input.todos)) return null
  return input.todos.filter(isPlainObject).map((t) => ({
    text: s(t.content) ?? s(t.subject) ?? '',
    status: t.status === 'in_progress' || t.status === 'completed' ? t.status : 'pending',
    activeText: s(t.activeForm),
  }))
}

const TASK_STATUS = new Set(['pending', 'in_progress', 'completed'])

/**
 * The task list of Claude Code's task tools (`TaskCreate`, `TaskUpdate`, `TaskList`), which newer
 * versions use in place of `TodoWrite`. Unlike that one, a call holds no whole list: a task is
 * created with its subject, gets its id only in the result („Task #3 created successfully: …“) and is
 * changed by that id. One list for the conversation, subagents included: Claude Code keeps one per
 * session, and a subagent's call may change a task of the main thread.
 */
export class ClaudeTasks {
  private list: TodoEntry[] = []
  /** Tasks created by a call whose result (with the id) hasn't come yet, by the call's id. */
  private readonly creating = new Map<string, TodoEntry>()

  /** The list as the chat had it (a restart, reading on): entries with their id. */
  seed(entries: readonly TodoEntry[] | undefined): void {
    if (this.list.length || !entries?.some((e) => e.id)) return
    this.list = entries.filter((e) => e.id).map((e) => ({ ...e }))
  }

  /** A call of one of the task tools; the list when it changed. */
  call(toolId: string, name: string, input: unknown): TodoEntry[] | null {
    const i = isPlainObject(input) ? input : {}
    if (name === 'TaskCreate') {
      const subject = s(i.subject)
      if (!subject) return null
      const entry: TodoEntry = { text: subject, status: 'pending', activeText: s(i.activeForm) }
      this.creating.set(toolId, entry)
      this.list = [...this.list, entry]
      return this.list
    }
    if (name !== 'TaskUpdate') return null
    const id = s(i.taskId) ?? (typeof i.taskId === 'number' ? String(i.taskId) : undefined)
    const at = id ? this.list.findIndex((e) => e.id === id) : -1
    if (at < 0) return null
    if (i.status === 'deleted') {
      this.list = this.list.filter((_, n) => n !== at)
      return this.list
    }
    const old = this.list[at]!
    const entry: TodoEntry = {
      ...old,
      text: s(i.subject) ?? old.text,
      status: typeof i.status === 'string' && TASK_STATUS.has(i.status) ? (i.status as TodoEntry['status']) : old.status,
      activeText: s(i.activeForm) ?? old.activeText,
    }
    this.list = this.list.map((e, n) => (n === at ? entry : e))
    return this.list
  }

  /**
   * The result of a call: a created task's id, or the whole list (`TaskList`). `outcome` is Claude
   * Code's own result of the call (`tool_use_result`), the text what the model reads. The list when it
   * changed.
   */
  result(toolId: string, name: string, text: string, isError: boolean, outcome: unknown): TodoEntry[] | null {
    const created = this.creating.get(toolId)
    if (created) {
      this.creating.delete(toolId)
      const task = isPlainObject(outcome) && isPlainObject(outcome.task) ? outcome.task : null
      const id = idOf(task?.id) ?? /#(\w+)/.exec(text)?.[1]
      if (isError || !id) {
        this.list = this.list.filter((e) => e !== created)
        return isError ? this.list : null
      }
      const entry = { ...created, id }
      this.list = this.list.map((e) => (e === created ? entry : e))
      return null
    }
    if (name !== 'TaskList' || isError) return null
    const tasks = isPlainObject(outcome) && Array.isArray(outcome.tasks) ? outcome.tasks.filter(isPlainObject) : null
    const listed = tasks
      ? tasks.flatMap((t) => {
          const id = idOf(t.id)
          const subject = s(t.subject)
          return id && subject ? [{ id, text: subject, status: t.status }] : []
        })
      : text.split('\n').flatMap((line) => {
          // „#1 [in_progress] Subject [blocked by #2]“
          const m = /^#(\w+) \[(\w+)\] (.+?)(?: \[blocked by [^\]]*\])?$/.exec(line.trim())
          return m ? [{ id: m[1]!, text: m[3]!, status: m[2] }] : []
        })
    if (!listed.length && !/no tasks/i.test(text)) return null
    this.list = listed.map(({ id, text: subject, status }) => ({
      id,
      text: subject,
      status: typeof status === 'string' && TASK_STATUS.has(status) ? (status as TodoEntry['status']) : 'pending',
      activeText: this.list.find((e) => e.id === id)?.activeText,
    }))
    return this.list
  }
}

function idOf(value: unknown): string | undefined {
  return typeof value === 'number' ? String(value) : s(value)
}

/** The task tools that change or show the list of `ClaudeTasks`. */
export const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList'])

/**
 * What a `compact_boundary` says about its compaction: the stream sends `compact_metadata` in
 * snake_case, the transcript `compactMetadata` in camelCase.
 */
export function compactionOf(meta: Record<string, unknown>): Compaction {
  const num = (...keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = meta[key]
      if (typeof value === 'number') return value
    }
    return undefined
  }
  return {
    trigger: meta.trigger === 'manual' ? 'manual' : meta.trigger === 'auto' ? 'auto' : undefined,
    before: num('pre_tokens', 'preTokens'),
    after: num('post_tokens', 'postTokens'),
    durationMs: num('duration_ms', 'durationMs'),
  }
}

/**
 * The text of a tool result's content (a string or content blocks). Claude Code wraps what its own
 * checks refuse (a file not read before writing, an unknown tool) in `<tool_use_error>` for the model;
 * the chat shows the message inside.
 */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return unwrapToolError(content)
  if (!Array.isArray(content)) return ''
  return unwrapToolError(
    content
      .map((block) => (isPlainObject(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n'),
  )
}

function unwrapToolError(text: string): string {
  const wrapped = /^\s*<tool_use_error>([\s\S]*)<\/tool_use_error>\s*$/.exec(text)
  return wrapped ? wrapped[1]!.trim() : text
}
