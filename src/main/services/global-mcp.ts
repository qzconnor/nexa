import {
  GLOBAL_MCP_TRANSPORTS,
  globalMcpProblem,
  mcpServerProblem,
  type McpEntry,
  type McpOverview,
  type McpOverviewColumn,
  type McpOverviewRow,
  type McpServerConfig,
  type McpSyncResult,
} from '@shared/cli-config'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { isPlainObject } from '@shared/utils'
import { readJson, writeJsonAtomic } from '../lib/json-file'
import { maskedServer, versionOf, type CliConfigAdapter, type CliConfigContext } from '../providers/cli-config'

/**
 * Global MCP servers (Einstellungen › CLI-Konfiguration › Alle CLIs): one server in the user scope of
 * every account of every CLI, kept the same by Nexa. The servers stay in the CLIs' own files, secrets
 * included; Nexa only notes which names are global and whose version counts (`global-mcp.json`), so
 * nothing secret ends up in its own data or in an export of its settings.
 */

/** A CLI account's user scope, where a global server goes. */
export interface McpPlace {
  column: McpOverviewColumn
  /** „Claude Code · Aizpun Team“, for messages. */
  label: string
  adapter: Pick<CliConfigAdapter, 'transports' | 'exportMcpServers' | 'saveMcpServer' | 'removeMcpServer'>
  ctx: CliConfigContext
}

export interface GlobalMcpEntry {
  name: string
  /** Whose version counts: where it was made global or last changed. */
  source: { provider: ProviderId; accountId: string }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export const sameColumn = (a: { provider: ProviderId; accountId: string }, b: { provider: ProviderId; accountId: string }) =>
  a.provider === b.provider && a.accountId === b.accountId

/**
 * What makes two servers the same: what they run or reach, with its values. Not their switch, nor
 * the keys Nexa doesn't edit (timeouts, tool lists), which each CLI keeps for itself.
 */
export function mcpFingerprint(server: McpServerConfig): string {
  const entries = (list: McpEntry[] | undefined) => (list ?? []).map((e) => [e.name, e.value]).sort(([a], [b]) => (a! < b! ? -1 : a! > b! ? 1 : 0))
  const shape =
    server.transport === 'stdio'
      ? { transport: 'stdio', command: server.command?.trim() ?? '', args: (server.args ?? []).filter((a) => a !== ''), env: entries(server.env) }
      : { transport: server.transport, url: server.url?.trim() ?? '', headers: entries(server.headers), bearer: server.bearerTokenEnvVar?.trim() ?? '' }
  return versionOf(shape)
}

/** The index of the version most places have (the first of a tie); -1 without one. */
function commonest(prints: (string | undefined)[]): number {
  const counts = new Map<string, number>()
  for (const print of prints) if (print) counts.set(print, (counts.get(print) ?? 0) + 1)
  let best: string | undefined
  for (const print of prints) if (print && (best === undefined || counts.get(print)! > counts.get(best)!)) best = print
  return best === undefined ? -1 : prints.indexOf(best)
}

/** Variables and headers the window sent masked get the values `before` has. */
function unmasked(server: McpServerConfig, before: McpServerConfig): McpServerConfig {
  const fill = (list: McpEntry[] | undefined, known: McpEntry[] | undefined) =>
    list?.map((entry) => {
      if (!entry.masked) return { name: entry.name, value: entry.value }
      const kept = known?.find((k) => k.name === entry.name)
      if (!kept) throw new Error(`Für „${entry.name}“ ist kein Wert gespeichert. Bitte neu eintragen.`)
      return { name: entry.name, value: kept.value }
    })
  return { ...server, env: fill(server.env, before.env), headers: fill(server.headers, before.headers) }
}

function parseEntries(raw: unknown): GlobalMcpEntry[] {
  const list = isPlainObject(raw) && Array.isArray(raw.servers) ? raw.servers : []
  return list.flatMap((e): GlobalMcpEntry[] => {
    if (!isPlainObject(e) || typeof e.name !== 'string' || !isPlainObject(e.source)) return []
    const { provider, accountId } = e.source
    if (!PROVIDER_IDS.includes(provider as ProviderId) || typeof accountId !== 'string') return []
    return [{ name: e.name, source: { provider: provider as ProviderId, accountId } }]
  })
}

/** Which servers are global and whose version counts, in `global-mcp.json`. */
export class GlobalMcpList {
  private entries: GlobalMcpEntry[] | null = null

  constructor(private readonly file: string) {}

  async all(): Promise<GlobalMcpEntry[]> {
    this.entries ??= parseEntries(await readJson<unknown>(this.file))
    return [...this.entries]
  }

  async get(name: string): Promise<GlobalMcpEntry | undefined> {
    return (await this.all()).find((e) => e.name === name)
  }

  /** Notes `entry` where it (or `previousName`, when it was renamed) was, else at the end. */
  async put(entry: GlobalMcpEntry, previousName: string | null = null): Promise<void> {
    const list = await this.all()
    const at = list.findIndex((e) => e.name === (previousName ?? entry.name))
    const next = list.map((e, i) => (i === at ? entry : e)).filter((e, i) => i === at || e.name !== entry.name)
    if (at < 0) next.push(entry)
    await this.save(next)
  }

  async drop(name: string): Promise<void> {
    await this.save((await this.all()).filter((e) => e.name !== name))
  }

  private async save(list: GlobalMcpEntry[]): Promise<void> {
    this.entries = list
    await writeJsonAtomic(this.file, { version: 1, servers: list })
  }
}

export class GlobalMcp {
  /** One change at a time: each reads and writes the files of several accounts. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    /** Every CLI account's user scope, in the order of the overview. */
    private readonly places: () => McpPlace[],
    private readonly list: GlobalMcpList,
    /** A CLI account's files changed through Nexa. */
    private readonly changed: (column: McpOverviewColumn) => void,
  ) {}

  async isGlobal(name: string): Promise<boolean> {
    return !!(await this.list.get(name))
  }

  async names(): Promise<Set<string>> {
    return new Set((await this.list.all()).map((e) => e.name))
  }

  async overview(): Promise<McpOverview> {
    const places = this.places()
    const globals = await this.list.all()
    const read = await Promise.all(
      places.map((p) =>
        p.adapter.exportMcpServers(p.ctx).then(
          (servers) => ({ servers, error: undefined }),
          (error: unknown) => ({ servers: [] as McpServerConfig[], error: message(error) }),
        ),
      ),
    )
    const columns = places.map((p, i) => ({ ...p.column, ...(read[i]!.error ? { error: read[i]!.error } : {}) }))
    const others = [...new Set(read.flatMap((r) => r.servers.map((s) => s.name)))].filter((n) => !globals.some((g) => g.name === n)).sort((a, b) => a.localeCompare(b))
    const rows = [...globals.map((g) => g.name), ...others].map((name): McpOverviewRow => {
      const found = read.map((r) => r.servers.find((s) => s.name === name))
      const prints = found.map((s) => (s ? mcpFingerprint(s) : undefined))
      const entry = globals.find((g) => g.name === name)
      const at = entry ? places.findIndex((p) => sameColumn(p.column, entry.source)) : -1
      const ref = at >= 0 && found[at] ? at : commonest(prints)
      const server = found[ref] ?? { name, transport: 'stdio' as const, command: '' }
      const sources: number[] = []
      for (const [i, print] of prints.entries()) if (print && prints.indexOf(print) === i) sources.push(i)
      return {
        name,
        global: !!entry,
        server: { ...maskedServer(server), global: !!entry },
        cells: places.map((p, i) => {
          if (read[i]!.error) return { state: 'error' }
          const own = found[i]
          if (!own) return { state: ref >= 0 && !p.adapter.transports.includes(server.transport) ? 'unsupported' : 'missing' }
          return { state: prints[i] === prints[ref] ? 'same' : 'different', ...(own.enabled !== undefined ? { enabled: own.enabled } : {}) }
        }),
        sources,
        notGlobal: ref >= 0 ? (globalMcpProblem(server) ?? undefined) : undefined,
      }
    })
    return { columns, rows }
  }

  /** A new global server, written into every CLI account. */
  add(server: McpServerConfig): Promise<McpSyncResult> {
    return this.serial(async () => {
      const problem = mcpServerProblem(server, GLOBAL_MCP_TRANSPORTS) ?? globalMcpProblem(server)
      if (problem) throw new Error(problem)
      if ([...(server.env ?? []), ...(server.headers ?? [])].some((e) => e.masked)) throw new Error('Ein neuer Server braucht alle Werte.')
      const places = this.places()
      if (!places.length) throw new Error('Keine CLI hat einen Account.')
      for (const place of places) {
        const now = await place.adapter.exportMcpServers(place.ctx).catch(() => [])
        if (now.some((s) => s.name === server.name)) {
          throw new Error(`Einen Server „${server.name}“ gibt es schon (${place.label}). Mach ihn in der Liste global oder wähle einen anderen Namen.`)
        }
      }
      await this.list.put({ name: server.name, source: places[0]!.column })
      return this.spread(server, null, null)
    })
  }

  /** Makes the server of `source` global: its version goes into every other CLI account. */
  make(name: string, source: McpOverviewColumn): Promise<McpSyncResult> {
    return this.serial(async () => {
      const place = this.places().find((p) => sameColumn(p.column, source))
      if (!place) throw new Error('Den Account gibt es nicht mehr.')
      const server = (await place.adapter.exportMcpServers(place.ctx)).find((s) => s.name === name)
      if (!server) throw new Error(`„${name}“ steht dort nicht mehr.`)
      const problem = globalMcpProblem(server)
      if (problem) throw new Error(problem)
      await this.list.put({ name, source: { provider: source.provider, accountId: source.accountId } })
      return this.spread(server, place.column, null)
    })
  }

  /** Changes a global server from the overview: masked values keep those of its version. */
  save(server: McpServerConfig, previousName: string): Promise<McpSyncResult> {
    return this.serial(async () => {
      const entry = await this.list.get(previousName)
      if (!entry) throw new Error(`„${previousName}“ ist nicht mehr global.`)
      const problem = mcpServerProblem(server, GLOBAL_MCP_TRANSPORTS) ?? globalMcpProblem(server)
      if (problem) throw new Error(problem)
      if (server.name !== previousName && (await this.list.get(server.name))) throw new Error(`Einen globalen Server „${server.name}“ gibt es schon.`)
      const { place, server: before } = await this.sourceOf(entry)
      const full = unmasked(server, before)
      await this.list.put({ name: full.name, source: { provider: place.column.provider, accountId: place.column.accountId } }, previousName)
      // The source too: the change comes from the window, not from its files.
      return this.spread(full, null, previousName)
    })
  }

  /** Throws when a save in one CLI account would make a global server one that not every CLI knows. */
  async check(name: string, server: McpServerConfig): Promise<void> {
    if (!(await this.isGlobal(name))) return
    const problem = globalMcpProblem(server)
    if (problem) throw new Error(`„${name}“ ist global. ${problem}`)
  }

  /**
   * A global server was saved in one CLI account (its tab): that version goes to every other one.
   * Nothing for a server that isn't global.
   */
  savedAt(column: McpOverviewColumn, name: string, previousName: string | null): Promise<McpSyncResult> {
    return this.serial(async () => {
      if (!(await this.list.get(previousName ?? name))) return { failed: [] }
      const place = this.places().find((p) => sameColumn(p.column, column))
      const server = place && (await place.adapter.exportMcpServers(place.ctx)).find((s) => s.name === name)
      if (!place || !server) return { failed: [] }
      await this.list.put({ name, source: { provider: column.provider, accountId: column.accountId } }, previousName)
      return this.spread(server, place.column, previousName)
    })
  }

  /** A global server out of every CLI account; it isn't global any more. */
  remove(name: string): Promise<McpSyncResult> {
    return this.serial(async () => {
      const failed: McpSyncResult['failed'] = []
      for (const place of this.places()) {
        try {
          const now = await place.adapter.exportMcpServers(place.ctx)
          if (!now.some((s) => s.name === name)) continue
          await place.adapter.removeMcpServer(place.ctx, name)
          this.changed(place.column)
        } catch (error) {
          failed.push({ provider: place.column.provider, accountId: place.column.accountId, message: message(error) })
        }
      }
      await this.list.drop(name)
      return { failed }
    })
  }

  /** No longer global: the entries stay where they are. */
  unglobal(name: string): Promise<void> {
    return this.serial(() => this.list.drop(name))
  }

  /** Writes a global server's version where it is missing or differs. */
  sync(name: string): Promise<McpSyncResult> {
    return this.serial(async () => {
      const entry = await this.list.get(name)
      if (!entry) throw new Error(`„${name}“ ist nicht global.`)
      const { place, server } = await this.sourceOf(entry)
      return this.spread(server, place.column, null)
    })
  }

  /** New CLI accounts get every global server. */
  added(accountIds: readonly string[]): Promise<McpSyncResult> {
    return this.serial(async () => {
      const failed: McpSyncResult['failed'] = []
      const fresh = (column: McpOverviewColumn) => accountIds.includes(column.accountId)
      for (const entry of await this.list.all()) {
        const source = await this.sourceOf(entry).catch(() => null)
        if (source) failed.push(...(await this.spread(source.server, source.place.column, null, fresh)).failed)
      }
      return { failed }
    })
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** A global server's version: at its source, else (that account is gone or lost it) the first account that has it. */
  private async sourceOf(entry: GlobalMcpEntry): Promise<{ place: McpPlace; server: McpServerConfig }> {
    const places = this.places()
    const first = places.find((p) => sameColumn(p.column, entry.source))
    for (const place of first ? [first, ...places.filter((p) => p !== first)] : places) {
      const server = (await place.adapter.exportMcpServers(place.ctx).catch(() => [])).find((s) => s.name === entry.name)
      if (!server) continue
      if (place !== first) await this.list.put({ name: entry.name, source: { provider: place.column.provider, accountId: place.column.accountId } })
      return { place, server }
    }
    throw new Error(`„${entry.name}“ steht in keiner CLI mehr. Leg ihn neu an oder entferne ihn.`)
  }

  /**
   * Writes `server` (every value) into each CLI account but `from` (and only those `only` takes): where
   * it is missing, differs or was called `previousName`. Each keeps its own switch and the keys Nexa
   * doesn't edit.
   */
  private async spread(
    server: McpServerConfig,
    from: McpOverviewColumn | null,
    previousName: string | null,
    only: (column: McpOverviewColumn) => boolean = () => true,
  ): Promise<McpSyncResult> {
    const failed: McpSyncResult['failed'] = []
    const print = mcpFingerprint(server)
    for (const place of this.places()) {
      if ((from && sameColumn(place.column, from)) || !only(place.column)) continue
      try {
        if (!place.adapter.transports.includes(server.transport)) throw new Error(`${place.label} kennt diese Art von Server nicht.`)
        const now = await place.adapter.exportMcpServers(place.ctx)
        const old = previousName && previousName !== server.name ? now.find((s) => s.name === previousName) : undefined
        const same = now.find((s) => s.name === server.name)
        if (!old && same && mcpFingerprint(same) === print) continue
        const next: McpServerConfig = { ...server, global: undefined, other: undefined, locked: undefined, enabled: (old ?? same)?.enabled }
        if (old && same) {
          await place.adapter.saveMcpServer(place.ctx, next, server.name)
          await place.adapter.removeMcpServer(place.ctx, previousName!)
        } else {
          await place.adapter.saveMcpServer(place.ctx, next, old ? previousName : same ? server.name : null)
        }
        this.changed(place.column)
      } catch (error) {
        failed.push({ provider: place.column.provider, accountId: place.column.accountId, message: message(error) })
      }
    }
    return { failed }
  }
}
