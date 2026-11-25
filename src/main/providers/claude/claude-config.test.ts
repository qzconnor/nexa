import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountEnv } from '../../accounts/account-env'
import type { CliBinary } from '../cli-binary'
import { ClaudeConfig, claudePermissionFields, claudeProjectEntry, claudeServerIn, claudeServerOut, withClaudePermissions } from './claude-config'

describe('claudeServerOut / claudeServerIn', () => {
  it('shows a stdio server with its secrets withheld, and writes it back over its other keys', () => {
    const raw = { type: 'stdio', command: 'npx', args: ['-y', 'srv'], env: { API_KEY: 'sk-1', MODE: 'x' }, alwaysLoad: true }
    const shown = claudeServerOut('docs', raw)
    expect(shown).toEqual({
      name: 'docs',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'srv'],
      env: [
        { name: 'API_KEY', value: '', masked: true },
        { name: 'MODE', value: 'x' },
      ],
      other: ['alwaysLoad'],
    })
    expect(claudeServerIn({ ...shown, args: ['-y', 'srv', ''] }, raw)).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'srv'],
      env: { API_KEY: 'sk-1', MODE: 'x' },
      alwaysLoad: true,
    })
  })

  it('takes a server without type by its keys, and keeps one it does not edit locked', () => {
    expect(claudeServerOut('a', { command: 'node' }).transport).toBe('stdio')
    expect(claudeServerOut('b', { url: 'https://x' }).transport).toBe('http')
    const ws = claudeServerOut('c', { type: 'ws', url: 'wss://x' })
    expect(ws.locked).toContain('ws')
  })

  it('switches a server to another kind without the keys of the old one', () => {
    const raw = { type: 'stdio', command: 'node', env: { A: '1' }, oauth: { clientId: 'x' } }
    expect(claudeServerIn({ name: 'a', transport: 'http', url: ' https://x/mcp ', headers: [{ name: 'Authorization', value: 'Bearer t' }] }, raw)).toEqual({
      type: 'http',
      url: 'https://x/mcp',
      headers: { Authorization: 'Bearer t' },
      oauth: { clientId: 'x' },
    })
  })
})

describe('claudeProjectEntry', () => {
  it('finds the project by its folder, in any spelling', () => {
    const config = { projects: { 'F:/Code/app': { mcpServers: { a: {} } }, 'G:\\Old': { mcpServers: { b: {} } } } }
    expect(claudeProjectEntry(config, 'F:\\Code\\app')).toEqual({ mcpServers: { a: {} } })
    if (process.platform === 'win32') expect(claudeProjectEntry(config, 'g:\\old')).toEqual({ mcpServers: { b: {} } })
    expect(claudeProjectEntry(config, 'F:\\Other')).toBeNull()
    expect(claudeProjectEntry(null, 'F:\\Code\\app')).toBeNull()
  })
})

describe('permissions', () => {
  it('shows the mode and the rules, and an unknown mode as it is', () => {
    const fields = claudePermissionFields({ permissions: { defaultMode: 'future', allow: ['Bash(ls)', 3], deny: ['Read(./.env)'] } })
    const mode = fields[0]
    expect(mode.kind === 'select' && mode.value).toBe('future')
    expect(mode.kind === 'select' && mode.options.at(-1)).toEqual({ value: 'future', label: 'future' })
    expect(fields.find((f) => f.key === 'permissions.allow')?.value).toEqual(['Bash(ls)'])
    expect(fields.find((f) => f.key === 'permissions.ask')?.value).toEqual([])
  })

  it('sets and removes settings, and drops `permissions` once empty', () => {
    const data: Record<string, unknown> = { model: 'opus', permissions: { allow: ['A'], deny: ['B'], other: 1 } }
    withClaudePermissions(data, { 'permissions.allow': ['A', 'C', ''], 'permissions.deny': [], 'permissions.defaultMode': 'plan' })
    expect(data).toEqual({ model: 'opus', permissions: { allow: ['A', 'C'], other: 1, defaultMode: 'plan' } })
    const empty: Record<string, unknown> = { permissions: { defaultMode: 'plan' } }
    withClaudePermissions(empty, { 'permissions.defaultMode': null })
    expect(empty).toEqual({})
    expect(() => withClaudePermissions({}, { model: 'x' })).toThrow('model')
  })
})

describe('ClaudeConfig', () => {
  let dir: string
  let account: AccountEnv
  let project: string
  const output = vi.fn()
  const changed = vi.fn()
  const binary = { output } as unknown as CliBinary

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-claude-config-'))
    project = join(dir, 'app')
    await mkdir(join(project, '.claude'), { recursive: true })
    account = { accountId: 'acc', set: { CLAUDE_CONFIG_DIR: join(dir, 'profile') }, unset: [] }
    await mkdir(join(dir, 'profile'), { recursive: true })
    output.mockReset()
    output.mockResolvedValue({ ok: true, stdout: '', stderr: '' })
    changed.mockReset()
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads the user scope from the account folder', async () => {
    await writeFile(join(dir, 'profile', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo' }] }] } }))
    await writeFile(join(dir, 'profile', '.claude.json'), JSON.stringify({ mcpServers: { rea: { type: 'stdio', command: 'rea' } }, projects: {} }))
    const read = await new ClaudeConfig(binary, changed).read({ account, scope: 'user' })
    expect(read.files.map((f) => [f.path, f.exists])).toEqual([
      [join(dir, 'profile', 'settings.json'), true],
      [join(dir, 'profile', '.claude.json'), true],
    ])
    expect(read.mcp.servers.map((s) => s.name)).toEqual(['rea'])
    expect(read.mcp.manageUrl?.url).toContain('claude.ai')
    expect(read.hooks.configs[0]?.event).toBe('Stop')
    expect(read.readOnly).toBeUndefined()
  })

  it('reads the local scope from the project entry and tells about a broken file', async () => {
    await writeFile(join(dir, 'profile', '.claude.json'), JSON.stringify({ projects: { [project.replaceAll('\\', '/')]: { mcpServers: { loc: { type: 'http', url: 'https://x' } } } } }))
    await writeFile(join(project, '.claude', 'settings.local.json'), '{ nope')
    const read = await new ClaudeConfig(binary, changed).read({ account, scope: 'local', folder: project })
    expect(read.mcp.servers.map((s) => s.name)).toEqual(['loc'])
    expect(read.readOnly).toContain('settings.local.json')
  })

  it('adds a server through `claude mcp add-json` in the project folder, with the JSON on stdin', async () => {
    await new ClaudeConfig(binary, changed).saveMcpServer({ account, scope: 'project', folder: project }, { name: 'pj', transport: 'sse', url: 'https://y/sse' }, null)
    expect(output).toHaveBeenCalledTimes(1)
    const [args, options] = output.mock.calls[0]
    expect(args).toEqual(['mcp', 'add-json', 'pj', '-', '-s', 'project'])
    expect(options.cwd).toBe(project)
    expect(options.env.CLAUDE_CONFIG_DIR).toBe(join(dir, 'profile'))
    expect(JSON.parse(options.input)).toEqual({ type: 'sse', url: 'https://y/sse' })
    expect(changed).toHaveBeenCalledWith('acc')
  })

  it('replaces a server by removing and adding it, and puts the old one back when adding fails', async () => {
    await writeFile(join(dir, 'profile', '.claude.json'), JSON.stringify({ mcpServers: { old: { type: 'stdio', command: 'a', env: { TOKEN: 'secret' } } } }))
    output.mockResolvedValueOnce({ ok: true, stdout: '', stderr: '' }).mockResolvedValueOnce({ ok: false, stdout: '', stderr: 'Invalid configuration\nmore' })
    const config = new ClaudeConfig(binary, changed)
    const server = { name: 'new', transport: 'stdio' as const, command: 'b', env: [{ name: 'TOKEN', value: '', masked: true }] }
    await expect(config.saveMcpServer({ account, scope: 'user' }, server, 'old')).rejects.toThrow('Invalid configuration')
    expect(output.mock.calls.map((c) => c[0].slice(0, 3))).toEqual([
      ['mcp', 'remove', 'old'],
      ['mcp', 'add-json', 'new'],
      ['mcp', 'add-json', 'old'],
    ])
    expect(JSON.parse(output.mock.calls[1][1].input)).toEqual({ type: 'stdio', command: 'b', env: { TOKEN: 'secret' } })
    expect(JSON.parse(output.mock.calls[2][1].input)).toEqual({ type: 'stdio', command: 'a', env: { TOKEN: 'secret' } })
  })

  it('refuses a name that is taken', async () => {
    await writeFile(join(dir, 'profile', '.claude.json'), JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    await expect(new ClaudeConfig(binary, changed).saveMcpServer({ account, scope: 'user' }, { name: 'a', transport: 'stdio', command: 'y' }, null)).rejects.toThrow('gibt es hier schon')
    expect(output).not.toHaveBeenCalled()
  })

  it('saves hooks and permissions into the settings file, unless the hooks changed meanwhile', async () => {
    const file = join(project, '.claude', 'settings.json')
    await writeFile(file, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'a' }] }] } }))
    const config = new ClaudeConfig(binary, changed)
    const ctx = { account, scope: 'project' as const, folder: project }
    const read = await config.read(ctx)
    await config.saveHooks(ctx, {
      event: 'PreToolUse',
      version: read.hooks.version,
      groups: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check', timeout: 10 }] }],
    })
    await config.savePermissions(ctx, { 'permissions.deny': ['Read(./.env)'] })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      model: 'opus',
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'a' }] }],
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'check', timeout: 10 }] }],
      },
      permissions: { deny: ['Read(./.env)'] },
    })
    await expect(config.saveHooks(ctx, { event: 'Stop', version: read.hooks.version, groups: [] })).rejects.toThrow('außerhalb von Nexa')
    await expect(config.savePermissions(ctx, { 'permissions.defaultMode': 'yolo' })).rejects.toThrow('yolo')
  })
})
