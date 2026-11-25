import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { McpServerConfig, McpTransport } from '@shared/cli-config'
import type { ProviderId } from '@shared/chat'
import type { CliConfigContext } from '../providers/cli-config'
import { GlobalMcp, GlobalMcpList, mcpFingerprint, type McpPlace } from './global-mcp'

/** A CLI account's user scope in memory, as the adapters keep it in its files. */
class FakeCli {
  readonly servers = new Map<string, McpServerConfig>()
  writes = 0
  /** Makes every read fail, as a broken file would. */
  broken: string | null = null

  constructor(
    readonly transports: McpTransport[],
    servers: McpServerConfig[] = [],
  ) {
    for (const s of servers) this.servers.set(s.name, s)
  }

  async exportMcpServers(): Promise<McpServerConfig[]> {
    if (this.broken) throw new Error(this.broken)
    return [...this.servers.values()].map((s) => structuredClone(s))
  }

  async saveMcpServer(_ctx: CliConfigContext, server: McpServerConfig, previousName: string | null): Promise<void> {
    if (server.name !== previousName && this.servers.has(server.name)) throw new Error(`Einen Server „${server.name}“ gibt es hier schon.`)
    if (previousName) this.servers.delete(previousName)
    this.servers.set(server.name, JSON.parse(JSON.stringify(server)) as McpServerConfig)
    this.writes++
  }

  async removeMcpServer(_ctx: CliConfigContext, name: string): Promise<void> {
    if (!this.servers.delete(name)) throw new Error(`Den Server „${name}“ gibt es hier nicht mehr.`)
    this.writes++
  }
}

const github: McpServerConfig = {
  name: 'github',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
}
const docs: McpServerConfig = { name: 'docs', transport: 'http', url: 'https://docs.example/mcp', headers: [{ name: 'Authorization', value: 'Bearer abc' }] }

let dir: string
let file: string
let clis: Record<string, FakeCli>
let changed: string[]

function place(key: string): McpPlace {
  const [provider, accountId] = key.split(':') as [ProviderId, string]
  return { column: { provider, accountId }, label: key, adapter: clis[key]!, ctx: {} as CliConfigContext }
}

function make(): GlobalMcp {
  return new GlobalMcp(
    () => Object.keys(clis).map(place),
    new GlobalMcpList(file),
    (column) => changed.push(`${column.provider}:${column.accountId}`),
  )
}

const names = (key: string) => [...clis[key]!.servers.keys()]
const saved = async () => JSON.parse(await readFile(file, 'utf8')) as { servers: { name: string; source: { provider: string; accountId: string } }[] }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexa-global-mcp-'))
  file = join(dir, 'global-mcp.json')
  changed = []
  clis = {
    'claude:a': new FakeCli(['stdio', 'http', 'sse']),
    'claude:b': new FakeCli(['stdio', 'http', 'sse']),
    'codex:c': new FakeCli(['stdio', 'http']),
    'antigravity:d': new FakeCli(['stdio', 'http']),
  }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('mcpFingerprint', () => {
  it('ignores the switch, the order of variables and empty arguments', () => {
    const other = { ...github, enabled: false, args: [...github.args!, ''], env: [...github.env!].reverse() }
    expect(mcpFingerprint(other)).toBe(mcpFingerprint(github))
  })

  it('tells apart what runs and its values', () => {
    expect(mcpFingerprint({ ...github, command: 'bunx' })).not.toBe(mcpFingerprint(github))
    expect(mcpFingerprint({ ...github, env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'other' }] })).not.toBe(mcpFingerprint(github))
  })
})

describe('GlobalMcp', () => {
  it('adds a server to every CLI account and notes it as global', async () => {
    const global = make()
    expect((await global.add(github)).failed).toEqual([])
    for (const key of Object.keys(clis)) expect(clis[key]!.servers.get('github')?.env).toEqual(github.env)
    expect(await global.isGlobal('github')).toBe(true)
    expect((await saved()).servers).toEqual([{ name: 'github', source: { provider: 'claude', accountId: 'a' } }])
    expect(new Set(changed)).toEqual(new Set(Object.keys(clis)))
  })

  it('refuses a new global server whose name is taken, of a kind not every CLI knows or with hidden values', async () => {
    clis['codex:c']!.servers.set('github', github)
    const global = make()
    await expect(global.add(github)).rejects.toThrow(/gibt es schon \(codex:c\)/)
    await expect(global.add({ name: 'old', transport: 'sse', url: 'https://x/sse' })).rejects.toThrow()
    await expect(global.add({ ...docs, headers: [{ name: 'Authorization', value: '', masked: true }] })).rejects.toThrow(/alle Werte/)
    expect(names('claude:a')).toEqual([])
  })

  it('shows each server once with a mark per account, global ones first, values that look secret hidden', async () => {
    clis['claude:a']!.servers.set('zeta', { name: 'zeta', transport: 'stdio', command: 'zeta' })
    clis['claude:a']!.servers.set('old', { name: 'old', transport: 'sse', url: 'https://x/sse' })
    const global = make()
    await global.add(docs)
    clis['codex:c']!.servers.set('docs', { ...docs, url: 'https://elsewhere/mcp', enabled: false })
    clis['antigravity:d']!.broken = 'kaputt'

    const overview = await global.overview()
    expect(overview.columns.map((c) => c.error ?? null)).toEqual([null, null, null, 'kaputt'])
    expect(overview.rows.map((r) => r.name)).toEqual(['docs', 'old', 'zeta'])

    const [first, old] = overview.rows
    expect(first!.global).toBe(true)
    expect(first!.cells.map((c) => c.state)).toEqual(['same', 'same', 'different', 'error'])
    expect(first!.cells[2]!.enabled).toBe(false)
    expect(first!.server.headers).toEqual([{ name: 'Authorization', value: '', masked: true }])
    expect(first!.sources).toEqual([0, 2])

    expect(old!.cells.map((c) => c.state)).toEqual(['same', 'missing', 'unsupported', 'error'])
    expect(old!.notGlobal).toMatch(/SSE/)
  })

  it('makes a server global from the account chosen: other versions give way, each keeps its switch', async () => {
    clis['claude:b']!.servers.set('github', github)
    clis['codex:c']!.servers.set('github', { ...github, command: 'bunx', enabled: false })
    const global = make()
    await global.make('github', { provider: 'claude', accountId: 'b' })

    expect(clis['codex:c']!.servers.get('github')).toMatchObject({ command: 'npx', enabled: false })
    expect(clis['antigravity:d']!.servers.get('github')?.command).toBe('npx')
    expect(clis['claude:b']!.writes).toBe(0)
    expect((await saved()).servers[0]!.source).toEqual({ provider: 'claude', accountId: 'b' })
  })

  it('takes a change in one account to every other one, also a new name', async () => {
    const global = make()
    await global.add(github)
    const changedAt = { ...github, name: 'gh', args: ['-y', 'server-github@2'] }
    await clis['codex:c']!.saveMcpServer({} as CliConfigContext, changedAt, 'github')
    await global.savedAt({ provider: 'codex', accountId: 'c' }, 'gh', 'github')

    for (const key of Object.keys(clis)) {
      expect(names(key)).toEqual(['gh'])
      expect(clis[key]!.servers.get('gh')?.args).toEqual(['-y', 'server-github@2'])
    }
    expect((await saved()).servers).toEqual([{ name: 'gh', source: { provider: 'codex', accountId: 'c' } }])
  })

  it('leaves a server that isn’t global where it is', async () => {
    clis['claude:a']!.servers.set('local', { name: 'local', transport: 'stdio', command: 'x' })
    const global = make()
    expect(await global.savedAt({ provider: 'claude', accountId: 'a' }, 'local', null)).toEqual({ failed: [] })
    expect(names('codex:c')).toEqual([])
  })

  it('keeps hidden values the window sent back on a change from the overview', async () => {
    const global = make()
    await global.add(docs)
    await global.save({ ...docs, url: 'https://docs.example/v2/mcp', headers: [{ name: 'Authorization', value: '', masked: true }] }, 'docs')
    for (const key of Object.keys(clis)) {
      expect(clis[key]!.servers.get('docs')).toMatchObject({ url: 'https://docs.example/v2/mcp', headers: [{ name: 'Authorization', value: 'Bearer abc' }] })
    }
    await expect(global.save({ ...docs, headers: [{ name: 'X-Api-Key', value: '', masked: true }] }, 'docs')).rejects.toThrow(/X-Api-Key/)
  })

  it('refuses a change in one account that not every CLI would know', async () => {
    const global = make()
    await global.add(docs)
    await expect(global.check('docs', { ...docs, transport: 'sse' })).rejects.toThrow(/„docs“ ist global/)
    await expect(global.check('docs', { ...docs, bearerTokenEnvVar: 'TOKEN' })).rejects.toThrow(/Codex/)
    await expect(global.check('other', { ...docs, transport: 'sse' })).resolves.toBeUndefined()
  })

  it('brings back what is missing or differs', async () => {
    const global = make()
    await global.add(github)
    clis['antigravity:d']!.servers.delete('github')
    clis['codex:c']!.servers.set('github', { ...github, command: 'bunx' })
    const writes = clis['claude:b']!.writes
    await global.sync('github')
    expect(clis['antigravity:d']!.servers.get('github')?.command).toBe('npx')
    expect(clis['codex:c']!.servers.get('github')?.command).toBe('npx')
    expect(clis['claude:b']!.writes).toBe(writes)
  })

  it('takes the version of another account when the source lost it', async () => {
    const global = make()
    await global.add(github)
    clis['claude:a']!.servers.delete('github')
    await global.sync('github')
    expect(clis['claude:a']!.servers.get('github')?.command).toBe('npx')
    expect((await saved()).servers[0]!.source).toEqual({ provider: 'claude', accountId: 'b' })
  })

  it('removes a global server everywhere, or only stops keeping it the same', async () => {
    const global = make()
    await global.add(github)
    await global.add(docs)
    clis['codex:c']!.servers.delete('docs')

    expect(await global.remove('docs')).toEqual({ failed: [] })
    for (const key of Object.keys(clis)) expect(names(key)).toEqual(['github'])

    await global.unglobal('github')
    expect(await global.isGlobal('github')).toBe(false)
    expect(names('codex:c')).toEqual(['github'])
  })

  it('gives a new account every global server', async () => {
    const global = make()
    await global.add(github)
    clis['codex:e'] = new FakeCli(['stdio', 'http'])
    const before = clis['codex:c']!.writes
    await global.added(['e'])
    expect(names('codex:e')).toEqual(['github'])
    expect(clis['codex:c']!.writes).toBe(before)
  })

  it('names the accounts a change didn’t reach and goes on with the others', async () => {
    const global = make()
    clis['antigravity:d']!.broken = 'Datei kaputt'
    const { failed } = await global.add(github)
    expect(failed).toEqual([{ provider: 'antigravity', accountId: 'd', message: 'Datei kaputt' }])
    expect(names('codex:c')).toEqual(['github'])
  })

  it('reads the global servers back from its file', async () => {
    await make().add(github)
    await make().add(docs)
    expect([...(await make().names())]).toEqual(['github', 'docs'])
  })
})
