import type { ProviderId } from './chat'

/**
 * The CLIs' own settings, read and edited in Nexa (Einstellungen › CLI-Konfiguration): their MCP
 * servers, permissions and hooks, in the files the CLIs read themselves, so they count in the terminal
 * as well. Each CLI has an adapter in main (`providers/<id>/<id>-config.ts`); a CLI without one isn't
 * offered. The window only ever sees what the adapter hands out: secrets in MCP servers stay in main.
 */

type Unsubscribe = () => void

/**
 * Where a setting lives: for the user (the account's config folder), for a project and everyone who
 * works in it (checked in), or for the user in one project only (Claude Code's „local“ scope).
 */
export type CliConfigScope = 'user' | 'project' | 'local'

export const CLI_CONFIG_SCOPES: readonly CliConfigScope[] = ['user', 'project', 'local']

/** Whose settings: a CLI, one of its accounts, a scope and, for a project's scopes, its folder. */
export interface CliConfigTarget {
  provider: ProviderId
  accountId: string
  scope: CliConfigScope
  /** The folder of a project (or one in it); needed for `project` and `local`. */
  folder?: string
}

export interface CliConfigScopeInfo {
  id: CliConfigScope
  label: string
  description: string
}

/** A file a scope reads from and writes to, to open it. */
export interface CliConfigFile {
  label: string
  path: string
  exists: boolean
}

export type McpTransport = 'stdio' | 'http' | 'sse'

export const MCP_TRANSPORT_LABELS: Record<McpTransport, string> = { stdio: 'Befehl (stdio)', http: 'HTTP', sse: 'SSE' }

/**
 * A variable of a stdio server or a header of a remote one. `masked`: going out, a value that looks
 * like a secret and stays in main; coming back, keep the value it has.
 */
export interface McpEntry {
  name: string
  value: string
  masked?: boolean
}

/** An MCP server as the CLI's file has it; what Nexa doesn't edit stays as it is. */
export interface McpServerConfig {
  name: string
  transport: McpTransport
  command?: string
  args?: string[]
  env?: McpEntry[]
  url?: string
  headers?: McpEntry[]
  /** Codex: the variable that holds the bearer token for a remote server. */
  bearerTokenEnvVar?: string
  /** Off without being removed (Codex `enabled`); undefined for CLIs without such a switch. */
  enabled?: boolean
  /** Further keys of the CLI in the entry, kept on saving (shown so nobody wonders where they went). */
  other?: string[]
  /** Why Nexa only shows it (a kind of server it doesn't edit, e.g. WebSocket); it can still be removed. */
  locked?: string
}

export type PermissionValue = string | string[] | boolean | null

export interface PermissionOption {
  value: string
  label: string
  description?: string
}

interface PermissionFieldBase {
  /** How the adapter knows it, e.g. `permissions.allow` or `sandbox_mode`. */
  key: string
  label: string
  description?: string
  /** Why it can't be changed here (written in a form Nexa doesn't edit). */
  locked?: string
}

/** A permission setting of a CLI; the window draws it by its kind, the adapter knows where it goes. */
export type PermissionField =
  | (PermissionFieldBase & { kind: 'select'; options: PermissionOption[]; value: string | null; unsetLabel: string })
  | (PermissionFieldBase & { kind: 'list'; value: string[]; placeholder?: string })
  | (PermissionFieldBase & { kind: 'toggle'; value: boolean | null })

export interface HookEventInfo {
  name: string
  description?: string
  /** Its hooks can be limited with a matcher (a tool's name, a source …). */
  matcher: boolean
}

/** Codex runs a hook only once the user trusted it as it is (its hash). */
export type HookTrustStatus = 'trusted' | 'untrusted' | 'modified' | 'managed'

export interface HookHandler {
  /** `command` is edited in Nexa; others (prompt, agent, http, mcp_tool) are shown and kept. */
  type: string
  command?: string
  /** Seconds. */
  timeout?: number
  /** For other types: what it does, in a line. */
  summary?: string
  /** Codex: whether it runs; `key` and `hash` to trust it. */
  trust?: { status: HookTrustStatus; key: string; hash: string }
  /** Where it was in the file as read, so what Nexa doesn't edit stays with it. Absent: new. */
  origin?: { group: number; index: number }
}

export interface HookGroup {
  matcher: string | null
  hooks: HookHandler[]
  /** Its place in the file as read (see `HookHandler.origin`). */
  origin?: number
}

export interface HookEventConfig {
  event: string
  groups: HookGroup[]
}

/** A scope's settings as the adapter read them. */
export interface CliConfigSnapshot {
  target: CliConfigTarget
  /** The scopes the CLI has, with their names. */
  scopes: CliConfigScopeInfo[]
  files: CliConfigFile[]
  /** Why this scope is shown but can't be changed in Nexa. */
  readOnly?: string
  /** What to know about the scope, e.g. that the CLI doesn't load it yet. */
  notice?: string
  mcp: {
    servers: McpServerConfig[]
    transports: McpTransport[]
    /** The CLI takes a remote server's bearer token from a variable (`McpServerConfig.bearerTokenEnvVar`). */
    bearerTokenEnvVar?: boolean
    note?: string
    manageUrl?: { label: string; url: string }
  }
  permissions: { fields: PermissionField[]; note?: string }
  hooks: {
    events: HookEventInfo[]
    configs: HookEventConfig[]
    /** Of the hooks as read: a save is refused when the file changed meanwhile. */
    version: string
    /** Codex: hooks need the user's trust to run. */
    trust: boolean
    note?: string
  }
}

export interface HooksSave {
  event: string
  groups: HookGroup[]
  version: string
}

/** A server's name as both CLIs accept it (and as Codex's config keys need it). */
export const MCP_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/
const ENTRY_NAME_RE = /^[A-Za-z_][\w.-]*$/
const HEADER_NAME_RE = /^[!#$%&'*+.^`|~\w-]+$/

/** What is wrong with a server before it goes to the CLI, in words; null when nothing. */
export function mcpServerProblem(server: McpServerConfig, transports: readonly McpTransport[]): string | null {
  if (!MCP_NAME_RE.test(server.name)) return 'Der Name darf nur Buchstaben, Ziffern, „-“ und „_“ enthalten.'
  if (!transports.includes(server.transport)) return 'Diese Art von Server kennt die CLI nicht.'
  if (server.transport === 'stdio') {
    if (!server.command?.trim()) return 'Der Befehl fehlt.'
    for (const entry of server.env ?? []) {
      if (!ENTRY_NAME_RE.test(entry.name)) return `„${entry.name}“ ist kein gültiger Name für eine Variable.`
    }
  } else {
    let url: URL
    try {
      url = new URL(server.url?.trim() ?? '')
    } catch {
      return 'Die Adresse ist keine gültige URL.'
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Die Adresse muss mit http:// oder https:// beginnen.'
    for (const entry of server.headers ?? []) {
      if (!HEADER_NAME_RE.test(entry.name)) return `„${entry.name}“ ist kein gültiger Name für einen Header.`
    }
  }
  const names = [...(server.env ?? []), ...(server.headers ?? [])].map((e) => e.name.toLowerCase())
  const twice = names.find((name, i) => names.indexOf(name) !== i)
  return twice ? `„${twice}“ steht zweimal da.` : null
}

export const CliConfigInvoke = {
  providers: 'cli-config:providers',
  read: 'cli-config:read',
  saveMcp: 'cli-config:save-mcp',
  removeMcp: 'cli-config:remove-mcp',
  savePermissions: 'cli-config:save-permissions',
  saveHooks: 'cli-config:save-hooks',
  trustHook: 'cli-config:trust-hook',
} as const

export const CliConfigEvent = {
  /** Settings of a CLI changed through Nexa (another window shows them, too). */
  changed: 'event:cli-config-changed',
} as const

export interface CliConfigApi {
  /** The CLIs that have an adapter, in their order. */
  providers(): Promise<ProviderId[]>
  read(target: CliConfigTarget): Promise<CliConfigSnapshot>
  /** Adds a server, or replaces the one called `previousName` (renamed when the name differs). */
  saveMcp(target: CliConfigTarget, server: McpServerConfig, previousName: string | null): Promise<void>
  removeMcp(target: CliConfigTarget, name: string): Promise<void>
  /** By `PermissionField.key`; null removes the setting (the CLI's default then). */
  savePermissions(target: CliConfigTarget, values: Record<string, PermissionValue>): Promise<void>
  saveHooks(target: CliConfigTarget, save: HooksSave): Promise<void>
  trustHook(target: CliConfigTarget, key: string, hash: string): Promise<void>
  onChanged(cb: (target: CliConfigTarget) => void): Unsubscribe
}
