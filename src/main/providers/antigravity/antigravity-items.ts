import type { FileChange, PermissionMode, TodoEntry, ToolKind } from '@shared/chat'
import type { ModelOption, UsageWindow } from '@shared/types'
import { RENDER_SERVER } from '@shared/render'
import { firstLine, isPlainObject } from '@shared/utils'

/**
 * Antigravity CLI's ACP messages (`session/update`, `session/request_permission`) in Nexa's terms:
 * pure helpers, the running conversation (antigravity-run.ts) puts them together. Protocol:
 * docs/PROTOCOLS.md.
 */

export type Json = Record<string, unknown>

export const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

/**
 * Nexa's permission modes as Antigravity's modes (ACP mode ids). `full` has no mode of its own: the
 * process starts with `--dangerously-skip-permissions` and runs in `auto` meanwhile.
 */
export const ANTIGRAVITY_MODES: Record<PermissionMode, string> = {
  ask: 'default',
  edits: 'accept-edits',
  plan: 'plan',
  auto: 'auto',
  full: 'auto',
}

/** The levels of thought Antigravity appends to a model's id (`gemini-4-hydrogen-high`). */
const LEVELS = ['low', 'medium', 'high', 'xhigh']

/** What precedes an error of the agent that Antigravity sends as text of its answer. */
export const EXECUTOR_ERROR = '⚠ agent executor error:'

/**
 * A path as Antigravity reports it: on Windows its updates write `/F:/dir/file`, and its answers link
 * `file:///F:/…`.
 */
export function pathOf(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  let path = raw.startsWith('file://') ? decodeURI(raw.slice('file://'.length)) : raw
  if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1)
  return path
}

/**
 * Server and tool of an MCP tool. Antigravity names a client's MCP tools `<server>_<tool>` with
 * `mcp_` in front or not, depending on where they come from; Nexa's own server is known, others split
 * at the first separator.
 */
export function mcpToolOf(name: string, servers: readonly string[] = [RENDER_SERVER]): { server: string; tool: string } | null {
  const rest = name.replace(/^mcp__?/, '')
  for (const server of servers) {
    for (const sep of ['__', '_', '/', '.']) {
      if (rest.startsWith(`${server}${sep}`)) return { server, tool: rest.slice(server.length + sep.length) }
    }
  }
  if (!name.startsWith('mcp_')) return null
  const at = rest.search(/__|_/)
  return at > 0 ? { server: rest.slice(0, at), tool: rest.slice(at).replace(/^__?/, '') } : { server: rest, tool: rest }
}

/** Antigravity's own tools: their icon and title in the chat. */
const TOOLS: Record<string, { tool: ToolKind; title: string }> = {
  run_command: { tool: 'bash', title: 'Befehl ausführen' },
  command_status: { tool: 'bash', title: 'Befehl prüfen' },
  send_command_input: { tool: 'bash', title: 'Eingabe an Befehl' },
  read_file: { tool: 'read', title: 'Datei lesen' },
  view_file: { tool: 'read', title: 'Datei lesen' },
  view_file_outline: { tool: 'read', title: 'Datei überblicken' },
  write_file: { tool: 'write', title: 'Datei schreiben' },
  write_to_file: { tool: 'write', title: 'Datei schreiben' },
  edit_file: { tool: 'edit', title: 'Datei bearbeiten' },
  replace_file_content: { tool: 'edit', title: 'Datei bearbeiten' },
  multi_replace_file_content: { tool: 'edit', title: 'Datei bearbeiten' },
  list_dir: { tool: 'search', title: 'Ordner auflisten' },
  list_directory: { tool: 'search', title: 'Ordner auflisten' },
  find_by_name: { tool: 'search', title: 'Dateien suchen' },
  grep_search: { tool: 'search', title: 'Suchen' },
  codebase_search: { tool: 'search', title: 'Im Code suchen' },
  search_web: { tool: 'web', title: 'Im Web suchen' },
  read_url_content: { tool: 'web', title: 'Webseite abrufen' },
  update_steps: { tool: 'other', title: 'Aufgabenliste' },
}

/** ACP's kinds of tools, for tools Nexa doesn't know by name (plugins, subagents, the browser). */
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
  return pathOf(str(first?.path))
}

/** What a tool call shows as its row: icon, title, and its main argument. */
export function toolView(name: string, args: Json, kind: unknown, title: string | undefined, locations: unknown): { tool: ToolKind; title: string; detail?: string } {
  const known = TOOLS[name]
  const path = pathOf(str(args.Path) ?? str(args.AbsolutePath) ?? str(args.TargetFile)) ?? locationOf(locations)
  const label = title ? firstLine(title, 200) : undefined
  if (known?.tool === 'bash') return { ...known, detail: firstLine(str(args.CommandLine) ?? label ?? '', 200) || undefined }
  if (known) {
    const fileTool = known.tool === 'read' || known.tool === 'write' || known.tool === 'edit'
    return { ...known, detail: fileTool ? (path ?? label) : (str(args.Query) ?? str(args.Url) ?? label) }
  }
  return { tool: KINDS[str(kind) ?? ''] ?? 'other', title: label ?? name.replace(/_/g, ' '), detail: path }
}

/** The steps of `update_steps` as Nexa's todo list. */
export function stepsOf(args: Json): TodoEntry[] | null {
  if (!Array.isArray(args.steps)) return null
  return args.steps.filter(isPlainObject).map((s) => ({
    text: str(s.title) ?? str(s.content) ?? '',
    status: s.status === 'done' || s.status === 'completed' ? 'completed' : s.status === 'in_progress' ? 'in_progress' : 'pending',
  }))
}

/** The file changes in a call's content (`type: diff`): the whole old and new text, or the replaced part. */
export function changesOf(content: unknown): FileChange[] {
  if (!Array.isArray(content)) return []
  return content
    .filter(isPlainObject)
    .filter((c) => c.type === 'diff' && typeof c.path === 'string')
    .map((c) => {
      const oldText = str(c.oldText) ?? ''
      const newText = str(c.newText) ?? ''
      return { path: pathOf(c.path as string)!, type: oldText ? 'update' : 'add', oldText, newText }
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
 * A command's output without what Antigravity puts before it (`Created At …`, `Command exited with
 * code 0.`, `Command output:`); its exit code, if it names one.
 */
export function commandOutput(text: string): { output: string; exitCode?: number } {
  const code = /Command exited with code (-?\d+)/.exec(text)?.[1]
  const at = text.indexOf('Command output:\n')
  const output = at >= 0 ? text.slice(at + 'Command output:\n'.length) : text
  return { output: output.replace(/\r\n/g, '\n').replace(/\n+$/, ''), exitCode: code === undefined ? undefined : Number(code) }
}

/**
 * The plan of a call: in plan mode Antigravity writes it as an artifact (`implementation_plan.md`) it
 * asks feedback for, and ends its turn.
 */
export function planOf(name: string, args: Json): string | null {
  if (name !== 'write_file' && name !== 'write_to_file') return null
  const meta = isPlainObject(args.ArtifactMetadata) ? args.ArtifactMetadata : null
  if (!meta || meta.RequestFeedback !== true) return null
  const content = str(args.Content) ?? str(args.CodeContent)
  return content?.trim() ? content : null
}

/** Nexa's choices for a permission, from the options Antigravity offers. */
export function permissionChoices(options: unknown): { allow: string | null; session: string | null; deny: string | null } {
  const list = Array.isArray(options) ? options.filter(isPlainObject) : []
  const id = (o: Json | undefined) => str(o?.optionId) ?? null
  return {
    allow: id(list.find((o) => o.kind === 'allow_once')),
    session: id(list.find((o) => o.kind === 'allow_always')),
    deny: id(list.find((o) => o.kind === 'reject_once') ?? list.find((o) => o.kind === 'reject_always')),
  }
}

/** The commands Antigravity runs itself in an ACP session (`available_commands_update`). */
export function commandsOf(list: unknown): { name: string; description?: string }[] {
  return (Array.isArray(list) ? list.filter(isPlainObject) : [])
    .filter((c) => typeof c.name === 'string' && c.name.trim())
    .map((c) => ({ name: (c.name as string).trim(), description: str(c.description) }))
}

/** A select of the session's `configOptions` (`model`, `thought_level`, `mode`). */
export function configOf(options: unknown, id: string): { value?: string; values: { value: string; name: string; description?: string }[] } {
  const option = (Array.isArray(options) ? options.filter(isPlainObject) : []).find((o) => o.id === id)
  const values = (Array.isArray(option?.options) ? option.options.filter(isPlainObject) : [])
    .filter((o) => typeof o.value === 'string')
    .map((o) => ({ value: o.value as string, name: str(o.name) ?? (o.value as string), description: str(o.description) }))
  return { value: str(option?.currentValue), values }
}

/**
 * The models of a session. `configOptions.model` names each model once; `models.availableModels`
 * names it per level of thought (`gemini-4-hydrogen-high`), which are its efforts. The current one's
 * level is its default.
 */
export function modelsOf(configOptions: unknown, models: unknown): ModelOption[] {
  const model = configOf(configOptions, 'model')
  const level = configOf(configOptions, 'thought_level').value
  const ids = isPlainObject(models) && Array.isArray(models.availableModels) ? models.availableModels.filter(isPlainObject).map((m) => str(m.modelId) ?? '') : []
  return model.values.map((m) => {
    const efforts = LEVELS.filter((l) => ids.includes(`${m.value}-${l}`))
    const option: ModelOption = { id: m.value, label: m.name, description: m.description, isDefault: m.value === model.value }
    if (efforts.length) {
      option.efforts = efforts
      if (m.value === model.value && level && efforts.includes(level)) option.defaultEffort = level
    }
    return option
  })
}

/** The plan of the login (`_meta.antigravity.tier.name` of `session/new`, e.g. „Antigravity Starter Quota“). */
export function tierOf(meta: unknown): string | undefined {
  const antigravity = isPlainObject(meta) && isPlainObject(meta.antigravity) ? meta.antigravity : null
  return isPlainObject(antigravity?.tier) ? str(antigravity.tier.name) : undefined
}

/** A bucket's `window` as minutes: `5h`, `weekly`, `daily`; undefined for one Nexa doesn't know. */
function windowMinutes(window: string | undefined): number | undefined {
  if (window === 'weekly') return 7 * 24 * 60
  if (window === 'daily') return 24 * 60
  const match = /^(\d+)([hm])$/.exec(window ?? '')
  return match ? Number(match[1]) * (match[2] === 'h' ? 60 : 1) : undefined
}

function windowLabel(minutes: number | undefined, name: string): string {
  if (minutes === 7 * 24 * 60) return 'Woche'
  if (minutes === 24 * 60) return 'Tag'
  if (minutes && minutes % 60 === 0) return minutes === 60 ? '1 Stunde' : `${minutes / 60} Stunden`
  return minutes ? `${minutes} min` : name
}

/** „Claude and GPT models“ → „Claude/GPT“: the group's name, short enough for the title bar. */
function groupLabel(name: string): string {
  return name.replace(/\s+models?$/i, '').replace(/\s+and\s+/gi, '/').trim() || name
}

/** „Models within this group: Claude Sonnet 4.6, GPT-OSS 120B“ → the names; none without the colon. */
function groupModels(description: string | undefined): string[] | undefined {
  const at = description?.indexOf(':') ?? -1
  if (!description || at < 0) return undefined
  const names = description
    .slice(at + 1)
    .split(',')
    .map((name) => name.trim().replace(/\.$/, ''))
    .filter(Boolean)
  return names.length ? names : undefined
}

/**
 * The quota of the login, as `agy -p "/usage" --output-format json` tells it (`command.data`): groups
 * of models that share their limits, each with its buckets (`remaining_fraction`, `reset_time`; a
 * bucket nobody used yet resets at the epoch) and its models in its description. As Nexa's windows
 * `<group> · <window>`, the shorter window of a group first. Null when the output names no bucket.
 */
export function usageOfQuota(output: unknown): { windows: UsageWindow[]; limited: boolean } | null {
  const command = isPlainObject(output) && isPlainObject(output.command) ? output.command : null
  const data = isPlainObject(command?.data) ? command.data : null
  const groups = Array.isArray(data?.groups) ? data.groups.filter(isPlainObject) : []
  const windows: UsageWindow[] = []
  for (const group of groups) {
    const name = groupLabel(str(group.name) ?? '')
    const models = groupModels(str(group.description))
    const buckets = Array.isArray(group.buckets) ? group.buckets.filter(isPlainObject) : []
    const own: UsageWindow[] = []
    for (const bucket of buckets) {
      // Antigravity shows a disabled bucket dimmed, without a bar: it limits nothing.
      if (bucket.disabled === true || typeof bucket.remaining_fraction !== 'number') continue
      const minutes = windowMinutes(str(bucket.window))
      const reset = Date.parse(str(bucket.reset_time) ?? '')
      own.push({
        key: str(bucket.id) ?? `${name}:${str(bucket.window) ?? own.length}`,
        label: name ? `${name} · ${windowLabel(minutes, str(bucket.name) ?? '')}` : windowLabel(minutes, str(bucket.name) ?? ''),
        usedPercent: Math.min(100, Math.max(0, Math.round((1 - bucket.remaining_fraction) * 1000) / 10)),
        resetsAt: Number.isFinite(reset) && reset > 0 ? reset : undefined,
        windowMinutes: minutes,
        ...(models ? { models } : {}),
      })
    }
    own.sort((a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity))
    windows.push(...own)
  }
  return windows.length ? { windows, limited: windows.some((w) => w.usedPercent >= 100) } : null
}

/**
 * An error that says the login's quota (or its AI credits) is used up: „You have exhausted your quota
 * on this model.“, „individual quota reached“, `RESOURCE_EXHAUSTED`, „Your AI credits balance is too
 * low to continue.“ (strings of agy 1.5.17). The model's capacity running out is no limit of the account.
 */
export function isQuotaError(text: string): boolean {
  return /quota|RESOURCE_EXHAUSTED|credits balance is too low/i.test(text) && !/capacity/i.test(text)
}

/** Whether the agent adds to its system prompt (`initialize`: `_meta.antigravity.systemPrompt.append`). */
export function appendsSystemPrompt(capabilities: unknown): boolean {
  const meta = isPlainObject(capabilities) && isPlainObject(capabilities._meta) ? capabilities._meta : null
  const antigravity = isPlainObject(meta?.antigravity) ? meta.antigravity : null
  return isPlainObject(antigravity?.systemPrompt) && antigravity.systemPrompt.append === true
}

/** Whether the agent resumes a conversation without streaming it again (`sessionCapabilities.resume`). */
export function resumesSession(capabilities: unknown): boolean {
  if (!isPlainObject(capabilities)) return false
  const session = isPlainObject(capabilities.sessionCapabilities) ? capabilities.sessionCapabilities : null
  return !!session && session.resume !== undefined && session.resume !== null && session.resume !== false
}
