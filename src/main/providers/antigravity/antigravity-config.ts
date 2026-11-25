import { join } from 'node:path'
import type {
  CliConfigFile,
  CliConfigScopeInfo,
  HookEventConfig,
  HookEventInfo,
  HooksSave,
  McpServerConfig,
  McpTransport,
  PermissionField,
  PermissionOption,
  PermissionValue,
} from '@shared/cli-config'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import { antigravityPaths, defaultAntigravityDir } from '../../accounts/cli-files'
import {
  cleanList,
  entriesIn,
  entriesOut,
  hookConfigsOut,
  hookGroupsIn,
  otherKeys,
  readJsonFile,
  updateJsonFile,
  versionOf,
  withoutKeys,
  type CliConfigAdapter,
  type CliConfigContext,
  type CliConfigRead,
  type Json,
} from '../cli-config'

/**
 * Antigravity CLI's settings (docs/PROTOCOLS.md, „Einstellungen der CLIs“), each in its own file:
 * MCP servers in `mcp_config.json` and hooks in `hooks.json` (for the user in `<.gemini>/config`, for
 * a project in its `.agents` folder), permissions in the user's `antigravity-cli/settings.json`. Nexa
 * writes the files itself: `agy mcp add` would take secrets on its command line.
 */

const SCOPES: CliConfigScopeInfo[] = [
  { id: 'user', label: 'Nutzer', description: 'Für alle Projekte dieses Accounts (.gemini/config, antigravity-cli/settings.json)' },
  { id: 'project', label: 'Projekt', description: 'Für alle, die im Projekt arbeiten (.agents/mcp_config.json, .agents/hooks.json)' },
]

/** Antigravity's hook events (1.5). Tool events match the tool by a regex; the others have no matcher. */
export const ANTIGRAVITY_HOOK_EVENTS: HookEventInfo[] = [
  { name: 'PreToolUse', description: 'Bevor ein Werkzeug läuft; kann es erlauben, verhindern oder seine Argumente ändern', matcher: true },
  { name: 'PostToolUse', description: 'Nachdem ein Werkzeug lief', matcher: true },
  { name: 'PreInvocation', description: 'Vor jeder Anfrage an das Modell', matcher: false },
  { name: 'PostInvocation', description: 'Nachdem die Werkzeuge einer Antwort liefen', matcher: false },
  { name: 'SessionStart', description: 'Einmal beim Start einer Unterhaltung', matcher: false },
  { name: 'Stop', description: 'Wenn der Agent mit dem Turn fertig ist', matcher: false },
]

const EVENT_NAMES = ANTIGRAVITY_HOOK_EVENTS.map((e) => e.name)
const GROUPED = new Set(ANTIGRAVITY_HOOK_EVENTS.filter((e) => e.matcher).map((e) => e.name))
const TRANSPORTS: McpTransport[] = ['stdio', 'http']
const EVENT_RE = /^[A-Za-z]{1,64}$/
/** The keys of a server Nexa edits; `serverUrl` is the old spelling of `url`. */
const SERVER_KEYS = ['command', 'args', 'env', 'url', 'serverUrl', 'headers', 'disabled']
/** The named hook new hooks of Nexa go to: `hooks.json` keeps hooks by a name each. */
export const NEXA_HOOK = 'nexa'

const MODES: PermissionOption[] = [
  { value: 'default', label: 'Nachfragen', description: 'Fragt vor Änderungen und Befehlen' },
  { value: 'accept-edits', label: 'Bearbeiten erlauben', description: 'Ändert Dateien im Projekt ohne Nachfrage' },
  { value: 'auto', label: 'Automatisch', description: 'Bearbeitet und führt sichere Befehle ohne Nachfrage aus' },
  { value: 'plan', label: 'Planen', description: 'Plant, bevor es etwas ändert' },
]

const TOOL_PERMISSIONS: PermissionOption[] = [
  { value: 'request-review', label: 'Nachfragen', description: 'Fragt vor Schreiben, Befehlen, Web und MCP, außer eine Regel erlaubt es' },
  { value: 'proceed-in-sandbox', label: 'In der Sandbox ohne Nachfrage', description: 'Befehle in der Terminal-Sandbox laufen ohne Nachfrage' },
  { value: 'always-proceed', label: 'Ohne Nachfrage', description: 'Befehle, Web und MCP ohne Nachfrage, außer eine Regel fragt' },
  { value: 'strict', label: 'Streng', description: 'Fragt vor jeder Aktion, auch vor dem Lesen' },
]

const LISTS: Record<string, { label: string; description: string; placeholder: string }> = {
  'permissions.allow': { label: 'Ohne Rückfrage', description: 'Regeln wie command(git status), die ohne Rückfrage laufen, auch in Nexa.', placeholder: 'z. B. command(git status) oder read_url(github.com)' },
  'permissions.ask': { label: 'Immer fragen', description: 'Fragt immer nach, auch wenn eine andere Regel es erlauben würde.', placeholder: 'z. B. command(git push)' },
  'permissions.deny': { label: 'Verbieten', description: 'Gilt in jedem Modus, auch mit vollen Rechten.', placeholder: 'z. B. write_file(.env)' },
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

/** The account's `.gemini` folder: its own (`--gemini-dir`), else the CLI's. */
function dirOf(account: AccountEnv): string {
  return account.dir ?? defaultAntigravityDir()
}

/** The files of a scope; a project has no settings file of its own Nexa knows. */
export function antigravityConfigFiles(account: AccountEnv, scope: CliConfigContext['scope'], folder?: string): { mcp: string; hooks: string; settings: string | null } {
  if (scope === 'user') {
    const paths = antigravityPaths(dirOf(account))
    return { mcp: paths.mcpFile, hooks: paths.hooksFile, settings: paths.settingsFile }
  }
  if (scope !== 'project') throw new Error('Diese Ebene hat Antigravity CLI nicht.')
  if (!folder) throw new Error('Für diese Ebene fehlt das Projekt.')
  return { mcp: join(folder, '.agents', 'mcp_config.json'), hooks: join(folder, '.agents', 'hooks.json'), settings: null }
}

/** A server of `mcp_config.json` as Nexa shows it: a remote one by `url` (or `serverUrl`), else a command. */
export function antigravityServerOut(name: string, raw: unknown): McpServerConfig {
  const entry = isPlainObject(raw) ? raw : {}
  const other = otherKeys(entry, SERVER_KEYS)
  const enabled = entry.disabled !== true
  const url = str(entry.url) ?? str(entry.serverUrl)
  if (url) return { name, transport: 'http', url, headers: entriesOut(entry.headers), enabled, other }
  return { name, transport: 'stdio', command: str(entry.command) ?? '', args: strings(entry.args), env: entriesOut(entry.env), enabled, other }
}

/** The entry to save: the edited keys over what it had besides (`cwd`, `variables`, tool filters …). */
export function antigravityServerIn(server: McpServerConfig, current: unknown): Json {
  const base = withoutKeys(current, SERVER_KEYS)
  const before = isPlainObject(current) ? current : {}
  const off = server.enabled === false ? { disabled: true } : {}
  if (server.transport === 'stdio') {
    const env = entriesIn(server.env, before.env)
    const args = (server.args ?? []).filter((a) => a !== '')
    return { command: server.command?.trim(), ...(args.length ? { args } : {}), ...(env ? { env } : {}), ...base, ...off }
  }
  if (server.transport !== 'http') throw new Error('Antigravity CLI kennt nur Server mit Befehl oder Streamable-HTTP-Adresse.')
  const headers = entriesIn(server.headers, before.headers)
  return { url: server.url?.trim(), ...(headers ? { headers } : {}), ...base, ...off }
}

export function antigravityPermissionFields(settings: Json | null): PermissionField[] {
  const select = (key: string, label: string, description: string, options: PermissionOption[], unsetLabel: string, raw: unknown): PermissionField => {
    // The default mode is an empty text in the file.
    const value = key === 'agentMode' && raw === '' ? 'default' : (str(raw) ?? null)
    const all = value && !options.some((o) => o.value === value) ? [...options, { value, label: value }] : options
    return { kind: 'select', key, label, description, options: all, value, unsetLabel }
  }
  const rules = isPlainObject(settings?.permissions) ? settings.permissions : {}
  return [
    select(
      'agentMode',
      'Modus',
      'Womit Antigravity CLI im Terminal startet. In Nexa gibt der Freigabemodus des Chats den Modus vor.',
      MODES,
      'Nicht festgelegt (Automatisch, wo verfügbar)',
      settings?.agentMode,
    ),
    select('toolPermission', 'Werkzeuge', 'Wann Antigravity außerhalb des automatischen Modus nachfragt.', TOOL_PERMISSIONS, 'Nicht festgelegt (Nachfragen)', settings?.toolPermission),
    {
      kind: 'toggle',
      key: 'allowNonWorkspaceAccess',
      label: 'Dateien außerhalb des Projekts',
      description: 'Lässt den Agenten Dateien außerhalb der Projektordner lesen und bearbeiten, nach den Regeln oben.',
      value: typeof settings?.allowNonWorkspaceAccess === 'boolean' ? settings.allowNonWorkspaceAccess : null,
    },
    ...Object.entries(LISTS).map(([key, field]): PermissionField => ({ kind: 'list', key, ...field, value: strings(rules[key.slice('permissions.'.length)]) })),
  ]
}

/** The settings file with the permission values set; null or an empty list removes a setting. */
export function withAntigravityPermissions(data: Json, values: Record<string, PermissionValue>): void {
  for (const [key, value] of Object.entries(values)) {
    if (key === 'agentMode' || key === 'toolPermission') {
      const options = key === 'agentMode' ? MODES : TOOL_PERMISSIONS
      if (typeof value === 'string' && value) {
        if (!options.some((o) => o.value === value)) throw new Error(`„${value}“ kennt Antigravity CLI nicht.`)
        data[key] = key === 'agentMode' && value === 'default' ? '' : value
      } else delete data[key]
    } else if (key === 'allowNonWorkspaceAccess') {
      if (typeof value === 'boolean') data[key] = value
      else delete data[key]
    } else if (key in LISTS) {
      const rules: Json = isPlainObject(data.permissions) ? { ...data.permissions } : {}
      const list = cleanList(value)
      const sub = key.slice('permissions.'.length)
      if (list.length) rules[sub] = list
      else delete rules[sub]
      if (Object.keys(rules).length) data.permissions = rules
      else delete data.permissions
    } else throw new Error(`Die Einstellung „${key}“ kennt Nexa nicht.`)
  }
}

// ---------------------------------------------------------------------------------------------
// Hooks: `{ <name>: { enabled?, <Event>: [...] } }`. Tool events hold groups (`matcher`, `hooks`),
// the others their handlers directly.

/** Where a group Nexa shows comes from: a named hook, and for a tool event its group there. */
interface Slot {
  hook: string
  group: number | null
}

/** The groups of an event over all named hooks, in Nexa's form (`{ matcher, hooks }`), and where each comes from. */
export function hookSlots(file: Json | null, event: string): { groups: Json[]; slots: Slot[] } {
  const groups: Json[] = []
  const slots: Slot[] = []
  for (const [hook, spec] of Object.entries(file ?? {})) {
    if (!isPlainObject(spec) || !Array.isArray(spec[event])) continue
    const list = spec[event] as unknown[]
    if (GROUPED.has(event)) {
      list.forEach((group, index) => {
        groups.push(isPlainObject(group) ? group : {})
        slots.push({ hook, group: index })
      })
    } else if (list.length) {
      groups.push({ hooks: list })
      slots.push({ hook, group: null })
    }
  }
  return { groups, slots }
}

/** The hooks of `hooks.json` by event, the named hooks' groups one after another. */
export function antigravityHooksOut(file: Json | null): HookEventConfig[] {
  const events = new Set<string>(EVENT_NAMES)
  for (const spec of Object.values(file ?? {})) if (isPlainObject(spec)) for (const [key, value] of Object.entries(spec)) if (Array.isArray(value)) events.add(key)
  const merged: Json = {}
  for (const event of events) {
    const { groups } = hookSlots(file, event)
    if (groups.length) merged[event] = groups
  }
  return hookConfigsOut(merged, EVENT_NAMES)
}

/**
 * `hooks.json` with one event's groups replaced: each group goes back to the named hook it came from,
 * a new one to Nexa's own (`nexa`). A named hook left without any event goes.
 */
export function withAntigravityHooks(file: Json, save: HooksSave): Json {
  const { groups: before, slots } = hookSlots(file, save.event)
  const next: Json = {}
  for (const [hook, spec] of Object.entries(file)) {
    if (!isPlainObject(spec)) next[hook] = spec
    else next[hook] = withoutKeys(spec, [save.event])
  }
  const grouped = GROUPED.has(save.event)
  for (const group of save.groups) {
    const [json] = hookGroupsIn([group], before)
    if (!json) continue
    const hook = group.origin !== undefined && slots[group.origin] ? slots[group.origin]!.hook : NEXA_HOOK
    const spec: Json = isPlainObject(next[hook]) ? (next[hook] as Json) : {}
    const list = Array.isArray(spec[save.event]) ? (spec[save.event] as unknown[]) : []
    if (grouped) list.push({ matcher: str(json.matcher) ?? '*', ...withoutKeys(json, ['matcher']) })
    else list.push(...(Array.isArray(json.hooks) ? json.hooks : []))
    next[hook] = { ...spec, [save.event]: list }
  }
  for (const [hook, spec] of Object.entries(next)) {
    const had = isPlainObject(file[hook]) && Array.isArray((file[hook] as Json)[save.event])
    if (had && isPlainObject(spec) && !Object.values(spec).some(Array.isArray)) delete next[hook]
  }
  return next
}

export class AntigravityConfig implements CliConfigAdapter {
  readonly scopes = SCOPES
  readonly transports: McpTransport[] = TRANSPORTS

  async read(ctx: CliConfigContext): Promise<CliConfigRead> {
    const files = antigravityConfigFiles(ctx.account, ctx.scope, ctx.folder)
    const problems: string[] = []
    const safely = (file: string | null) =>
      file
        ? readJsonFile(file).catch((error: Error) => {
            problems.push(error.message)
            return null
          })
        : Promise.resolve(null)
    const [mcp, hooks, settings] = await Promise.all([safely(files.mcp), safely(files.hooks), safely(files.settings)])
    const servers = mcp && isPlainObject(mcp.mcpServers) ? mcp.mcpServers : {}
    const off = Object.entries(hooks ?? {})
      .filter(([, spec]) => isPlainObject(spec) && spec.enabled === false)
      .map(([name]) => `„${name}“`)
    const listed: CliConfigFile[] = [
      { label: 'MCP-Server', path: files.mcp, exists: mcp !== null },
      { label: 'Hooks', path: files.hooks, exists: hooks !== null },
      ...(files.settings ? [{ label: 'Berechtigungen', path: files.settings, exists: settings !== null }] : []),
    ]
    return {
      files: listed,
      readOnly: problems.length ? problems.join(' ') : undefined,
      mcp: {
        servers: Object.entries(servers).map(([name, raw]) => antigravityServerOut(name, raw)),
        transports: this.transports,
        note:
          'Haben Nutzer und Projekt einen Server desselben Namens, behält ihn der zuerst gestartete. ' +
          'Neue Server gelten ab dem nächsten Start der CLI („Chat neu starten“).',
      },
      permissions: files.settings
        ? { fields: antigravityPermissionFields(settings) }
        : { fields: [], note: 'Regeln für ein Projekt legt Antigravity CLI selbst an (/permissions im Terminal). Nexa bearbeitet die Regeln des Nutzers.' },
      hooks: {
        events: ANTIGRAVITY_HOOK_EVENTS,
        configs: antigravityHooksOut(hooks),
        version: versionOf(hooks),
        trust: false,
        note:
          (off.length ? `Ausgeschaltet (enabled: false): ${off.join(', ')}. ` : '') +
          'Hooks laufen als Befehl in der Shell (Windows: cmd /c), mit deinen Rechten, im Ordner der hooks.json. Neue landen unter dem Namen „nexa“. Laufende Chats übernehmen Änderungen mit „Chat neu starten“.',
      },
    }
  }

  async saveMcpServer(ctx: CliConfigContext, server: McpServerConfig, previousName: string | null): Promise<void> {
    const file = antigravityConfigFiles(ctx.account, ctx.scope, ctx.folder).mcp
    await updateJsonFile(file, (data) => {
      const now = isPlainObject(data.mcpServers) ? data.mcpServers : {}
      if (server.name !== previousName && now[server.name] !== undefined) throw new Error(`Einen Server „${server.name}“ gibt es hier schon.`)
      const entry = antigravityServerIn(server, previousName ? now[previousName] : undefined)
      const known = previousName !== null && previousName in now
      // A renamed server keeps its place in the list.
      data.mcpServers = known ? Object.fromEntries(Object.entries(now).map(([k, v]) => (k === previousName ? [server.name, entry] : [k, v]))) : { ...now, [server.name]: entry }
    })
  }

  async removeMcpServer(ctx: CliConfigContext, name: string): Promise<void> {
    await updateJsonFile(antigravityConfigFiles(ctx.account, ctx.scope, ctx.folder).mcp, (data) => {
      if (!isPlainObject(data.mcpServers) || !(name in data.mcpServers)) throw new Error(`Den Server „${name}“ gibt es hier nicht mehr.`)
      const rest = { ...data.mcpServers }
      delete rest[name]
      data.mcpServers = rest
    })
  }

  async savePermissions(ctx: CliConfigContext, values: Record<string, PermissionValue>): Promise<void> {
    const file = antigravityConfigFiles(ctx.account, ctx.scope, ctx.folder).settings
    if (!file) throw new Error('Regeln für ein Projekt bearbeitet Nexa bei Antigravity CLI nicht.')
    await updateJsonFile(file, (data) => withAntigravityPermissions(data, values))
  }

  async saveHooks(ctx: CliConfigContext, save: HooksSave): Promise<void> {
    if (!EVENT_RE.test(save.event)) throw new Error(`„${save.event}“ ist kein Ereignis für Hooks.`)
    const file = antigravityConfigFiles(ctx.account, ctx.scope, ctx.folder).hooks
    await updateJsonFile(file, (data) => {
      if (versionOf(Object.keys(data).length ? data : null) !== save.version && versionOf(data) !== save.version) {
        throw new Error('Die Hooks wurden inzwischen außerhalb von Nexa geändert. Bitte neu laden.')
      }
      const next = withAntigravityHooks(data, save)
      for (const key of Object.keys(data)) delete data[key]
      Object.assign(data, next)
    })
  }
}
