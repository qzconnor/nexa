import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountEnv } from '../../accounts/account-env'
import {
  AntigravityConfig,
  antigravityHooksOut,
  antigravityPermissionFields,
  antigravityServerIn,
  antigravityServerOut,
  withAntigravityHooks,
  withAntigravityPermissions,
} from './antigravity-config'

describe('antigravityServerOut / antigravityServerIn', () => {
  it('shows a stdio server with its secrets withheld, and writes it back over its other keys', () => {
    const raw = { command: 'npx', args: ['-y', 'srv'], env: { API_KEY: 'sk-1', MODE: 'x' }, cwd: '/w', disabledTools: ['a'] }
    const shown = antigravityServerOut('docs', raw)
    expect(shown).toEqual({
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'srv'],
      env: [
        { name: 'API_KEY', value: '', masked: true },
        { name: 'MODE', value: 'x' },
      ],
      enabled: true,
      other: ['cwd', 'disabledTools'],
    })
    expect(antigravityServerIn({ ...shown, args: ['-y', 'srv', ''] }, raw)).toEqual({ command: 'npx', args: ['-y', 'srv'], env: { API_KEY: 'sk-1', MODE: 'x' }, cwd: '/w', disabledTools: ['a'] })
  })

  it('reads a remote server by url or the old serverUrl, and switches it off with disabled', () => {
    const raw = { serverUrl: 'https://old/mcp', headers: { Authorization: 'Bearer t' }, disabled: true }
    const shown = antigravityServerOut('r', raw)
    expect(shown).toMatchObject({ transport: 'http', url: 'https://old/mcp', enabled: false, headers: [{ name: 'Authorization', value: '', masked: true }] })
    expect(antigravityServerIn({ ...shown, url: 'https://new/mcp', enabled: true }, raw)).toEqual({ url: 'https://new/mcp', headers: { Authorization: 'Bearer t' } })
    expect(antigravityServerIn({ name: 'n', transport: 'http', url: 'https://x', enabled: false }, undefined)).toEqual({ url: 'https://x', disabled: true })
    expect(() => antigravityServerIn({ name: 'n', transport: 'sse', url: 'https://x/sse' }, undefined)).toThrow(/Streamable/)
  })
})

describe('permissions', () => {
  it('shows mode, tool permission and the rules of settings.json', () => {
    const fields = antigravityPermissionFields({ agentMode: '', toolPermission: 'strict', permissions: { allow: ['command(git status)'], deny: ['write_file(.env)'] } })
    expect(fields.map((f) => [f.key, f.value])).toEqual([
      ['agentMode', 'default'],
      ['toolPermission', 'strict'],
      ['allowNonWorkspaceAccess', null],
      ['permissions.allow', ['command(git status)']],
      ['permissions.ask', []],
      ['permissions.deny', ['write_file(.env)']],
    ])
  })

  it('writes the default mode as an empty text and removes what is emptied', () => {
    const data: Record<string, unknown> = { trustedWorkspaces: ['C:\\me'], permissions: { allow: ['command(ls)'] } }
    withAntigravityPermissions(data, { agentMode: 'default', 'permissions.allow': [], 'permissions.ask': ['command(git push)', ' ', 'command(git push)'], allowNonWorkspaceAccess: true })
    expect(data).toEqual({ trustedWorkspaces: ['C:\\me'], agentMode: '', allowNonWorkspaceAccess: true, permissions: { ask: ['command(git push)'] } })
    withAntigravityPermissions(data, { agentMode: null, 'permissions.ask': [], allowNonWorkspaceAccess: null })
    expect(data).toEqual({ trustedWorkspaces: ['C:\\me'] })
    expect(() => withAntigravityPermissions(data, { toolPermission: 'yolo' })).toThrow(/yolo/)
  })
})

describe('hooks', () => {
  // hooks.json as Antigravity's documentation shows it.
  const FILE = {
    'lint-checker': { PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: './scripts/lint.sh', timeout: 10 }] }] },
    'safety-gate': { enabled: false, PreToolUse: [{ matcher: 'run_command', hooks: [{ command: './scripts/safety-check.sh' }] }] },
    reminder: { PreInvocation: [{ type: 'command', command: './scripts/reminder.sh' }] },
  }

  it('shows the named hooks by event, tool events with their matcher', () => {
    const configs = antigravityHooksOut(FILE)
    expect(configs.map((c) => c.event)).toEqual(['PreToolUse', 'PostToolUse', 'PreInvocation'])
    expect(configs[0]!.groups[0]).toMatchObject({ matcher: 'run_command', hooks: [{ type: 'command', command: './scripts/safety-check.sh' }] })
    expect(configs[2]!.groups[0]).toMatchObject({ matcher: null, hooks: [{ type: 'command', command: './scripts/reminder.sh' }] })
  })

  it('writes each group back to its named hook, and a new one to „nexa“', () => {
    const [, post, pre] = antigravityHooksOut(FILE)
    const changed = withAntigravityHooks(FILE, {
      event: 'PostToolUse',
      version: '',
      groups: [{ ...post!.groups[0]!, matcher: 'edit_file' }, { matcher: null, hooks: [{ type: 'command', command: 'echo neu', timeout: 5 }] }],
    })
    expect(changed['lint-checker']).toEqual({ PostToolUse: [{ matcher: 'edit_file', hooks: [{ type: 'command', command: './scripts/lint.sh', timeout: 10 }] }] })
    expect(changed.nexa).toEqual({ PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo neu', timeout: 5 }] }] })
    expect(changed['safety-gate']).toEqual(FILE['safety-gate'])
    // A named hook without any event left goes.
    expect(withAntigravityHooks(FILE, { event: 'PreInvocation', version: '', groups: [] }).reminder).toBeUndefined()
    // Flat events keep their handlers directly.
    expect(withAntigravityHooks(FILE, { event: 'PreInvocation', version: '', groups: pre!.groups }).reminder).toEqual(FILE.reminder)
  })
})

describe('AntigravityConfig', () => {
  let dir: string
  let account: AccountEnv
  const config = new AntigravityConfig()

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-agy-'))
    account = { accountId: 'k', set: {}, unset: [], dir: join(dir, 'home') }
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it("reads and writes the user's files in the account's folder, keeping what Nexa doesn't know", async () => {
    await mkdir(join(dir, 'home', 'config'), { recursive: true })
    await writeFile(join(dir, 'home', 'config', 'mcp_config.json'), '')
    const ctx = { account, scope: 'user' as const }
    expect((await config.read(ctx)).mcp.servers).toEqual([])
    await config.saveMcpServer(ctx, { name: 'docs', transport: 'stdio', command: 'node', args: ['srv.js'] }, null)
    await config.savePermissions(ctx, { 'permissions.allow': ['command(git status)'] })
    const read = await config.read(ctx)
    expect(read.mcp.servers.map((s) => s.name)).toEqual(['docs'])
    expect(read.files.map((f) => f.exists)).toEqual([true, false, true])
    expect(JSON.parse(await readFile(join(dir, 'home', 'config', 'mcp_config.json'), 'utf8'))).toEqual({ mcpServers: { docs: { command: 'node', args: ['srv.js'] } } })
    expect(JSON.parse(await readFile(join(dir, 'home', 'antigravity-cli', 'settings.json'), 'utf8'))).toEqual({ permissions: { allow: ['command(git status)'] } })
    await config.saveHooks(ctx, { event: 'Stop', version: read.hooks.version, groups: [{ matcher: null, hooks: [{ type: 'command', command: 'echo fertig' }] }] })
    expect(JSON.parse(await readFile(join(dir, 'home', 'config', 'hooks.json'), 'utf8'))).toEqual({ nexa: { Stop: [{ type: 'command', command: 'echo fertig' }] } })
    await config.removeMcpServer(ctx, 'docs')
    expect((await config.read(ctx)).mcp.servers).toEqual([])
  })

  it("keeps a project's servers and hooks in its .agents folder, its rules to the CLI", async () => {
    const ctx = { account, scope: 'project' as const, folder: join(dir, 'proj') }
    await config.saveMcpServer(ctx, { name: 'web', transport: 'http', url: 'https://x/mcp' }, null)
    expect(JSON.parse(await readFile(join(dir, 'proj', '.agents', 'mcp_config.json'), 'utf8'))).toEqual({ mcpServers: { web: { url: 'https://x/mcp' } } })
    const read = await config.read(ctx)
    expect(read.permissions.fields).toEqual([])
    await expect(config.savePermissions(ctx, { 'permissions.allow': [] })).rejects.toThrow(/Projekt/)
  })

  it("refuses hooks that changed since they were read, and a file that isn't JSON", async () => {
    const ctx = { account, scope: 'user' as const }
    const { version } = (await config.read(ctx)).hooks
    await mkdir(join(dir, 'home', 'config'), { recursive: true })
    await writeFile(join(dir, 'home', 'config', 'hooks.json'), '{"x":{"Stop":[{"command":"a"}]}}')
    await expect(config.saveHooks(ctx, { event: 'Stop', version, groups: [] })).rejects.toThrow(/geändert/)
    await writeFile(join(dir, 'home', 'config', 'mcp_config.json'), '{ nope')
    expect((await config.read(ctx)).readOnly).toMatch(/kein gültiges JSON/)
  })
})
