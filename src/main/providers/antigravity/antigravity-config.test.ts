import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountEnv } from '../../accounts/account-env'
import {
  AntigravityConfig,
  antigravityHooksOut,
  antigravityMcpList,
  antigravityMcpServers,
  antigravityPermissionFields,
  antigravityProjectRuleFields,
  antigravityServerIn,
  antigravityServerOut,
  setAntigravityMcpEnabled,
  withAntigravityHooks,
  withAntigravityPermissions,
  withAntigravityProjectRules,
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

describe('project rules', () => {
  // The file as Antigravity CLI 1.5.16 wrote it after rules were added under /permissions › Project.
  const written = {
    id: 'default-cli-project',
    name: 'CLI Project',
    projectResources: {},
    permissionGrants: { permissionGrants: { allow: ['command(git status)'], deny: ['read_file(secret.txt)'], ask: ['command(git push)'] } },
  }

  it('shows the three lists of the Antigravity project', () => {
    expect(antigravityProjectRuleFields(written).map((f) => [f.key, f.value])).toEqual([
      ['project.allow', ['command(git status)']],
      ['project.deny', ['read_file(secret.txt)']],
      ['project.ask', ['command(git push)']],
    ])
    expect(antigravityProjectRuleFields(null).every((f) => f.kind === 'list' && f.value.length === 0)).toBe(true)
  })

  it('writes a list over what the file has besides, and removes the rules once all are emptied', () => {
    const data = structuredClone({ ...written, marker: 1 }) as Record<string, unknown>
    withAntigravityProjectRules(data, { 'project.allow': ['command(npm test)', ' ', 'command(npm test)'] })
    expect(data).toMatchObject({ marker: 1, permissionGrants: { permissionGrants: { allow: ['command(npm test)'], deny: ['read_file(secret.txt)'] } } })
    withAntigravityProjectRules(data, { 'project.allow': [], 'project.deny': null, 'project.ask': [] })
    expect(data).toEqual({ id: 'default-cli-project', name: 'CLI Project', projectResources: {}, marker: 1 })
    expect(() => withAntigravityProjectRules(data, { agentMode: 'auto' })).toThrow(/kennt Nexa nicht/)
  })
})

describe('MCP servers for the „+“ menu', () => {
  it("lists the user's servers, then the folder's, each switched in its file", () => {
    const user = { mcpServers: { docs: { command: 'node' }, web: { url: 'https://x', disabled: true } } }
    const project = { mcpServers: { local: { command: 'py' }, docs: { command: 'other' } } }
    expect(antigravityMcpList(user, project)).toEqual([
      { name: 'docs', status: 'configured', scope: 'user', enabled: true, switchIn: 'cli' },
      { name: 'web', status: 'disabled', scope: 'user', enabled: false, switchIn: 'cli' },
      { name: 'local', status: 'configured', scope: 'project', enabled: true, switchIn: 'cli' },
    ])
    expect(antigravityMcpList(null, {})).toEqual([])
  })

  it('switches a server where it is set up, the user’s file before the folder’s', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nexa-agy-'))
    try {
      const account: AccountEnv = { accountId: 'k', set: {}, unset: [], dir: join(dir, 'home') }
      const folder = join(dir, 'proj')
      await mkdir(join(dir, 'home', 'config'), { recursive: true })
      await mkdir(join(folder, '.agents'), { recursive: true })
      await writeFile(join(dir, 'home', 'config', 'mcp_config.json'), JSON.stringify({ mcpServers: { docs: { command: 'node', timeoutSeconds: 5 } } }))
      await writeFile(join(folder, '.agents', 'mcp_config.json'), JSON.stringify({ mcpServers: { local: { command: 'py' }, docs: { command: 'other' } } }))
      await setAntigravityMcpEnabled(account, folder, 'docs', false)
      await setAntigravityMcpEnabled(account, folder, 'local', false)
      expect(JSON.parse(await readFile(join(dir, 'home', 'config', 'mcp_config.json'), 'utf8'))).toEqual({ mcpServers: { docs: { command: 'node', timeoutSeconds: 5, disabled: true } } })
      expect(JSON.parse(await readFile(join(folder, '.agents', 'mcp_config.json'), 'utf8')).mcpServers).toEqual({ local: { command: 'py', disabled: true }, docs: { command: 'other' } })
      expect((await antigravityMcpServers(account, folder)).map((s) => [s.name, s.enabled])).toEqual([
        ['docs', false],
        ['local', false],
      ])
      await setAntigravityMcpEnabled(account, folder, 'docs', true)
      expect(JSON.parse(await readFile(join(dir, 'home', 'config', 'mcp_config.json'), 'utf8'))).toEqual({ mcpServers: { docs: { command: 'node', timeoutSeconds: 5 } } })
      await expect(setAntigravityMcpEnabled(account, folder, 'gone', true)).rejects.toThrow(/nicht mehr/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
    expect(read.files.map((f) => [f.label, f.exists])).toEqual([
      ['MCP-Server', true],
      ['Hooks', false],
      ['Berechtigungen', true],
      ['Geteilte Regeln', false],
    ])
    expect(JSON.parse(await readFile(join(dir, 'home', 'config', 'mcp_config.json'), 'utf8'))).toEqual({ mcpServers: { docs: { command: 'node', args: ['srv.js'] } } })
    expect(JSON.parse(await readFile(join(dir, 'home', 'antigravity-cli', 'settings.json'), 'utf8'))).toEqual({ permissions: { allow: ['command(git status)'] } })
    await config.saveHooks(ctx, { event: 'Stop', version: read.hooks.version, groups: [{ matcher: null, hooks: [{ type: 'command', command: 'echo fertig' }] }] })
    expect(JSON.parse(await readFile(join(dir, 'home', 'config', 'hooks.json'), 'utf8'))).toEqual({ nexa: { Stop: [{ type: 'command', command: 'echo fertig' }] } })
    await config.removeMcpServer(ctx, 'docs')
    expect((await config.read(ctx)).mcp.servers).toEqual([])
  })

  it('shows and writes the rules shared with Antigravity’s app in config.json, keeping its other settings', async () => {
    const ctx = { account, scope: 'user' as const }
    const file = join(dir, 'home', 'config', 'config.json')
    await mkdir(join(dir, 'home', 'config'), { recursive: true })
    await writeFile(file, JSON.stringify({ plugins: { a: 1 }, userSettings: { theme: 'dark', globalPermissionGrants: { allow: ['command(ls)'] } } }))
    const fields = (await config.read(ctx)).permissions.fields.filter((f) => f.group === 'Geteilt mit Antigravity')
    expect(fields.map((f) => [f.key, f.value])).toEqual([
      ['shared.allow', ['command(ls)']],
      ['shared.ask', []],
      ['shared.deny', []],
    ])
    await config.savePermissions(ctx, { 'shared.deny': ['read_file(.env)'], 'permissions.ask': ['command(git push)'] })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      plugins: { a: 1 },
      userSettings: { theme: 'dark', globalPermissionGrants: { allow: ['command(ls)'], deny: ['read_file(.env)'] } },
    })
    expect(JSON.parse(await readFile(join(dir, 'home', 'antigravity-cli', 'settings.json'), 'utf8'))).toEqual({ permissions: { ask: ['command(git push)'] } })
    await config.savePermissions(ctx, { 'shared.allow': [], 'shared.deny': [] })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ plugins: { a: 1 }, userSettings: { theme: 'dark' } })
  })

  it('shows an mcp_config.json with comments, but leaves it as it is', async () => {
    const ctx = { account, scope: 'user' as const }
    const file = join(dir, 'home', 'config', 'mcp_config.json')
    const text = '{\n  // docs server\n  "mcpServers": {\n    "docs": { "command": "node", /* local */ "args": ["srv.js",], },\n  },\n}\n'
    await mkdir(join(dir, 'home', 'config'), { recursive: true })
    await writeFile(file, text)
    const read = await config.read(ctx)
    expect(read.readOnly).toBeUndefined()
    expect(read.mcp.servers.map((s) => [s.name, s.args])).toEqual([['docs', ['srv.js']]])
    expect((await antigravityMcpServers(account, join(dir, 'proj'))).map((s) => s.name)).toEqual(['docs'])
    await expect(config.saveMcpServer(ctx, { name: 'web', transport: 'http', url: 'https://x/mcp' }, null)).rejects.toThrow(/kein gültiges JSON/)
    expect(await readFile(file, 'utf8')).toBe(text)
  })

  it("keeps a project's servers and hooks in its .agents folder, its rules in the Antigravity project", async () => {
    const ctx = { account, scope: 'project' as const, folder: join(dir, 'proj') }
    await config.saveMcpServer(ctx, { name: 'web', transport: 'http', url: 'https://x/mcp' }, null)
    expect(JSON.parse(await readFile(join(dir, 'proj', '.agents', 'mcp_config.json'), 'utf8'))).toEqual({ mcpServers: { web: { url: 'https://x/mcp' } } })
    const read = await config.read(ctx)
    expect(read.permissions.fields.map((f) => f.key)).toEqual(['project.allow', 'project.deny', 'project.ask'])
    expect(read.permissions.note).toMatch(/allen Projekten/)
    expect(read.files.at(-1)).toMatchObject({ label: 'Projektregeln', exists: false })
    await config.savePermissions(ctx, { 'project.deny': ['read_file(secret.txt)'] })
    const file = join(dir, 'home', 'config', 'projects', 'default-cli-project.json')
    // As Antigravity writes a project it opened, with the rules nested twice.
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      id: 'default-cli-project',
      name: 'CLI Project',
      projectResources: {},
      permissionGrants: { permissionGrants: { deny: ['read_file(secret.txt)'] } },
    })
    await expect(config.savePermissions(ctx, { 'permissions.allow': [] })).rejects.toThrow(/kennt Nexa nicht/)
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
