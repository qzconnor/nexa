import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountEnv } from '../../accounts/account-env'
import type { Json } from '../cli-config'
import { CodexConfig, codexLayers, codexListedHooks, codexPermissionEdits, codexPermissionFields, codexServerIn, codexServerOut } from './codex-config'

describe('codexServerOut / codexServerIn', () => {
  it('shows a remote server with its headers and token variable, and keeps its other keys', () => {
    const raw = { url: 'https://x/mcp', http_headers: { 'X-Key': 'abc123secretvalue', Accept: 'json' }, bearer_token_env_var: 'TOKEN', tool_timeout_sec: 30, enabled: false }
    const shown = codexServerOut('remote', raw)
    expect(shown).toEqual({
      name: 'remote',
      transport: 'http',
      url: 'https://x/mcp',
      headers: [
        { name: 'X-Key', value: '', masked: true },
        { name: 'Accept', value: 'json' },
      ],
      bearerTokenEnvVar: 'TOKEN',
      enabled: false,
      other: ['tool_timeout_sec'],
    })
    expect(codexServerIn({ ...shown, enabled: true }, raw)).toEqual({
      url: 'https://x/mcp',
      http_headers: { 'X-Key': 'abc123secretvalue', Accept: 'json' },
      bearer_token_env_var: 'TOKEN',
      tool_timeout_sec: 30,
    })
  })

  it('writes a stdio server and keeps it off', () => {
    expect(codexServerIn({ name: 'a', transport: 'stdio', command: ' node ', args: ['x.js'], env: [{ name: 'A', value: '1' }], enabled: false }, undefined)).toEqual({
      command: 'node',
      args: ['x.js'],
      env: { A: '1' },
      enabled: false,
    })
  })
})

describe('permissions', () => {
  it('shows the user layer, a fine-grained approval policy locked', () => {
    const fields = codexPermissionFields({ approval_policy: { granular: {} }, sandbox_mode: 'workspace-write', sandbox_workspace_write: { network_access: true, writable_roots: ['C:\\x'] } })
    expect(fields.find((f) => f.key === 'approval_policy')?.locked).toBeTruthy()
    expect(fields.find((f) => f.key === 'sandbox_mode')?.value).toBe('workspace-write')
    expect(fields.find((f) => f.key === 'network_access')?.value).toBe(true)
    expect(fields.find((f) => f.key === 'writable_roots')?.value).toEqual(['C:\\x'])
  })

  it('turns values into edits; null and empty lists remove a key', () => {
    expect(codexPermissionEdits({ sandbox_mode: 'read-only', network_access: null, writable_roots: [], approval_policy: 'never' })).toEqual([
      { keyPath: 'sandbox_mode', value: 'read-only', mergeStrategy: 'replace' },
      { keyPath: 'sandbox_workspace_write.network_access', value: null, mergeStrategy: 'replace' },
      { keyPath: 'sandbox_workspace_write.writable_roots', value: null, mergeStrategy: 'replace' },
      { keyPath: 'approval_policy', value: 'never', mergeStrategy: 'replace' },
    ])
    expect(() => codexPermissionEdits({ sandbox_mode: 'anything' })).toThrow('anything')
    expect(() => codexPermissionEdits({ model: 'x' })).toThrow('model')
  })
})

describe('codexListedHooks / codexLayers', () => {
  it('reads where each hook is from its key', () => {
    const listed = codexListedHooks({
      data: [
        {
          hooks: [
            { key: 'C:\\h\\config.toml:pre_tool_use:0:1', currentHash: 'sha256:a', trustStatus: 'trusted' },
            { key: 'C:\\h\\config.toml:stop:2:0', currentHash: 'sha256:b', trustStatus: 'untrusted', isManaged: true },
            { key: 'broken' },
          ],
        },
      ],
    })
    expect(listed).toEqual([
      { key: 'C:\\h\\config.toml:pre_tool_use:0:1', file: 'C:\\h\\config.toml', event: 'pre_tool_use', group: 0, index: 1, hash: 'sha256:a', status: 'trusted' },
      { key: 'C:\\h\\config.toml:stop:2:0', file: 'C:\\h\\config.toml', event: 'stop', group: 2, index: 0, hash: 'sha256:b', status: 'managed' },
    ])
  })

  it('reads the layers of config/read', () => {
    expect(codexLayers({ layers: [{ name: { type: 'project', dotCodexFolder: 'C:\\p\\.codex' }, config: { a: 1 }, disabledReason: 'not trusted' }] })).toEqual([
      { type: 'project', file: undefined, profile: null, dotCodexFolder: 'C:\\p\\.codex', config: { a: 1 }, disabledReason: 'not trusted' },
    ])
  })
})

/** An app-server that keeps the user's config in memory and lists hooks with a hash of their content. */
class FakeServer {
  config: Json = {}
  calls: { method: string; params: Json }[] = []
  constructor(readonly file: string) {}

  request = async (_account: AccountEnv, method: string, params: Json): Promise<Json> => {
    this.calls.push({ method, params })
    if (method === 'config/read') return { layers: [{ name: { type: 'user', file: this.file, profile: null }, config: structuredClone(this.config) }] }
    if (method === 'config/batchWrite') {
      for (const edit of params.edits as { keyPath: string; value: unknown; mergeStrategy: string }[]) this.apply(edit.keyPath, edit.value, edit.mergeStrategy)
      return { status: 'ok' }
    }
    if (method === 'hooks/list') return { data: [{ hooks: this.hooks() }] }
    return {}
  }

  private apply(keyPath: string, value: unknown, strategy: string): void {
    const parts = keyPath.split('.')
    let at = this.config
    for (const part of parts.slice(0, -1)) at = (at[part] ??= {}) as Json
    const last = parts.at(-1)!
    if (value === null) delete at[last]
    else if (strategy === 'upsert') at[last] = { ...((at[last] as Json) ?? {}), ...(value as Json) }
    else at[last] = value
  }

  private hooks(): Json[] {
    const hooks = (this.config.hooks ?? {}) as Json
    const state = (hooks.state ?? {}) as Record<string, { trusted_hash?: string }>
    const out: Json[] = []
    for (const [event, groups] of Object.entries(hooks)) {
      if (!Array.isArray(groups)) continue
      const snake = event.replace(/(?<!^)([A-Z])/g, '_$1').toLowerCase()
      groups.forEach((group: Json, g: number) =>
        (group.hooks as Json[]).forEach((hook, i) => {
          const key = `${this.file}:${snake}:${g}:${i}`
          const hash = `sha256:${Buffer.from(String(hook.command)).toString('hex').padEnd(64, '0').slice(0, 64)}`
          const trusted = state[key]?.trusted_hash
          out.push({ key, currentHash: hash, trustStatus: trusted === hash ? 'trusted' : trusted ? 'modified' : 'untrusted' })
        }),
      )
    }
    return out
  }
}

describe('CodexConfig', () => {
  let dir: string
  let server: FakeServer
  let account: AccountEnv

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-codex-config-'))
    server = new FakeServer(join(dir, 'config.toml'))
    account = { accountId: 'cx', set: { CODEX_HOME: dir }, unset: [] }
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads servers, permissions and hooks with their trust', async () => {
    server.config = {
      mcp_servers: { docs: { command: 'npx' } },
      sandbox_mode: 'read-only',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say' }] }], state: {} },
    }
    const read = await new CodexConfig(server.request).read({ account, scope: 'user' })
    expect(read.mcp.servers.map((s) => s.name)).toEqual(['docs'])
    expect(read.mcp.transports).toEqual(['stdio', 'http'])
    expect(read.permissions.fields.find((f) => f.key === 'sandbox_mode')?.value).toBe('read-only')
    expect(read.hooks.configs).toHaveLength(1)
    expect(read.hooks.configs[0]?.groups[0]?.hooks[0]?.trust?.status).toBe('untrusted')
  })

  it('trusts what the user wrote and what only moved, not what changed elsewhere', async () => {
    const config = new CodexConfig(server.request)
    const ctx = { account, scope: 'user' as const }
    server.config = {
      hooks: {
        PreToolUse: [{ hooks: [{ type: 'command', command: 'trusted-one' }, { type: 'command', command: 'foreign' }] }],
      },
    }
    // The first one was trusted; the second changed outside Nexa and wasn't.
    const before = await config.read(ctx)
    const [trusted, foreign] = before.hooks.configs[0]!.groups[0]!.hooks
    await config.trustHook(ctx, trusted!.trust!.key, trusted!.trust!.hash)
    // A new hook goes first: both others move one place on.
    const read = await config.read(ctx)
    await config.saveHooks(ctx, {
      event: 'PreToolUse',
      version: read.hooks.version,
      groups: [{ matcher: null, origin: 0, hooks: [{ type: 'command', command: 'new-one' }, { ...trusted!, trust: undefined }, { ...foreign!, trust: undefined }] }],
    })
    const after = (await config.read(ctx)).hooks.configs[0]!.groups[0]!.hooks
    expect(after.map((h) => [h.command, h.trust?.status])).toEqual([
      ['new-one', 'trusted'],
      ['trusted-one', 'trusted'],
      ['foreign', 'untrusted'],
    ])
  })

  it('writes servers into the user config and reloads them, a renamed one at once', async () => {
    server.config = { mcp_servers: { old: { command: 'a', env: { TOKEN: 't' }, startup_timeout_sec: 5 } } }
    await new CodexConfig(server.request).saveMcpServer({ account, scope: 'user' }, { name: 'new', transport: 'stdio', command: 'b', env: [{ name: 'TOKEN', value: '', masked: true }] }, 'old')
    expect(server.config.mcp_servers).toEqual({ new: { command: 'b', env: { TOKEN: 't' }, startup_timeout_sec: 5 } })
    expect(server.calls.some((c) => c.method === 'config/mcpServer/reload')).toBe(true)
  })

  it('writes hooks into hooks.json when that is where they are', async () => {
    const file = join(dir, 'hooks.json')
    await writeFile(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'a' }] }] }, other: 1 }))
    const config = new CodexConfig(server.request)
    const ctx = { account, scope: 'user' as const }
    const read = await config.read(ctx)
    expect(read.files.map((f) => f.label)).toEqual(['Einstellungen', 'Hooks'])
    await config.saveHooks(ctx, { event: 'Stop', version: read.hooks.version, groups: [] })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ other: 1 })
  })

  it('shows a project only, and refuses to change it', async () => {
    const ctx = { account, scope: 'project' as const, folder: join(dir, 'app') }
    const config = new CodexConfig(server.request)
    expect((await config.read(ctx)).readOnly).toBeTruthy()
    await expect(config.savePermissions(ctx, { sandbox_mode: 'read-only' })).rejects.toThrow('Nutzer-Ebene')
  })
})
