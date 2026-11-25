import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  CliConfigScopeInfo,
  HookEventConfig,
  HookEventInfo,
  HooksSave,
  HookTrustStatus,
  McpServerConfig,
  McpTransport,
  PermissionField,
  PermissionValue,
} from '@shared/cli-config'
import { folderKey } from '@shared/folders'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import { defaultCodexHome } from '../../accounts/cli-files'
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
 * Codex's settings through its app-server's config API (docs/PROTOCOLS.md, „Einstellungen der CLIs“):
 * `config/read` with its layers, `config/batchWrite` into the user's `config.toml`, which keeps the
 * file's comments and layout. The app-server writes no other file (`configLayerReadonly`), so a
 * project's `.codex/config.toml` is shown, not changed. Hooks in a `hooks.json` beside `config.toml`
 * Nexa writes itself, as JSON.
 */

/** A request to the app-server of the account (one per account, see CodexProvider). */
export type CodexRequest = (account: AccountEnv, method: string, params: Json) => Promise<Json>

const SCOPES: CliConfigScopeInfo[] = [
  { id: 'user', label: 'Nutzer', description: 'config.toml im Ordner des Accounts (CODEX_HOME)' },
  { id: 'project', label: 'Projekt', description: '.codex/config.toml im Projekt; Nexa zeigt sie nur' },
]

/** Codex's hook events (0.169); hooks/list keeps a matcher only for those with `matcher`. */
export const CODEX_HOOK_EVENTS: HookEventInfo[] = [
  { name: 'PreToolUse', description: 'Bevor ein Werkzeug läuft; kann es verhindern', matcher: true },
  { name: 'PostToolUse', description: 'Nachdem ein Werkzeug lief', matcher: true },
  { name: 'PermissionRequest', description: 'Wenn Codex um eine Freigabe bittet', matcher: true },
  { name: 'UserPromptSubmit', description: 'Wenn ein Prompt abgeschickt wird', matcher: false },
  { name: 'Stop', description: 'Wenn Codex mit dem Turn fertig ist', matcher: false },
  { name: 'Interrupt', description: 'Wenn ein Turn abgebrochen wird', matcher: false },
  { name: 'SessionStart', description: 'Beim Start oder Fortsetzen eines Threads', matcher: true },
  { name: 'SessionEnd', description: 'Am Ende eines Threads', matcher: true },
  { name: 'SubagentStart', description: 'Wenn ein Subagent startet', matcher: true },
  { name: 'SubagentStop', description: 'Wenn ein Subagent fertig ist', matcher: true },
  { name: 'PreCompact', description: 'Bevor der Kontext zusammengefasst wird', matcher: true },
  { name: 'PostCompact', description: 'Nachdem der Kontext zusammengefasst wurde', matcher: true },
  { name: 'PreModelRequest', description: 'Vor jeder Anfrage an das Modell', matcher: false },
  { name: 'PostModelRequest', description: 'Nach jeder Anfrage an das Modell', matcher: false },
]

const EVENT_NAMES = CODEX_HOOK_EVENTS.map((e) => e.name)
// Codex has no SSE: a remote server is streamable HTTP.
const TRANSPORTS: McpTransport[] = ['stdio', 'http']
const EVENT_RE = /^[A-Za-z]{1,64}$/
/** Names Codex takes as a dotted key path; others need the whole table. */
const KEY_RE = /^[\w-]+$/

const SERVER_KEYS = ['command', 'args', 'env', 'url', 'http_headers', 'bearer_token_env_var', 'enabled']

const APPROVALS = [
  { value: 'untrusted', label: 'Nachfragen', description: 'Fragt vor allem, was nicht nur liest' },
  { value: 'on-request', label: 'Wenn nötig', description: 'Codex fragt, wenn es die Sandbox verlassen will' },
  { value: 'never', label: 'Nie fragen', description: 'Was scheitert, scheitert ohne Rückfrage' },
]
const SANDBOXES = [
  { value: 'read-only', label: 'Nur lesen' },
  { value: 'workspace-write', label: 'Im Projekt schreiben' },
  { value: 'danger-full-access', label: 'Voller Zugriff', description: 'Ohne Sandbox' },
]
const REVIEWERS = [
  { value: 'user', label: 'Du' },
  { value: 'auto_review', label: 'Automatische Prüfung', description: 'Ein Subagent prüft das Risiko und entscheidet' },
]

/** Field key → Codex key path, with the values it takes (lists and switches take any). */
const PERMISSION_PATHS: Record<string, { path: string; values?: readonly { value: string }[] }> = {
  approval_policy: { path: 'approval_policy', values: APPROVALS },
  sandbox_mode: { path: 'sandbox_mode', values: SANDBOXES },
  approvals_reviewer: { path: 'approvals_reviewer', values: REVIEWERS },
  network_access: { path: 'sandbox_workspace_write.network_access' },
  writable_roots: { path: 'sandbox_workspace_write.writable_roots' },
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])

export function codexHome(account: AccountEnv): string {
  return account.set.CODEX_HOME ? resolve(account.set.CODEX_HOME) : defaultCodexHome()
}

/** A server of Codex's config as Nexa shows it; Codex knows stdio and streamable HTTP. */
export function codexServerOut(name: string, raw: unknown): McpServerConfig {
  const entry = isPlainObject(raw) ? raw : {}
  const enabled = entry.enabled !== false
  const other = otherKeys(entry, SERVER_KEYS)
  if (str(entry.url)) {
    return {
      name,
      transport: 'http',
      url: entry.url as string,
      headers: entriesOut(entry.http_headers),
      bearerTokenEnvVar: str(entry.bearer_token_env_var),
      enabled,
      other,
    }
  }
  return { name, transport: 'stdio', command: str(entry.command) ?? '', args: strings(entry.args), env: entriesOut(entry.env), enabled, other }
}

/** The entry Codex gets: the edited keys over what it had besides (timeouts, tool lists …). */
export function codexServerIn(server: McpServerConfig, current: unknown): Json {
  const before = isPlainObject(current) ? current : {}
  const base = withoutKeys(current, SERVER_KEYS)
  const enabled = server.enabled === false ? { enabled: false } : {}
  if (server.transport === 'stdio') {
    const env = entriesIn(server.env, before.env)
    const args = (server.args ?? []).filter((a) => a !== '')
    return { command: server.command?.trim(), ...(args.length ? { args } : {}), ...(env ? { env } : {}), ...enabled, ...base }
  }
  const headers = entriesIn(server.headers, before.http_headers)
  const bearer = server.bearerTokenEnvVar?.trim()
  return { url: server.url?.trim(), ...(headers ? { http_headers: headers } : {}), ...(bearer ? { bearer_token_env_var: bearer } : {}), ...enabled, ...base }
}

export function codexPermissionFields(config: Json): PermissionField[] {
  const approval = config.approval_policy
  const workspace = isPlainObject(config.sandbox_workspace_write) ? config.sandbox_workspace_write : {}
  return [
    {
      kind: 'select',
      key: 'approval_policy',
      label: 'Freigaben',
      description: 'Wann Codex fragt, bevor es etwas tut.',
      options: APPROVALS,
      value: str(approval) ?? null,
      unsetLabel: 'Nicht festgelegt',
      locked: isPlainObject(approval) ? 'Fein eingestellt in der config.toml; Nexa ändert das nicht.' : undefined,
    },
    { kind: 'select', key: 'sandbox_mode', label: 'Sandbox', description: 'Was Befehle dürfen.', options: SANDBOXES, value: str(config.sandbox_mode) ?? null, unsetLabel: 'Nicht festgelegt' },
    {
      kind: 'toggle',
      key: 'network_access',
      label: 'Netzwerk in der Sandbox',
      description: 'Befehle dürfen ins Netz, wenn die Sandbox im Projekt schreiben darf.',
      value: typeof workspace.network_access === 'boolean' ? workspace.network_access : null,
    },
    {
      kind: 'list',
      key: 'writable_roots',
      label: 'Weitere beschreibbare Ordner',
      description: 'Außer dem Projekt, wenn die Sandbox im Projekt schreiben darf.',
      placeholder: 'z. B. C:\\Temp\\build',
      value: strings(workspace.writable_roots),
    },
    {
      kind: 'select',
      key: 'approvals_reviewer',
      label: 'Freigaben prüft',
      description: 'Wer über Rückfragen entscheidet.',
      options: REVIEWERS,
      value: str(config.approvals_reviewer) ?? null,
      unsetLabel: 'Nicht festgelegt',
    },
  ]
}

/** The edits for the permission values; null removes a key (Codex's default then). */
export function codexPermissionEdits(values: Record<string, PermissionValue>): Json[] {
  return Object.entries(values).map(([key, value]) => {
    const target = PERMISSION_PATHS[key]
    if (!target) throw new Error(`Die Einstellung „${key}“ kennt Nexa nicht.`)
    let next: unknown = null
    if (key === 'writable_roots') {
      const list = cleanList(value)
      next = list.length ? list : null
    } else if (key === 'network_access') next = typeof value === 'boolean' ? value : null
    else if (typeof value === 'string' && value) {
      if (!target.values?.some((v) => v.value === value)) throw new Error(`„${value}“ kennt Codex hier nicht.`)
      next = value
    }
    return { keyPath: target.path, value: next, mergeStrategy: 'replace' }
  })
}

/** `PreToolUse` → `pre_tool_use`, as the keys of `hooks/list` name events. */
function snake(event: string): string {
  return event.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase()
}

interface ListedHook {
  key: string
  file: string
  event: string
  group: number
  index: number
  hash: string
  status: HookTrustStatus
}

/** `hooks/list`: each hook with where it is (from its key `<file>:<event>:<group>:<index>`) and its trust. */
export function codexListedHooks(raw: unknown): ListedHook[] {
  const entries = isPlainObject(raw) && Array.isArray(raw.data) ? raw.data.filter(isPlainObject) : []
  const out: ListedHook[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    for (const hook of Array.isArray(entry.hooks) ? entry.hooks.filter(isPlainObject) : []) {
      const key = str(hook.key)
      const match = key ? /^(.*):([a-z_]+):(\d+):(\d+)$/s.exec(key) : null
      if (!key || !match || seen.has(key)) continue
      seen.add(key)
      const status = hook.isManaged === true ? 'managed' : (str(hook.trustStatus) as HookTrustStatus | undefined)
      out.push({
        key,
        file: match[1]!,
        event: match[2]!,
        group: Number(match[3]),
        index: Number(match[4]),
        hash: str(hook.currentHash) ?? '',
        status: status === 'trusted' || status === 'modified' || status === 'managed' ? status : 'untrusted',
      })
    }
  }
  return out
}

/** The trust of each hook of a file, onto the hooks as read. */
function withTrust(configs: HookEventConfig[], listed: readonly ListedHook[], file: string): HookEventConfig[] {
  const key = folderKey(file)
  const mine = listed.filter((h) => folderKey(h.file) === key)
  for (const config of configs) {
    const event = snake(config.event)
    for (const group of config.groups) {
      for (const handler of group.hooks) {
        const found = handler.origin && mine.find((h) => h.event === event && h.group === handler.origin!.group && h.index === handler.origin!.index)
        if (found) handler.trust = { status: found.status, key: found.key, hash: found.hash }
      }
    }
  }
  return configs
}

/** Where a scope's hooks are written: `hooks.json` once it is there and `config.toml` has none. */
interface HookSource {
  file: string
  json: boolean
  hooks: Json
}

export class CodexConfig implements CliConfigAdapter {
  readonly scopes = SCOPES
  readonly transports: McpTransport[] = TRANSPORTS

  constructor(private readonly request: CodexRequest) {}

  async read(ctx: CliConfigContext): Promise<CliConfigRead> {
    const home = codexHome(ctx.account)
    const layers = await this.layers(ctx)
    if (ctx.scope === 'project') return this.readProject(ctx, layers)
    const user = userLayer(layers)
    const config = user?.config ?? {}
    const configFile = user?.file ?? join(home, 'config.toml')
    const source = await this.hookSource(home, config, configFile)
    const listed = codexListedHooks(await this.request(ctx.account, 'hooks/list', { cwds: [ctx.folder ?? home] }))
    return {
      files: [
        { label: 'Einstellungen', path: configFile, exists: existsSync(configFile) },
        ...(source.json ? [{ label: 'Hooks', path: source.file, exists: true }] : []),
      ],
      mcp: {
        servers: Object.entries(isPlainObject(config.mcp_servers) ? config.mcp_servers : {}).map(([name, raw]) => codexServerOut(name, raw)),
        transports: this.transports,
        bearerTokenEnvVar: true,
        note: 'Gilt für alle Projekte dieses Accounts. Laufende Chats übernehmen Änderungen mit dem nächsten Prompt.',
      },
      permissions: {
        fields: codexPermissionFields(config),
        note: 'Gilt für Codex außerhalb von Nexa. In Nexa bestimmt der Freigabemodus des Chats Freigaben und Sandbox.',
      },
      hooks: {
        events: CODEX_HOOK_EVENTS,
        configs: withTrust(hookConfigsOut(source.hooks, EVENT_NAMES), listed, source.file),
        version: versionOf(source.hooks),
        trust: true,
        note: 'Codex führt einen Hook erst aus, wenn du ihm vertraust; was du hier anlegst oder änderst, vertraut Nexa für dich.',
      },
    }
  }

  async saveMcpServer(ctx: CliConfigContext, server: McpServerConfig, previousName: string | null): Promise<void> {
    this.writable(ctx)
    const servers = await this.rawServers(ctx)
    if (server.name !== previousName && servers[server.name] !== undefined) throw new Error(`Einen Server „${server.name}“ gibt es hier schon.`)
    const entry = codexServerIn(server, previousName ? servers[previousName] : undefined)
    const renamed = previousName && previousName !== server.name && servers[previousName] !== undefined ? previousName : null
    if (KEY_RE.test(server.name) && (!renamed || KEY_RE.test(renamed))) {
      await this.write(ctx, [
        { keyPath: `mcp_servers.${server.name}`, value: entry, mergeStrategy: 'replace' },
        ...(renamed ? [{ keyPath: `mcp_servers.${renamed}`, value: null, mergeStrategy: 'replace' }] : []),
      ])
    } else {
      const next = { ...servers }
      if (renamed) delete next[renamed]
      next[server.name] = entry
      await this.write(ctx, [{ keyPath: 'mcp_servers', value: next, mergeStrategy: 'replace' }])
    }
    await this.request(ctx.account, 'config/mcpServer/reload', {}).catch(() => undefined)
  }

  async removeMcpServer(ctx: CliConfigContext, name: string): Promise<void> {
    this.writable(ctx)
    if (KEY_RE.test(name)) await this.write(ctx, [{ keyPath: `mcp_servers.${name}`, value: null, mergeStrategy: 'replace' }])
    else {
      const next = { ...(await this.rawServers(ctx)) }
      delete next[name]
      await this.write(ctx, [{ keyPath: 'mcp_servers', value: Object.keys(next).length ? next : null, mergeStrategy: 'replace' }])
    }
    await this.request(ctx.account, 'config/mcpServer/reload', {}).catch(() => undefined)
  }

  async savePermissions(ctx: CliConfigContext, values: Record<string, PermissionValue>): Promise<void> {
    this.writable(ctx)
    await this.write(ctx, codexPermissionEdits(values))
  }

  /**
   * Writes one event's hooks, then trusts what the user just wrote: a hook whose hash Codex didn't
   * have before (new or changed in Nexa), and one that was trusted before and only moved. A hook that
   * changed outside Nexa and wasn't trusted stays so. Trust entries of hooks that are gone go.
   */
  async saveHooks(ctx: CliConfigContext, save: HooksSave): Promise<void> {
    this.writable(ctx)
    if (!EVENT_RE.test(save.event)) throw new Error(`„${save.event}“ ist kein Ereignis für Hooks.`)
    const home = codexHome(ctx.account)
    const user = userLayer(await this.layers(ctx))
    const source = await this.hookSource(home, user?.config ?? {}, user?.file ?? join(home, 'config.toml'))
    if (versionOf(source.hooks) !== save.version) throw new Error('Die Hooks wurden inzwischen außerhalb von Nexa geändert. Bitte neu laden.')
    const listHooks = async () => codexListedHooks(await this.request(ctx.account, 'hooks/list', { cwds: [ctx.folder ?? home] }))
    const before = await listHooks()
    const groups = hookGroupsIn(save.groups, source.hooks[save.event])
    if (source.json) {
      await updateJsonFile(source.file, (data) => {
        const hooks = withHookEvent(data.hooks, save.event, groups)
        if (hooks) data.hooks = hooks
        else delete data.hooks
      })
    } else {
      await this.write(ctx, [{ keyPath: `hooks.${save.event}`, value: groups.length ? groups : null, mergeStrategy: 'replace' }])
    }
    const event = snake(save.event)
    const file = folderKey(source.file)
    const known = new Map(before.filter((h) => folderKey(h.file) === file).map((h) => [h.hash, h.status]))
    const after = (await listHooks()).filter((h) => folderKey(h.file) === file && h.event === event)
    const state: Json = isPlainObject(user?.config.hooks) && isPlainObject(user.config.hooks.state) ? { ...user.config.hooks.state } : {}
    let changed = false
    // Positions of the event that no hook has any more: their trust would only wait for a stranger.
    for (const key of Object.keys(state)) {
      const at = /^(.*):([a-z_]+):\d+:\d+$/s.exec(key)
      if (at && folderKey(at[1]!) === file && at[2] === event && !after.some((h) => h.key === key)) {
        delete state[key]
        changed = true
      }
    }
    for (const hook of after) {
      if (hook.status === 'trusted' || hook.status === 'managed') continue
      const was = known.get(hook.hash)
      if (was === undefined || was === 'trusted') {
        const entry = state[hook.key]
        state[hook.key] = { ...(isPlainObject(entry) ? entry : {}), trusted_hash: hook.hash }
        changed = true
      }
    }
    if (changed) await this.write(ctx, [{ keyPath: 'hooks.state', value: Object.keys(state).length ? state : null, mergeStrategy: 'replace' }])
  }

  async trustHook(ctx: CliConfigContext, key: string, hash: string): Promise<void> {
    if (!/^sha256:[a-f0-9]{64}$/.test(hash)) throw new Error('Der Hook ist nicht mehr derselbe. Bitte neu laden.')
    await this.write(ctx, [{ keyPath: 'hooks.state', value: { [key]: { trusted_hash: hash } }, mergeStrategy: 'upsert' }])
  }

  private async readProject(ctx: CliConfigContext, layers: Layer[]): Promise<CliConfigRead> {
    const dir = join(ctx.folder!, '.codex')
    const layer = layers.find((l) => l.type === 'project' && l.dotCodexFolder && folderKey(l.dotCodexFolder) === folderKey(dir))
    const config = layer?.config ?? {}
    const file = join(dir, 'config.toml')
    const listed = codexListedHooks(await this.request(ctx.account, 'hooks/list', { cwds: [ctx.folder!] }))
    return {
      files: [{ label: 'Einstellungen des Projekts', path: file, exists: existsSync(file) }],
      readOnly: 'Codex ändert über seinen App-Server nur die Nutzer-Ebene. Die Datei des Projekts lässt sich öffnen und von Hand bearbeiten.',
      notice: layer?.disabledReason
        ? 'Codex lädt diese Einstellungen erst, wenn du dem Projekt vertraust (Codex fragt beim ersten Start im Ordner).'
        : undefined,
      mcp: { servers: Object.entries(isPlainObject(config.mcp_servers) ? config.mcp_servers : {}).map(([name, raw]) => codexServerOut(name, raw)), transports: this.transports, bearerTokenEnvVar: true },
      permissions: { fields: codexPermissionFields(config) },
      hooks: {
        events: CODEX_HOOK_EVENTS,
        configs: withTrust(hookConfigsOut(config.hooks, EVENT_NAMES), listed, file),
        version: versionOf(config.hooks),
        trust: true,
      },
    }
  }

  private writable(ctx: CliConfigContext): void {
    if (ctx.scope !== 'user') throw new Error('Codex ändert über seinen App-Server nur die Nutzer-Ebene.')
  }

  private async layers(ctx: CliConfigContext): Promise<Layer[]> {
    const response = await this.request(ctx.account, 'config/read', { includeLayers: true, cwd: ctx.folder ?? null })
    return codexLayers(response)
  }

  private async rawServers(ctx: CliConfigContext): Promise<Json> {
    const user = userLayer(await this.layers(ctx))
    return user && isPlainObject(user.config.mcp_servers) ? user.config.mcp_servers : {}
  }

  /** `hooks.json` when it is there and `config.toml` names no event of its own; else `config.toml`. */
  private async hookSource(home: string, config: Json, configFile: string): Promise<HookSource> {
    const tomlHooks = isPlainObject(config.hooks) ? withoutKeys(config.hooks, ['state']) : {}
    const jsonFile = join(home, 'hooks.json')
    if (!Object.keys(tomlHooks).length) {
      const json = await readJsonFile(jsonFile)
      if (json) return { file: jsonFile, json: true, hooks: isPlainObject(json.hooks) ? json.hooks : {} }
    }
    return { file: configFile, json: false, hooks: tomlHooks }
  }

  /** Into the user's `config.toml`; loaded threads take what they can at once. */
  private async write(ctx: CliConfigContext, edits: Json[]): Promise<void> {
    await this.request(ctx.account, 'config/batchWrite', { edits, reloadUserConfig: true })
  }
}

interface Layer {
  type: string
  file?: string
  profile?: string | null
  dotCodexFolder?: string
  config: Json
  disabledReason?: string
}

/** The layers of `config/read` (`includeLayers`), the most specific first. */
export function codexLayers(raw: unknown): Layer[] {
  const layers = isPlainObject(raw) && Array.isArray(raw.layers) ? raw.layers.filter(isPlainObject) : []
  return layers.map((layer) => {
    const name = isPlainObject(layer.name) ? layer.name : {}
    return {
      type: str(name.type) ?? '',
      file: str(name.file),
      profile: str(name.profile) ?? null,
      dotCodexFolder: str(name.dotCodexFolder),
      config: isPlainObject(layer.config) ? layer.config : {},
      disabledReason: str(layer.disabledReason),
    }
  })
}

/** The user's own `config.toml`, not a profile laid over it. */
function userLayer(layers: Layer[]): Layer | undefined {
  return layers.find((l) => l.type === 'user' && !l.profile)
}
