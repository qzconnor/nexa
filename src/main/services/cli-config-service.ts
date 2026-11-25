import { isAbsolute } from 'node:path'
import {
  CLI_CONFIG_SCOPES,
  mcpServerProblem,
  MCP_NAME_RE,
  type CliConfigScope,
  type CliConfigSnapshot,
  type CliConfigTarget,
  type HookGroup,
  type HookHandler,
  type HooksSave,
  type McpEntry,
  type McpServerConfig,
  type McpTransport,
  type PermissionValue,
} from '@shared/cli-config'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import { isPlainObject } from '@shared/utils'
import type { McpOverview, McpOverviewColumn, McpSyncResult } from '@shared/cli-config'
import type { AccountService } from '../accounts/account-service'
import { TypedEmitter } from '../lib/typed-emitter'
import type { CliConfigAdapter, CliConfigContext } from '../providers/cli-config'
import { GlobalMcp, GlobalMcpList, type McpPlace } from './global-mcp'
import type { ProjectService } from './project-service'
import type { ProviderService } from './provider-service'

interface Events extends Record<string, unknown[]> {
  changed: [CliConfigTarget]
}

const TRANSPORTS: readonly McpTransport[] = ['stdio', 'http', 'sse']

/**
 * The CLIs' own settings for the window (Einstellungen › CLI-Konfiguration). Everything the window
 * sends is checked here: an account of the CLI, a scope it has, a folder of a project Nexa knows; the
 * adapters (providers/<id>/<id>-config.ts) only get what passed.
 */
export class CliConfigService extends TypedEmitter<Events> {
  private readonly global: GlobalMcp
  /** The accounts known so far: one that comes later gets the global servers. */
  private readonly known: Set<string>

  constructor(
    private readonly providers: ProviderService,
    private readonly accounts: AccountService,
    private readonly projects: ProjectService,
    /** Where Nexa notes which MCP servers are global (`global-mcp.json`). */
    globalFile: string,
  ) {
    super()
    this.global = new GlobalMcp(
      () => this.places(),
      new GlobalMcpList(globalFile),
      (column) => this.emit('changed', { provider: column.provider, accountId: column.accountId, scope: 'user' }),
    )
    this.known = new Set(accounts.list().map((a) => a.id))
    accounts.on('changed', (list) => {
      const fresh = list.filter((a) => !this.known.has(a.id)).map((a) => a.id)
      for (const id of fresh) this.known.add(id)
      if (fresh.length) void this.global.added(fresh).then(({ failed }) => failed.length && console.warn('[cli-config] global MCP servers not written', failed))
    })
  }

  /** The CLIs whose settings Nexa can edit, in their order. */
  providerIds(): ProviderId[] {
    return PROVIDER_IDS.filter((id) => !!this.providers.get(id).config)
  }

  async read(raw: unknown): Promise<CliConfigSnapshot> {
    const { adapter, ctx, target } = this.resolve(raw)
    const read = await adapter.read(ctx)
    if (target.scope === 'user') {
      const global = await this.global.names()
      read.mcp.servers = read.mcp.servers.map((s) => (global.has(s.name) ? { ...s, global: true } : s))
    }
    return { ...read, target, scopes: adapter.scopes }
  }

  async saveMcp(raw: unknown, server: unknown, previousName: unknown): Promise<McpSyncResult> {
    const { adapter, ctx, target } = this.resolve(raw)
    const parsed = parseServer(server)
    const problem = mcpServerProblem(parsed, adapter.transports)
    if (problem) throw new Error(problem)
    const previous = typeof previousName === 'string' && previousName ? previousName : null
    if (target.scope === 'user') await this.global.check(previous ?? parsed.name, parsed)
    await adapter.saveMcpServer(ctx, parsed, previous)
    this.emit('changed', target)
    // A global server goes on from here to every other CLI account.
    return target.scope === 'user' ? this.global.savedAt(target, parsed.name, previous) : { failed: [] }
  }

  async removeMcp(raw: unknown, name: unknown): Promise<McpSyncResult> {
    const { adapter, ctx, target } = this.resolve(raw)
    if (typeof name !== 'string' || !name) throw new Error('Der Name des Servers fehlt.')
    // A global server goes from every CLI account at once.
    if (target.scope === 'user' && (await this.global.isGlobal(name))) return this.global.remove(name)
    await adapter.removeMcpServer(ctx, name)
    this.emit('changed', target)
    return { failed: [] }
  }

  // ── Global MCP servers (see global-mcp.ts) ──

  overview(): Promise<McpOverview> {
    return this.global.overview()
  }

  addGlobal(server: unknown): Promise<McpSyncResult> {
    return this.global.add(parseServer(server))
  }

  saveGlobal(server: unknown, previousName: unknown): Promise<McpSyncResult> {
    if (typeof previousName !== 'string' || !previousName) throw new Error('Der Name des Servers fehlt.')
    return this.global.save(parseServer(server), previousName)
  }

  makeGlobal(name: unknown, source: unknown): Promise<McpSyncResult> {
    if (typeof name !== 'string' || !name) throw new Error('Der Name des Servers fehlt.')
    if (!isPlainObject(source) || typeof source.accountId !== 'string' || !PROVIDER_IDS.includes(source.provider as ProviderId)) {
      throw new Error('Woher der Server kommt, fehlt.')
    }
    return this.global.make(name, { provider: source.provider as ProviderId, accountId: source.accountId })
  }

  unglobal(name: unknown): Promise<void> {
    if (typeof name !== 'string' || !name) throw new Error('Der Name des Servers fehlt.')
    return this.global.unglobal(name)
  }

  removeGlobal(name: unknown): Promise<McpSyncResult> {
    if (typeof name !== 'string' || !name) throw new Error('Der Name des Servers fehlt.')
    return this.global.remove(name)
  }

  syncGlobal(name: unknown): Promise<McpSyncResult> {
    if (typeof name !== 'string' || !name) throw new Error('Der Name des Servers fehlt.')
    return this.global.sync(name)
  }

  /** The user scope of every account of every installed CLI with an adapter: where global servers go. */
  private places(): McpPlace[] {
    return this.providerIds()
      .filter((provider) => this.providers.isReady(provider))
      .flatMap((provider) => {
        const adapter = this.providers.get(provider).config!
        return this.accounts
          .list()
          .filter((a) => a.provider === provider)
          .map((a): McpPlace => {
            const column: McpOverviewColumn = { provider, accountId: a.id }
            return { column, label: `${PROVIDERS[provider].name} · ${a.name}`, adapter, ctx: { account: this.accounts.env(a.id), scope: 'user' } }
          })
      })
  }

  async savePermissions(raw: unknown, values: unknown): Promise<void> {
    const { adapter, ctx, target } = this.resolve(raw)
    if (!isPlainObject(values)) throw new Error('Die Werte fehlen.')
    const clean: Record<string, PermissionValue> = {}
    for (const [key, value] of Object.entries(values)) {
      if (value === null || typeof value === 'string' || typeof value === 'boolean') clean[key] = value
      else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) clean[key] = value as string[]
      else throw new Error(`Der Wert für „${key}“ passt nicht.`)
    }
    await adapter.savePermissions(ctx, clean)
    this.emit('changed', target)
  }

  async saveHooks(raw: unknown, save: unknown): Promise<void> {
    const { adapter, ctx, target } = this.resolve(raw)
    await adapter.saveHooks(ctx, parseHooksSave(save))
    this.emit('changed', target)
  }

  async trustHook(raw: unknown, key: unknown, hash: unknown): Promise<void> {
    const { adapter, ctx, target } = this.resolve(raw)
    if (!adapter.trustHook) throw new Error('Diese CLI kennt kein Vertrauen für Hooks.')
    if (typeof key !== 'string' || !key || typeof hash !== 'string') throw new Error('Der Hook fehlt.')
    await adapter.trustHook(ctx, key, hash)
    this.emit('changed', target)
  }

  private resolve(raw: unknown): { adapter: CliConfigAdapter; ctx: CliConfigContext; target: CliConfigTarget } {
    if (!isPlainObject(raw)) throw new Error('Welche Einstellungen, fehlt.')
    const provider = raw.provider as ProviderId
    if (!PROVIDER_IDS.includes(provider)) throw new Error('Diese CLI kennt Nexa nicht.')
    const adapter = this.providers.get(provider).config
    if (!adapter) throw new Error('Die Einstellungen dieser CLI kann Nexa nicht bearbeiten.')
    const accountId = typeof raw.accountId === 'string' ? raw.accountId : ''
    const account = this.accounts.list().find((a) => a.id === accountId)
    if (!account || account.provider !== provider) throw new Error('Den Account gibt es nicht mehr.')
    const scope = raw.scope as CliConfigScope
    if (!CLI_CONFIG_SCOPES.includes(scope) || !adapter.scopes.some((s) => s.id === scope)) throw new Error('Diese Ebene hat die CLI nicht.')
    let folder: string | undefined
    if (typeof raw.folder === 'string' && raw.folder) {
      const known = isAbsolute(raw.folder) && !!this.projects.containing(raw.folder)
      // The user's scope only uses a folder for what the CLI lists there; one Nexa doesn't know is left out.
      if (known) folder = raw.folder
      else if (scope !== 'user') throw new Error('Der Ordner gehört zu keinem Projekt in Nexa.')
    }
    if (scope !== 'user' && !folder) throw new Error('Für diese Ebene fehlt das Projekt.')
    const target: CliConfigTarget = { provider, accountId, scope, ...(folder ? { folder } : {}) }
    return { adapter, ctx: { account: this.accounts.env(accountId), scope, folder }, target }
  }
}

const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

function parseEntries(raw: unknown): McpEntry[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new Error('Die Variablen oder Header passen nicht.')
  return raw.map((e) => {
    if (!isPlainObject(e) || typeof e.name !== 'string' || typeof e.value !== 'string') throw new Error('Die Variablen oder Header passen nicht.')
    return { name: e.name.trim(), value: e.value, masked: e.masked === true }
  })
}

function parseServer(raw: unknown): McpServerConfig {
  if (!isPlainObject(raw)) throw new Error('Der Server fehlt.')
  const name = text(raw.name)?.trim() ?? ''
  if (!MCP_NAME_RE.test(name)) throw new Error('Der Name darf nur Buchstaben, Ziffern, „-“ und „_“ enthalten.')
  const transport = raw.transport as McpTransport
  if (!TRANSPORTS.includes(transport)) throw new Error('Diese Art von Server kennt Nexa nicht.')
  const args = raw.args === undefined || raw.args === null ? undefined : Array.isArray(raw.args) && raw.args.every((a) => typeof a === 'string') ? (raw.args as string[]) : null
  if (args === null) throw new Error('Die Argumente passen nicht.')
  return {
    name,
    transport,
    command: text(raw.command),
    args,
    env: parseEntries(raw.env),
    url: text(raw.url),
    headers: parseEntries(raw.headers),
    bearerTokenEnvVar: text(raw.bearerTokenEnvVar),
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : undefined,
  }
}

function parseHandler(raw: unknown): HookHandler {
  if (!isPlainObject(raw) || typeof raw.type !== 'string') throw new Error('Ein Hook passt nicht.')
  const origin = isPlainObject(raw.origin) && Number.isInteger(raw.origin.group) && Number.isInteger(raw.origin.index) ? { group: raw.origin.group as number, index: raw.origin.index as number } : undefined
  const timeout = raw.timeout === undefined || raw.timeout === null ? undefined : Number(raw.timeout)
  return { type: raw.type, command: text(raw.command), timeout, origin }
}

function parseHooksSave(raw: unknown): HooksSave {
  if (!isPlainObject(raw) || typeof raw.event !== 'string' || typeof raw.version !== 'string' || !Array.isArray(raw.groups)) throw new Error('Die Hooks passen nicht.')
  const groups = raw.groups.map((g): HookGroup => {
    if (!isPlainObject(g) || !Array.isArray(g.hooks)) throw new Error('Die Hooks passen nicht.')
    return {
      matcher: typeof g.matcher === 'string' ? g.matcher : null,
      origin: Number.isInteger(g.origin) ? (g.origin as number) : undefined,
      hooks: g.hooks.map(parseHandler),
    }
  })
  return { event: raw.event, version: raw.version, groups }
}
