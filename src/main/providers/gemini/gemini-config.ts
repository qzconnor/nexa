import { readFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type {
  CliConfigFile,
  CliConfigScopeInfo,
  HookEventInfo,
  HookGroup,
  HooksSave,
  McpServerConfig,
  McpTransport,
  PermissionField,
  PermissionOption,
  PermissionValue,
} from '@shared/cli-config'
import { folderKey } from '@shared/folders'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import { defaultGeminiHome, geminiDirOf, geminiPaths } from '../../accounts/cli-files'
import { writeJsonAtomic } from '../../lib/json-file'
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
  withHookEvent,
  withoutKeys,
  type CliConfigAdapter,
  type CliConfigContext,
  type CliConfigRead,
  type Json,
} from '../cli-config'

/**
 * Gemini CLI's settings (docs/PROTOCOLS.md, „Einstellungen der CLIs“): MCP servers, permissions and
 * hooks all in one `settings.json`, for the user in the account's `.gemini` and for a project in its
 * `.gemini` folder. Nexa writes the file itself: `gemini mcp add` takes secrets on its command line and
 * cuts variables at a second „=“. Gemini CLI reads the file with comments; Nexa can't keep them, so a
 * file with comments is only shown.
 */

const SCOPES: CliConfigScopeInfo[] = [
  { id: 'user', label: 'Nutzer', description: 'Für alle Projekte dieses Accounts, im Ordner .gemini' },
  { id: 'project', label: 'Projekt', description: 'Für alle, die im Projekt arbeiten (.gemini/settings.json)' },
]

/** Gemini CLI's hook events (0.71.1). Tool events match the tool by a regex, the others an exact source. */
export const GEMINI_HOOK_EVENTS: HookEventInfo[] = [
  { name: 'BeforeTool', description: 'Bevor ein Werkzeug läuft; kann es verhindern oder seine Argumente ändern', matcher: true },
  { name: 'AfterTool', description: 'Nachdem ein Werkzeug lief', matcher: true },
  { name: 'BeforeAgent', description: 'Nach dem Prompt, bevor Gemini plant', matcher: false },
  { name: 'AfterAgent', description: 'Wenn Gemini mit der Antwort fertig ist', matcher: false },
  { name: 'BeforeModel', description: 'Vor jeder Anfrage an das Modell', matcher: false },
  { name: 'AfterModel', description: 'Nach jeder Antwort des Modells', matcher: false },
  { name: 'BeforeToolSelection', description: 'Bevor das Modell Werkzeuge wählt', matcher: false },
  { name: 'SessionStart', description: 'Beim Start, Fortsetzen oder Leeren einer Sitzung (startup, resume, clear)', matcher: true },
  { name: 'SessionEnd', description: 'Am Ende einer Sitzung (exit, clear, logout …)', matcher: true },
  { name: 'PreCompress', description: 'Bevor der Verlauf zusammengefasst wird (auto, manual)', matcher: true },
  { name: 'Notification', description: 'Bei einer Benachrichtigung', matcher: true },
]

const EVENT_NAMES = GEMINI_HOOK_EVENTS.map((e) => e.name)
const TRANSPORTS: McpTransport[] = ['stdio', 'http', 'sse']
const EVENT_RE = /^[A-Za-z]{1,64}$/
/** The keys of a server Nexa edits; `httpUrl` is the old spelling of a Streamable-HTTP address. */
const SERVER_KEYS = ['type', 'command', 'args', 'env', 'url', 'httpUrl', 'headers']
const ENABLEMENT_FILE = 'mcp-server-enablement.json'

const MODES: PermissionOption[] = [
  { value: 'default', label: 'Nachfragen', description: 'Fragt vor Änderungen und Befehlen' },
  { value: 'auto_edit', label: 'Bearbeiten erlauben', description: 'Ändert Dateien ohne Nachfrage' },
  { value: 'plan', label: 'Planen', description: 'Liest nur und schlägt einen Plan vor' },
]

/** Keys of the permission fields → their path in the settings file. */
const PERMISSION_PATHS: Record<string, [string, string]> = {
  'general.defaultApprovalMode': ['general', 'defaultApprovalMode'],
  'tools.allowed': ['tools', 'allowed'],
  'tools.confirmationRequired': ['tools', 'confirmationRequired'],
  'tools.exclude': ['tools', 'exclude'],
  'context.includeDirectories': ['context', 'includeDirectories'],
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
const MS_PER_S = 1000

/** The account's `.gemini` folder: its GEMINI_CLI_HOME, else the one the app was started with. */
function geminiDir(account: AccountEnv): string {
  return geminiDirOf(account.set.GEMINI_CLI_HOME ? resolve(account.set.GEMINI_CLI_HOME) : defaultGeminiHome())
}

/**
 * The files of a scope. `sameAsUser`: the project is the folder whose `.gemini` is the user's (the home
 * directory), so both scopes are one file; Gemini CLI refuses project settings there, too.
 */
export function geminiConfigFiles(account: AccountEnv, scope: CliConfigContext['scope'], folder?: string): { settings: string; enablement: string; sameAsUser: boolean } {
  const dir = geminiDir(account)
  const user = geminiPaths(dir).settingsFile
  const enablement = join(dir, ENABLEMENT_FILE)
  if (scope === 'user') return { settings: user, enablement, sameAsUser: false }
  if (scope !== 'project') throw new Error('Diese Ebene hat Gemini CLI nicht.')
  if (!folder) throw new Error('Für diese Ebene fehlt das Projekt.')
  const settings = join(folder, '.gemini', 'settings.json')
  return { settings, enablement, sameAsUser: folderKey(settings) === folderKey(user) }
}

/**
 * JSON with comments as Gemini CLI reads it (`strip-json-comments`): `//` and `/* *\/` outside strings
 * go. `comments` says whether there were any, because writing the file back would lose them.
 */
export function stripJsonComments(text: string): { text: string; comments: boolean } {
  let out = ''
  let comments = false
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === '"') {
      // A string as it is, escapes included.
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && text[i + 1] === '/') {
      comments = true
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      comments = true
      const end = text.indexOf('*/', i + 2)
      i = end < 0 ? text.length : end + 2
      out += ' '
    } else {
      out += c
      i++
    }
  }
  return { text: out, comments }
}

/** Gemini CLI's settings file: null when it isn't there; one that can't be read is an error, never `{}`. */
export async function readGeminiSettings(file: string): Promise<{ data: Json; comments: boolean } | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (!text.trim()) return { data: {}, comments: false }
  const stripped = stripJsonComments(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped.text)
  } catch {
    throw new Error(`„${basename(file)}“ ist kein gültiges JSON. Nexa ändert die Datei nicht, damit nichts verloren geht.`)
  }
  if (!isPlainObject(parsed)) throw new Error(`„${basename(file)}“ enthält kein JSON-Objekt. Nexa ändert die Datei nicht.`)
  return { data: parsed, comments: stripped.comments }
}

/**
 * A server of Gemini CLI's settings as Nexa shows it. Gemini picks the transport by `httpUrl` (old),
 * then `url` with `type` (`http` or `sse`), then `url` alone (Streamable HTTP), then `command`.
 */
export function geminiServerOut(name: string, raw: unknown, enabled?: boolean): McpServerConfig {
  const entry = isPlainObject(raw) ? raw : {}
  const other = otherKeys(entry, SERVER_KEYS)
  const on = enabled === undefined ? {} : { enabled }
  const httpUrl = str(entry.httpUrl)
  const url = str(entry.url)
  if (httpUrl || url) {
    const type = str(entry.type)
    const server: McpServerConfig = { name, transport: !httpUrl && type === 'sse' ? 'sse' : 'http', url: httpUrl ?? url, headers: entriesOut(entry.headers), ...on, other }
    if (!httpUrl && type && type !== 'http' && type !== 'sse') server.locked = `Server der Art „${type}“ bearbeitet Nexa nicht.`
    return server
  }
  return { name, transport: 'stdio', command: str(entry.command) ?? '', args: strings(entry.args), env: entriesOut(entry.env), ...on, other }
}

/**
 * The entry to save: the edited keys over what the entry had besides (`trust`, `timeout`, `cwd`,
 * tool filters …). A remote server is written as `gemini mcp add` writes it, `url` with `type`; one
 * that has the old `httpUrl` keeps it while it stays Streamable HTTP, so a switch alone changes nothing.
 */
export function geminiServerIn(server: McpServerConfig, current: unknown): Json {
  const base = withoutKeys(current, SERVER_KEYS)
  const before = isPlainObject(current) ? current : {}
  if (server.transport === 'stdio') {
    const env = entriesIn(server.env, before.env)
    const args = (server.args ?? []).filter((a) => a !== '')
    return { command: server.command?.trim(), ...(args.length ? { args } : {}), ...(env ? { env } : {}), ...base }
  }
  const headers = entriesIn(server.headers, before.headers)
  const address = server.transport === 'http' && str(before.httpUrl) ? { httpUrl: server.url?.trim() } : { url: server.url?.trim(), type: server.transport }
  return { ...address, ...(headers ? { headers } : {}), ...base }
}

/** Gemini CLI keys its switches by the server's name in lower case (`normalizeServerId`). */
const enablementKey = (name: string) => name.toLowerCase().trim()

/** Whether a server is on by `mcp-server-enablement.json`: on unless it says `enabled: false`. */
export function geminiServerEnabled(enablement: Json | null, name: string): boolean {
  const state = enablement?.[enablementKey(name)]
  return !(isPlainObject(state) && state.enabled === false)
}

export function geminiPermissionFields(settings: Json | null): PermissionField[] {
  const at = (group: string, key: string): unknown => {
    const holder = settings?.[group]
    return isPlainObject(holder) ? holder[key] : undefined
  }
  const mode = str(at('general', 'defaultApprovalMode')) ?? null
  const options = mode && !MODES.some((m) => m.value === mode) ? [...MODES, { value: mode, label: mode }] : MODES
  return [
    {
      kind: 'select',
      key: 'general.defaultApprovalMode',
      label: 'Modus',
      description: 'Womit Gemini CLI im Terminal startet; „Volle Rechte“ (YOLO) gibt es nur beim Start. In Nexa gibt der Freigabemodus des Chats den Modus vor.',
      options,
      value: mode,
      unsetLabel: 'Nicht festgelegt',
    },
    {
      kind: 'list',
      key: 'tools.allowed',
      label: 'Ohne Rückfrage',
      description: 'Werkzeuge und Befehle, die ohne Rückfrage laufen, auch in Nexa.',
      placeholder: 'z. B. run_shell_command(git status) oder read_file',
      value: strings(at('tools', 'allowed')),
    },
    {
      kind: 'list',
      key: 'tools.confirmationRequired',
      label: 'Immer fragen',
      description: 'Fragt immer nach, auch wenn eine andere Regel es erlauben würde.',
      placeholder: 'z. B. run_shell_command(git push)',
      value: strings(at('tools', 'confirmationRequired')),
    },
    {
      kind: 'list',
      key: 'tools.exclude',
      label: 'Ausschließen',
      description: 'Werkzeuge, die Gemini gar nicht bekommt.',
      placeholder: 'z. B. web_fetch',
      value: strings(at('tools', 'exclude')),
    },
    {
      kind: 'list',
      key: 'context.includeDirectories',
      label: 'Weitere Ordner',
      description: 'Ordner außerhalb des Projekts, die zum Arbeitsbereich gehören.',
      placeholder: 'z. B. ../gemeinsam',
      value: strings(at('context', 'includeDirectories')),
    },
  ]
}

/** The settings file with the permission values set; null or an empty list removes a setting (and an emptied group). */
export function withGeminiPermissions(data: Json, values: Record<string, PermissionValue>): void {
  for (const [key, value] of Object.entries(values)) {
    const path = PERMISSION_PATHS[key]
    if (!path) throw new Error(`Die Einstellung „${key}“ kennt Nexa nicht.`)
    const [group, sub] = path
    const holder: Json = isPlainObject(data[group]) ? { ...data[group] } : {}
    if (key === 'general.defaultApprovalMode') {
      if (typeof value === 'string' && value) holder[sub] = value
      else delete holder[sub]
    } else {
      const list = cleanList(value)
      if (list.length) holder[sub] = list
      else delete holder[sub]
    }
    if (Object.keys(holder).length) data[group] = holder
    else delete data[group]
  }
}

/** The order of keys doesn't make two values different. */
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : isPlainObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}

/** Hook timeouts: Gemini CLI keeps milliseconds, the window shows seconds as for the other CLIs. */
function timeoutsIn(groups: readonly HookGroup[]): HookGroup[] {
  return groups.map((group) => ({
    ...group,
    hooks: group.hooks.map((h) => (h.timeout === undefined || !Number.isFinite(h.timeout) || h.timeout <= 0 ? h : { ...h, timeout: Math.round(h.timeout * MS_PER_S) })),
  }))
}

export class GeminiConfig implements CliConfigAdapter {
  readonly scopes = SCOPES
  readonly transports: McpTransport[] = TRANSPORTS

  async read(ctx: CliConfigContext): Promise<CliConfigRead> {
    const files = geminiConfigFiles(ctx.account, ctx.scope, ctx.folder)
    const problems: string[] = []
    let switches = ''
    const [read, enablement] = await Promise.all([
      readGeminiSettings(files.settings).catch((error: Error) => {
        problems.push(error.message)
        return null
      }),
      readJsonFile(files.enablement).catch(() => {
        // Gemini CLI starts no server while it can't read this file; Nexa shows no switches then.
        switches = `„${ENABLEMENT_FILE}“ ist kein gültiges JSON: Gemini CLI startet dann keinen MCP-Server. `
        return undefined
      }),
    ])
    const settings = read?.data ?? null
    if (files.sameAsUser) problems.push('Im Benutzerordner sind Projekt- und Nutzer-Einstellungen dieselbe Datei. Bearbeite sie unter „Nutzer“.')
    else if (read?.comments) problems.push('Die Datei enthält Kommentare, die Nexa beim Speichern verlieren würde. Bearbeite sie selbst („Öffnen“) oder nimm die Kommentare heraus.')
    const servers = settings && isPlainObject(settings.mcpServers) ? settings.mcpServers : {}
    const hooksConfig = settings && isPlainObject(settings.hooksConfig) ? settings.hooksConfig : {}
    const listed: CliConfigFile[] = [
      { label: 'MCP-Server, Berechtigungen und Hooks', path: files.settings, exists: read !== null },
      { label: 'MCP-Server ein- und ausgeschaltet (für den Account)', path: files.enablement, exists: enablement !== null },
    ]
    return {
      files: listed,
      readOnly: problems.length ? problems.join(' ') : undefined,
      mcp: {
        servers: Object.entries(servers).map(([name, raw]) => geminiServerOut(name, raw, enablement === undefined ? undefined : geminiServerEnabled(enablement, name))),
        transports: this.transports,
        note:
          switches +
          'Ein- und Ausschalten gilt für den ganzen Account, auch für Server desselben Namens in anderen Projekten. ' +
          (ctx.scope === 'project' ? 'Gemini CLI lädt die Einstellungen eines Projekts nur in einem vertrauten Ordner (in Nexa immer). ' : '') +
          'Neue Server gelten ab dem nächsten Start der CLI („Chat neu starten“).',
      },
      permissions: { fields: geminiPermissionFields(settings) },
      hooks: {
        events: GEMINI_HOOK_EVENTS,
        configs: hookConfigsOut(settings?.hooks, EVENT_NAMES).map((config) => ({
          ...config,
          groups: config.groups.map((g) => ({ ...g, hooks: g.hooks.map((h) => (h.timeout === undefined ? h : { ...h, timeout: h.timeout / MS_PER_S })) })),
        })),
        version: versionOf(settings?.hooks),
        trust: false,
        note:
          (hooksConfig.enabled === false ? 'Hooks sind in dieser Datei ausgeschaltet (hooksConfig.enabled). ' : '') +
          'Hooks laufen als Befehl in der Shell, mit deinen Rechten. Laufende Chats übernehmen Änderungen mit „Chat neu starten“.',
      },
    }
  }

  async saveMcpServer(ctx: CliConfigContext, server: McpServerConfig, previousName: string | null): Promise<void> {
    // Gemini's policies read a tool's server up to the first „_“ (mcp_<server>_<tool>); a new name with one would slip through them.
    if (server.name.includes('_') && server.name !== previousName) throw new Error('Gemini CLI verträgt kein „_“ im Namen eines Servers (seine Regeln lesen den Namen nur bis dahin). Nimm „-“.')
    const files = this.files(ctx)
    const current = await readJsonFile(files.settings)
    const servers = current && isPlainObject(current.mcpServers) ? current.mcpServers : {}
    if (server.name !== previousName && servers[server.name] !== undefined) throw new Error(`Einen Server „${server.name}“ gibt es hier schon.`)
    const before = previousName ? servers[previousName] : undefined
    const entry = geminiServerIn(server, before)
    // The switch alone leaves the settings file as it is.
    if (!(previousName === server.name && before !== undefined && sameJson(entry, before))) {
      await updateJsonFile(files.settings, (data) => {
        const now = isPlainObject(data.mcpServers) ? data.mcpServers : {}
        const known = previousName !== null && previousName in now
        // A renamed server keeps its place in the list.
        const next = known ? Object.fromEntries(Object.entries(now).map(([k, v]) => (k === previousName ? [server.name, entry] : [k, v]))) : { ...now, [server.name]: entry }
        data.mcpServers = next
      })
    }
    if (server.enabled !== undefined) await this.setEnabled(files.enablement, server.name, server.enabled, previousName)
  }

  async removeMcpServer(ctx: CliConfigContext, name: string): Promise<void> {
    await updateJsonFile(this.files(ctx).settings, (data) => {
      if (!isPlainObject(data.mcpServers) || !(name in data.mcpServers)) throw new Error(`Den Server „${name}“ gibt es hier nicht mehr.`)
      const rest = { ...data.mcpServers }
      delete rest[name]
      if (Object.keys(rest).length) data.mcpServers = rest
      else delete data.mcpServers
    })
  }

  async savePermissions(ctx: CliConfigContext, values: Record<string, PermissionValue>): Promise<void> {
    const mode = values['general.defaultApprovalMode']
    if (typeof mode === 'string' && mode && !MODES.some((m) => m.value === mode)) throw new Error(`Den Modus „${mode}“ kennt Gemini CLI nicht.`)
    await updateJsonFile(this.files(ctx).settings, (data) => withGeminiPermissions(data, values))
  }

  async saveHooks(ctx: CliConfigContext, save: HooksSave): Promise<void> {
    if (!EVENT_RE.test(save.event)) throw new Error(`„${save.event}“ ist kein Ereignis für Hooks.`)
    await updateJsonFile(this.files(ctx).settings, (data) => {
      if (versionOf(data.hooks) !== save.version) throw new Error('Die Hooks wurden inzwischen außerhalb von Nexa geändert. Bitte neu laden.')
      const groups = hookGroupsIn(timeoutsIn(save.groups), isPlainObject(data.hooks) ? data.hooks[save.event] : undefined)
      const hooks = withHookEvent(data.hooks, save.event, groups)
      if (hooks) data.hooks = hooks
      else delete data.hooks
    })
  }

  /** The files of a scope that may be written: not one scope standing in for the other. */
  private files(ctx: CliConfigContext): ReturnType<typeof geminiConfigFiles> {
    const files = geminiConfigFiles(ctx.account, ctx.scope, ctx.folder)
    if (files.sameAsUser) throw new Error('Im Benutzerordner sind Projekt- und Nutzer-Einstellungen dieselbe Datei. Bearbeite sie unter „Nutzer“.')
    return files
  }

  /**
   * Switches a server as `gemini mcp enable|disable` does: off is `{ enabled: false }` under its name in
   * lower case, on removes the entry. A file Gemini CLI can't read isn't overwritten (it fails closed).
   */
  private async setEnabled(file: string, name: string, enabled: boolean, previousName: string | null): Promise<void> {
    const data = (await readJsonFile(file)) ?? {}
    const next: Json = { ...data }
    if (previousName && previousName !== name) delete next[enablementKey(previousName)]
    if (enabled) delete next[enablementKey(name)]
    else next[enablementKey(name)] = { enabled: false }
    if (!sameJson(next, data)) await writeJsonAtomic(file, next)
  }
}
