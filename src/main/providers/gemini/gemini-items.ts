import type { FileChange, PermissionMode, ToolKind } from '@shared/chat'
import { RENDER_SERVER } from '@shared/render'
import { firstLine, isPlainObject } from '@shared/utils'

/**
 * Gemini CLI's ACP messages (`session/update`, `session/request_permission`) in Nexa's terms: pure
 * helpers, the running conversation (gemini-run.ts) puts them together. Protocol: docs/PROTOCOLS.md.
 */

export type Json = Record<string, unknown>

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/** Nexa's permission modes as Gemini CLI's approval modes (ACP mode ids); it has no classifier for `auto`. */
export const GEMINI_MODES: Record<PermissionMode, string> = {
  ask: 'default',
  edits: 'autoEdit',
  plan: 'plan',
  auto: 'autoEdit',
  full: 'yolo',
}

/**
 * The tool's name from Gemini CLI's id of the call: `<name>__<id>` for the model's calls, `<name>-<time>-<n>`
 * for those the ACP session makes up itself.
 */
export function toolNameOf(callId: string): string {
  const at = callId.indexOf('__')
  if (at > 0) return callId.slice(0, at)
  const legacy = /^(.+?)-\d{10,}-\d+$/.exec(callId)
  return legacy ? legacy[1]! : callId
}

/**
 * Server and tool of an MCP tool from Gemini CLI's name `mcp_<server>_<tool>`. The separator is also
 * allowed in names: Nexa's own server is known, others split at the first one.
 */
export function mcpToolOf(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp_')) return null
  const rest = name.slice(4)
  if (rest.startsWith(`${RENDER_SERVER}_`)) return { server: RENDER_SERVER, tool: rest.slice(RENDER_SERVER.length + 1) }
  const at = rest.indexOf('_')
  return at > 0 ? { server: rest.slice(0, at), tool: rest.slice(at + 1) } : { server: rest, tool: rest }
}

/** Gemini CLI's own tools: their icon and title in the chat. */
const TOOLS: Record<string, { tool: ToolKind; title: string }> = {
  run_shell_command: { tool: 'bash', title: 'Befehl ausführen' },
  read_file: { tool: 'read', title: 'Datei lesen' },
  read_many_files: { tool: 'read', title: 'Dateien lesen' },
  write_file: { tool: 'write', title: 'Datei schreiben' },
  replace: { tool: 'edit', title: 'Datei bearbeiten' },
  glob: { tool: 'search', title: 'Dateien suchen' },
  grep_search: { tool: 'search', title: 'Suchen' },
  list_directory: { tool: 'search', title: 'Ordner auflisten' },
  google_web_search: { tool: 'web', title: 'Im Web suchen' },
  web_fetch: { tool: 'web', title: 'Webseite abrufen' },
  // A todo tool's own row hides behind the list; Gemini CLI reports no entries, so it stays a row.
  write_todos: { tool: 'other', title: 'Aufgabenliste' },
  enter_plan_mode: { tool: 'plan', title: 'Plan-Modus' },
  exit_plan_mode: { tool: 'plan', title: 'Plan vorlegen' },
  activate_skill: { tool: 'other', title: 'Skill aktivieren' },
  save_memory: { tool: 'other', title: 'Merken' },
  invoke_agent: { tool: 'other', title: 'Agent' },
}

/** ACP's kinds of tools, for tools Nexa doesn't know by name (extensions, subagents). */
const KINDS: Record<string, ToolKind> = {
  read: 'read',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
  search: 'search',
  execute: 'bash',
  fetch: 'web',
}

/** A path of the call (`locations`), if it names one. */
export function locationOf(locations: unknown): string | undefined {
  const first = Array.isArray(locations) ? locations.find(isPlainObject) : undefined
  return str(first?.path)
}

/** What a tool call shows as its row: icon, title, and its main argument. */
export function toolView(name: string, kind: unknown, title: string | undefined, locations: unknown): { tool: ToolKind; title: string; detail?: string } {
  const known = TOOLS[name]
  const path = locationOf(locations)
  const label = title ? firstLine(title, 200) : undefined
  if (name === 'write_todos') return { ...known!, detail: todoCount(label) }
  if (known) {
    const fileTool = known.tool === 'read' || known.tool === 'write' || known.tool === 'edit'
    return { ...known, detail: fileTool ? (path ?? label) : label }
  }
  return { tool: KINDS[str(kind) ?? ''] ?? 'other', title: label ?? name.replace(/_/g, ' '), detail: path }
}

/** „Set 3 todo(s)“ in words. */
function todoCount(title: string | undefined): string | undefined {
  const count = /^Set (\d+) todo/.exec(title ?? '')?.[1]
  if (count) return count === '1' ? '1 Aufgabe' : `${count} Aufgaben`
  return /^Cleared/.test(title ?? '') ? 'geleert' : title
}

/** The file changes in a call's content (`type: diff`); Gemini CLI sends the whole old and new text. */
export function changesOf(content: unknown): FileChange[] {
  if (!Array.isArray(content)) return []
  return content
    .filter(isPlainObject)
    .filter((c) => c.type === 'diff' && typeof c.path === 'string')
    .map((c) => {
      const meta = isPlainObject(c._meta) ? c._meta : {}
      const oldText = str(c.oldText) ?? ''
      const newText = str(c.newText) ?? ''
      const type = meta.kind === 'add' || (!oldText && meta.kind !== 'delete') ? 'add' : meta.kind === 'delete' ? 'delete' : 'update'
      return { path: c.path as string, type, oldText, newText }
    })
}

/** The text in a call's content (`type: content` with text blocks). */
export function contentText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter(isPlainObject)
    .map((c) => (c.type === 'content' && isPlainObject(c.content) && c.content.type === 'text' ? (str(c.content.text) ?? '') : ''))
    .filter(Boolean)
    .join('\n')
  return text || undefined
}

/**
 * What an error of Gemini CLI says: its messages often wrap the API's answer as JSON in JSON
 * (`{"error":{"message":"{\n \"error\": …"}}`); the innermost message is the one to show.
 */
export function errorText(message: string): string {
  let text = message.trim()
  for (let depth = 0; depth < 5; depth++) {
    if (!/^[[{]/.test(text)) break
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      break
    }
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    const error = isPlainObject(first) && isPlainObject(first.error) ? first.error : null
    const next = str(error?.message) ?? (isPlainObject(first) ? str(first.message) : undefined)
    if (!next || next === text) break
    text = next.trim()
  }
  return text
}

/** The plan file of an `exit_plan_mode` request: its title names it (`Requesting plan approval for: <path>`). */
export function planPathOf(title: string | undefined): string | null {
  const match = /^Requesting plan approval for:\s*(.+)$/.exec(title?.trim() ?? '')
  return match ? match[1]!.trim() : null
}

/** A thought as Gemini CLI words it (`**Subject**\nText`) and its notes about retries. */
export function retryNote(text: string): string | null {
  const match = /^\[Retry (\d+)\/(\d+)\]\s*([\s\S]*?)(?:\. Retrying in \d+s\.\.\.)?$/.exec(text.trim())
  if (match) return `Versuch ${match[1]} von ${match[2]}: ${errorText(match[3] ?? '')}`
  if (/^_\[Stream interrupted\. Retrying response\.\.\.\]_$/.test(text.trim())) return 'Antwort abgebrochen, neuer Versuch'
  return null
}

/** `[MODE_UPDATE] plan`: Gemini CLI reports a change of the approval mode as text of the agent. */
export function modeUpdateOf(text: string): string | null {
  return /^\[MODE_UPDATE\]\s+(\S+)\s*$/.exec(text)?.[1] ?? null
}

/** Nexa's choices for a permission, from the options Gemini CLI offers. */
export function permissionChoices(options: unknown): { allow: string | null; session: string | null; deny: string | null } {
  const list = Array.isArray(options) ? options.filter(isPlainObject) : []
  const id = (o: Json | undefined) => str(o?.optionId) ?? null
  const always = list.filter((o) => o.kind === 'allow_always' && o.optionId !== 'proceed_always_and_save')
  return {
    allow: id(list.find((o) => o.kind === 'allow_once')),
    // For an MCP tool: this tool, not the whole server.
    session: id(always.find((o) => o.optionId === 'proceed_always_tool') ?? always.find((o) => o.optionId === 'proceed_always') ?? always[0]),
    deny: id(list.find((o) => o.kind === 'reject_once' || o.kind === 'reject_always')),
  }
}

/** The MCP server and tool a permission is about (`_meta['gemini-cli'].mcp`). */
export function permissionMcp(toolCall: Json): { server: string; tool: string } | null {
  const meta = isPlainObject(toolCall._meta) ? toolCall._meta : {}
  const gemini = isPlainObject(meta['gemini-cli']) ? meta['gemini-cli'] : {}
  const mcp = isPlainObject(gemini.mcp) ? gemini.mcp : null
  const server = str(mcp?.server_name)
  const tool = str(mcp?.tool_name)
  return server && tool ? { server, tool } : null
}

/** The commands Gemini CLI runs itself in an ACP session (`available_commands_update`). */
export function commandsOf(list: unknown): { name: string; description?: string }[] {
  return (Array.isArray(list) ? list.filter(isPlainObject) : [])
    .filter((c) => typeof c.name === 'string' && c.name.trim())
    .map((c) => ({ name: (c.name as string).trim(), description: str(c.description) }))
}

/** The models of a session (`models.availableModels`). */
export function modelsOf(models: unknown): { id: string; label: string; description?: string }[] {
  const list = isPlainObject(models) && Array.isArray(models.availableModels) ? models.availableModels.filter(isPlainObject) : []
  return list.filter((m) => typeof m.modelId === 'string').map((m) => ({ id: m.modelId as string, label: str(m.name) ?? (m.modelId as string), description: str(m.description) }))
}

/** `gemini --list-models`: `<id> (<name>)` and an indented description below. */
export function parseModelList(output: string): { id: string; label: string; description?: string }[] {
  const models: { id: string; label: string; description?: string }[] = []
  for (const line of output.split(/\r?\n/)) {
    const head = /^(\S+) \((.+)\)\s*$/.exec(line)
    if (head) {
      models.push({ id: head[1]!, label: head[1] === 'auto' ? 'Auto' : head[2]! })
      continue
    }
    const description = /^\s+Description:\s*(.+)$/.exec(line)
    if (description && models.length) models[models.length - 1]!.description = description[1]!.trim()
  }
  return models
}
