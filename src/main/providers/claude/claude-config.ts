import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  CliConfigFile,
  CliConfigScopeInfo,
  HookEventInfo,
  HooksSave,
  McpServerConfig,
  McpTransport,
  PermissionField,
  PermissionOption,
  PermissionValue,
} from '@shared/cli-config'
import { folderKey } from '@shared/folders'
import { firstLine, isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import { claudePaths, defaultClaudeConfigDir } from '../../accounts/cli-files'
import { cliEnv, type CliBinary } from '../cli-binary'
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
 * Claude Code's settings (docs/PROTOCOLS.md, „Einstellungen der CLIs“): permissions and hooks in its
 * settings files, MCP servers in `.claude.json` (user, local) and the project's `.mcp.json`. Servers
 * are written by `claude mcp add-json` / `remove`, so Claude Code's own rules and locking apply to
 * `.claude.json`, which it rewrites all the time; the settings files Nexa writes itself.
 */

const SCOPES: CliConfigScopeInfo[] = [
  { id: 'user', label: 'Nutzer', description: 'Für alle Projekte dieses Accounts, im Konfigurationsordner' },
  { id: 'project', label: 'Projekt', description: 'Für alle, die im Projekt arbeiten (wird mit eingecheckt)' },
  { id: 'local', label: 'Lokal', description: 'Nur für dich in diesem Projekt, nicht eingecheckt' },
]

/** Claude Code's hook events (2.1.331), the common ones first. */
export const CLAUDE_HOOK_EVENTS: HookEventInfo[] = [
  { name: 'PreToolUse', description: 'Bevor ein Werkzeug läuft; kann es verhindern', matcher: true },
  { name: 'PostToolUse', description: 'Nachdem ein Werkzeug lief', matcher: true },
  { name: 'PostToolUseFailure', description: 'Nachdem ein Werkzeug fehlschlug', matcher: true },
  { name: 'PermissionRequest', description: 'Wenn Claude um eine Freigabe bittet', matcher: true },
  { name: 'PermissionDenied', description: 'Wenn eine Freigabe abgelehnt wurde', matcher: true },
  { name: 'UserPromptSubmit', description: 'Wenn ein Prompt abgeschickt wird', matcher: false },
  { name: 'Stop', description: 'Wenn Claude mit der Antwort fertig ist', matcher: false },
  { name: 'StopFailure', description: 'Wenn eine Antwort mit einem Fehler endet', matcher: false },
  { name: 'Notification', description: 'Bei einer Benachrichtigung', matcher: true },
  { name: 'SessionStart', description: 'Beim Start oder Fortsetzen einer Sitzung', matcher: true },
  { name: 'SessionEnd', description: 'Am Ende einer Sitzung', matcher: true },
  { name: 'SubagentStart', description: 'Wenn ein Subagent startet', matcher: true },
  { name: 'SubagentStop', description: 'Wenn ein Subagent fertig ist', matcher: true },
  { name: 'PreCompact', description: 'Bevor der Kontext zusammengefasst wird', matcher: true },
  { name: 'PostCompact', description: 'Nachdem der Kontext zusammengefasst wurde', matcher: true },
  { name: 'PostToolBatch', description: 'Nach mehreren Werkzeugen auf einmal', matcher: false },
  { name: 'UserPromptExpansion', description: 'Wenn ein Befehl im Prompt aufgelöst wird', matcher: true },
  { name: 'Setup', description: 'Bei der Einrichtung (--init, --maintenance)', matcher: true },
  { name: 'PreModelSwitch', description: 'Bevor das Modell wechselt', matcher: true },
  { name: 'PostModelSwitch', description: 'Nachdem das Modell gewechselt hat', matcher: true },
  { name: 'Elicitation', description: 'Wenn ein MCP-Server etwas erfragt', matcher: true },
  { name: 'ElicitationResult', description: 'Nach der Antwort auf eine MCP-Frage', matcher: true },
  { name: 'ConfigChange', description: 'Wenn sich Einstellungen ändern', matcher: true },
  { name: 'InstructionsLoaded', description: 'Wenn CLAUDE.md und Regeln geladen werden', matcher: true },
  { name: 'DirectoryAdded', description: 'Wenn ein Ordner dazukommt', matcher: true },
  { name: 'CwdChanged', description: 'Wenn der Arbeitsordner wechselt', matcher: false },
  { name: 'FileChanged', description: 'Wenn sich eine beobachtete Datei ändert', matcher: false },
  { name: 'WorktreeCreate', description: 'Wenn ein Worktree angelegt wird', matcher: false },
  { name: 'WorktreeRemove', description: 'Wenn ein Worktree entfernt wird', matcher: false },
  { name: 'TaskCreated', description: 'Wenn eine Aufgabe angelegt wird', matcher: false },
  { name: 'TaskCompleted', description: 'Wenn eine Aufgabe erledigt ist', matcher: false },
  { name: 'TeammateIdle', description: 'Wenn ein Teammitglied nichts zu tun hat', matcher: false },
  { name: 'MessageDisplay', description: 'Wenn eine Nachricht angezeigt wird', matcher: false },
]

const EVENT_NAMES = CLAUDE_HOOK_EVENTS.map((e) => e.name)
const TRANSPORTS: McpTransport[] = ['stdio', 'http', 'sse']
const EVENT_RE = /^[A-Za-z]{1,64}$/

const MODES: PermissionOption[] = [
  { value: 'default', label: 'Nachfragen', description: 'Fragt vor Änderungen und Befehlen' },
  { value: 'acceptEdits', label: 'Bearbeiten erlauben', description: 'Ändert Dateien ohne Nachfrage' },
  { value: 'plan', label: 'Planen', description: 'Liest nur und schlägt einen Plan vor' },
  { value: 'auto', label: 'Auto', description: 'Ein Klassifikator entscheidet über Freigaben' },
  { value: 'dontAsk', label: 'Nicht fragen', description: 'Lehnt ab, was keine Regel erlaubt' },
  { value: 'bypassPermissions', label: 'Volle Rechte', description: 'Alles ohne Nachfrage' },
]

/** Keys of the permission fields → their key under `permissions`. */
const PERMISSION_KEYS: Record<string, 'defaultMode' | 'allow' | 'ask' | 'deny' | 'additionalDirectories'> = {
  'permissions.defaultMode': 'defaultMode',
  'permissions.allow': 'allow',
  'permissions.ask': 'ask',
  'permissions.deny': 'deny',
  'permissions.additionalDirectories': 'additionalDirectories',
}

const SERVER_KEYS = ['type', 'command', 'args', 'env', 'url', 'headers']

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

/** The files of a scope: settings, and where its MCP servers are (`.claude.json` keys them by project). */
export function claudeConfigFiles(account: AccountEnv, scope: CliConfigContext['scope'], folder?: string): { settings: string; mcp: string; local: boolean } {
  const ownDir = account.set.CLAUDE_CONFIG_DIR
  const paths = claudePaths(ownDir ?? defaultClaudeConfigDir(), !!ownDir || !!process.env.CLAUDE_CONFIG_DIR)
  if (scope === 'user') return { settings: join(paths.configDir, 'settings.json'), mcp: paths.globalConfigFile, local: false }
  if (!folder) throw new Error('Für diese Ebene fehlt das Projekt.')
  if (scope === 'project') return { settings: join(folder, '.claude', 'settings.json'), mcp: join(folder, '.mcp.json'), local: false }
  return { settings: join(folder, '.claude', 'settings.local.json'), mcp: paths.globalConfigFile, local: true }
}

/**
 * A project's entry in `.claude.json`. Claude Code keys it by the folder with forward slashes
 * (`F:/Projekte/app`); older versions wrote backslashes, so any spelling of the folder counts.
 */
export function claudeProjectEntry(config: Json | null, folder: string): Json | null {
  const projects = config && isPlainObject(config.projects) ? config.projects : null
  if (!projects) return null
  const exact = projects[folder.replaceAll('\\', '/')]
  if (isPlainObject(exact)) return exact
  const key = folderKey(folder)
  const found = Object.entries(projects).find(([k, v]) => isPlainObject(v) && folderKey(k) === key)
  return found ? (found[1] as Json) : null
}

/** A server of Claude Code's files as Nexa shows it; `reveal`: with its secrets, for main only. */
export function claudeServerOut(name: string, raw: unknown, reveal = false): McpServerConfig {
  const entry = isPlainObject(raw) ? raw : {}
  const type = str(entry.type) ?? (str(entry.command) ? 'stdio' : 'http')
  if (type === 'stdio') {
    return { name, transport: 'stdio', command: str(entry.command) ?? '', args: strings(entry.args), env: entriesOut(entry.env, reveal), other: otherKeys(entry, SERVER_KEYS) }
  }
  const server: McpServerConfig = { name, transport: type === 'sse' ? 'sse' : 'http', url: str(entry.url) ?? '', headers: entriesOut(entry.headers, reveal), other: otherKeys(entry, SERVER_KEYS) }
  if (type !== 'http' && type !== 'sse') server.locked = `Server der Art „${type}“ bearbeitet Nexa nicht.`
  return server
}

/** The entry `claude mcp add-json` gets: the edited keys over what the entry had besides. */
export function claudeServerIn(server: McpServerConfig, current: unknown): Json {
  const base = withoutKeys(current, SERVER_KEYS)
  const before = isPlainObject(current) ? current : {}
  if (server.transport === 'stdio') {
    const env = entriesIn(server.env, before.env)
    const args = (server.args ?? []).filter((a) => a !== '')
    return { type: 'stdio', command: server.command?.trim(), ...(args.length ? { args } : {}), ...(env ? { env } : {}), ...base }
  }
  const headers = entriesIn(server.headers, before.headers)
  return { type: server.transport, url: server.url?.trim(), ...(headers ? { headers } : {}), ...base }
}

export function claudePermissionFields(settings: Json | null): PermissionField[] {
  const p = settings && isPlainObject(settings.permissions) ? settings.permissions : {}
  const mode = str(p.defaultMode) ?? null
  const options = mode && !MODES.some((m) => m.value === mode) ? [...MODES, { value: mode, label: mode }] : MODES
  return [
    {
      kind: 'select',
      key: 'permissions.defaultMode',
      label: 'Modus',
      description: 'Womit Claude Code startet. In Nexa gibt der Freigabemodus des Chats den Modus vor.',
      options,
      value: mode,
      unsetLabel: 'Nicht festgelegt',
    },
    {
      kind: 'list',
      key: 'permissions.allow',
      label: 'Erlauben',
      description: 'Läuft ohne Rückfrage, auch in Nexa.',
      placeholder: 'z. B. Bash(npm run test:*) oder WebFetch(domain:example.com)',
      value: strings(p.allow),
    },
    { kind: 'list', key: 'permissions.ask', label: 'Immer fragen', description: 'Fragt nach, auch wenn der Modus es erlauben würde.', placeholder: 'z. B. Bash(git push:*)', value: strings(p.ask) },
    { kind: 'list', key: 'permissions.deny', label: 'Verbieten', description: 'Nie erlaubt, in keinem Modus.', placeholder: 'z. B. Read(./.env)', value: strings(p.deny) },
    {
      kind: 'list',
      key: 'permissions.additionalDirectories',
      label: 'Weitere Ordner',
      description: 'Ordner außerhalb des Projekts, in denen Claude arbeiten darf.',
      placeholder: 'z. B. ../gemeinsam',
      value: strings(p.additionalDirectories),
    },
  ]
}

/** The settings file with the permission values set; null or an empty list removes a setting. */
export function withClaudePermissions(data: Json, values: Record<string, PermissionValue>): void {
  const permissions: Json = isPlainObject(data.permissions) ? { ...data.permissions } : {}
  for (const [key, value] of Object.entries(values)) {
    const sub = PERMISSION_KEYS[key]
    if (!sub) throw new Error(`Die Einstellung „${key}“ kennt Nexa nicht.`)
    if (sub === 'defaultMode') {
      if (typeof value === 'string' && value) permissions.defaultMode = value
      else delete permissions.defaultMode
      continue
    }
    const list = cleanList(value)
    if (list.length) permissions[sub] = list
    else delete permissions[sub]
  }
  if (Object.keys(permissions).length) data.permissions = permissions
  else delete data.permissions
}

export class ClaudeConfig implements CliConfigAdapter {
  readonly scopes = SCOPES
  readonly transports: McpTransport[] = TRANSPORTS

  constructor(
    private readonly binary: CliBinary,
    /** The account's servers changed: what Nexa keeps of them goes. */
    private readonly changed: (accountId: string) => void,
  ) {}

  async read(ctx: CliConfigContext): Promise<CliConfigRead> {
    const files = claudeConfigFiles(ctx.account, ctx.scope, ctx.folder)
    const problems: string[] = []
    const load = (file: string) =>
      readJsonFile(file).catch((error: Error) => {
        problems.push(error.message)
        return null
      })
    const [settings, mcpFile] = await Promise.all([load(files.settings), load(files.mcp)])
    const holder = files.local ? claudeProjectEntry(mcpFile, ctx.folder!) : mcpFile
    const servers = holder && isPlainObject(holder.mcpServers) ? holder.mcpServers : {}
    const listed: CliConfigFile[] = [
      { label: 'Berechtigungen und Hooks', path: files.settings, exists: settings !== null },
      { label: ctx.scope === 'local' ? 'MCP-Server (Eintrag des Projekts)' : 'MCP-Server', path: files.mcp, exists: mcpFile !== null },
    ]
    return {
      files: listed,
      readOnly: problems.length ? problems.join(' ') : undefined,
      mcp: {
        servers: Object.entries(servers).map(([name, raw]) => claudeServerOut(name, raw)),
        transports: this.transports,
        note:
          ctx.scope === 'user'
            ? 'Konnektoren von claude.ai und Server aus Plugins stehen nicht hier. Neue Server gelten ab dem nächsten Start der CLI („Chat neu starten“).'
            : ctx.scope === 'project'
              ? 'Claude Code fragt vor dem ersten Start eines Servers aus .mcp.json, ob es ihn nutzen darf.'
              : 'Neue Server gelten ab dem nächsten Start der CLI („Chat neu starten“).',
        manageUrl: ctx.scope === 'user' ? { label: 'Konnektoren auf claude.ai', url: 'https://claude.ai/settings/connectors' } : undefined,
      },
      permissions: { fields: claudePermissionFields(settings) },
      hooks: {
        events: CLAUDE_HOOK_EVENTS,
        configs: hookConfigsOut(settings?.hooks, EVENT_NAMES),
        version: versionOf(settings?.hooks),
        trust: false,
        note: 'Hooks laufen als Befehl in der Shell, mit deinen Rechten. Laufende Chats übernehmen Änderungen spätestens mit „Chat neu starten“.',
      },
    }
  }

  async saveMcpServer(ctx: CliConfigContext, server: McpServerConfig, previousName: string | null): Promise<void> {
    const current = await this.rawServers(ctx)
    if (server.name !== previousName && current[server.name] !== undefined) throw new Error(`Einen Server „${server.name}“ gibt es hier schon.`)
    const before = previousName ? current[previousName] : undefined
    const entry = claudeServerIn(server, before)
    if (previousName && before !== undefined) await this.mcp(ctx, ['remove', previousName, '-s', ctx.scope])
    try {
      await this.mcp(ctx, ['add-json', server.name, '-', '-s', ctx.scope], JSON.stringify(entry))
    } catch (error) {
      // The old one comes back rather than nothing.
      if (previousName && before !== undefined) await this.mcp(ctx, ['add-json', previousName, '-', '-s', ctx.scope], JSON.stringify(before)).catch(() => undefined)
      throw error
    }
    this.changed(ctx.account.accountId)
  }

  async removeMcpServer(ctx: CliConfigContext, name: string): Promise<void> {
    await this.mcp(ctx, ['remove', name, '-s', ctx.scope])
    this.changed(ctx.account.accountId)
  }

  async exportMcpServers(ctx: CliConfigContext): Promise<McpServerConfig[]> {
    return Object.entries(await this.rawServers(ctx)).map(([name, raw]) => claudeServerOut(name, raw, true))
  }

  async savePermissions(ctx: CliConfigContext, values: Record<string, PermissionValue>): Promise<void> {
    const mode = values['permissions.defaultMode']
    if (typeof mode === 'string' && mode && !MODES.some((m) => m.value === mode)) throw new Error(`Den Modus „${mode}“ kennt Claude Code nicht.`)
    await updateJsonFile(claudeConfigFiles(ctx.account, ctx.scope, ctx.folder).settings, (data) => withClaudePermissions(data, values))
  }

  async saveHooks(ctx: CliConfigContext, save: HooksSave): Promise<void> {
    if (!EVENT_RE.test(save.event)) throw new Error(`„${save.event}“ ist kein Ereignis für Hooks.`)
    await updateJsonFile(claudeConfigFiles(ctx.account, ctx.scope, ctx.folder).settings, (data) => {
      if (versionOf(data.hooks) !== save.version) throw new Error('Die Hooks wurden inzwischen außerhalb von Nexa geändert. Bitte neu laden.')
      const groups = hookGroupsIn(save.groups, isPlainObject(data.hooks) ? data.hooks[save.event] : undefined)
      const hooks = withHookEvent(data.hooks, save.event, groups)
      if (hooks) data.hooks = hooks
      else delete data.hooks
    })
  }

  private async rawServers(ctx: CliConfigContext): Promise<Json> {
    const files = claudeConfigFiles(ctx.account, ctx.scope, ctx.folder)
    const file = await readJsonFile(files.mcp)
    const holder = files.local ? claudeProjectEntry(file, ctx.folder!) : file
    return holder && isPlainObject(holder.mcpServers) ? holder.mcpServers : {}
  }

  /** `claude mcp …` in the project's folder (the scopes `local` and `project` are by folder), as the account. */
  private async mcp(ctx: CliConfigContext, args: string[], input?: string): Promise<void> {
    const result = await this.binary.output(['mcp', ...args], { cwd: ctx.folder ?? homedir(), env: cliEnv(ctx.account.set, ctx.account.unset), input })
    if (!result.ok) throw new Error(firstLine(result.stderr, 300) || firstLine(result.stdout, 300) || 'Claude Code hat den Server nicht gespeichert.')
  }
}
