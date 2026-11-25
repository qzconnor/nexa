import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AccountEnv } from '../../accounts/account-env'
import {
  GeminiConfig,
  geminiConfigFiles,
  geminiPermissionFields,
  geminiServerEnabled,
  geminiServerIn,
  geminiServerOut,
  stripJsonComments,
  withGeminiPermissions,
} from './gemini-config'

describe('stripJsonComments', () => {
  it('drops line and block comments outside strings and tells that there were some', () => {
    const text = '{\n  // user\n  "a": "http://x // not a comment", /* b */ "b": "\\"/*\\"" }'
    const stripped = stripJsonComments(text)
    expect(stripped.comments).toBe(true)
    expect(JSON.parse(stripped.text)).toEqual({ a: 'http://x // not a comment', b: '"/*"' })
    expect(stripJsonComments('{"a": 1}')).toEqual({ text: '{"a": 1}', comments: false })
  })
})

describe('geminiServerOut / geminiServerIn', () => {
  it('shows a stdio server with its secrets withheld, and writes it back over its other keys', () => {
    const raw = { command: 'npx', args: ['-y', 'srv'], env: { API_KEY: 'sk-1', MODE: 'x' }, trust: true, timeout: 30000 }
    const shown = geminiServerOut('docs', raw, true)
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
      other: ['trust', 'timeout'],
    })
    expect(geminiServerIn({ ...shown, args: ['-y', 'srv', ''] }, raw)).toEqual({ command: 'npx', args: ['-y', 'srv'], env: { API_KEY: 'sk-1', MODE: 'x' }, trust: true, timeout: 30000 })
  })

  it('reads the transports as Gemini CLI picks them', () => {
    expect(geminiServerOut('a', { httpUrl: 'https://x/mcp' }).transport).toBe('http')
    expect(geminiServerOut('b', { url: 'https://x/sse', type: 'sse' }).transport).toBe('sse')
    expect(geminiServerOut('c', { url: 'https://x/mcp' }).transport).toBe('http')
    expect(geminiServerOut('d', { url: 'https://x', type: 'ws' }).locked).toContain('ws')
    expect(geminiServerOut('e', { command: 'node' }).enabled).toBeUndefined()
  })

  it('writes a remote server with url and type, and keeps an old httpUrl while it stays HTTP', () => {
    const raw = { httpUrl: 'https://old/mcp', headers: { Authorization: 'Bearer t' }, includeTools: ['a'] }
    const shown = geminiServerOut('r', raw)
    expect(shown.headers).toEqual([{ name: 'Authorization', value: '', masked: true }])
    expect(geminiServerIn({ ...shown, url: 'https://new/mcp' }, raw)).toEqual({ httpUrl: 'https://new/mcp', headers: { Authorization: 'Bearer t' }, includeTools: ['a'] })
    expect(geminiServerIn({ ...shown, transport: 'sse', url: 'https://new/sse' }, raw)).toEqual({
      url: 'https://new/sse',
      type: 'sse',
      headers: { Authorization: 'Bearer t' },
      includeTools: ['a'],
    })
    expect(geminiServerIn({ name: 'n', transport: 'http', url: 'https://x' }, undefined)).toEqual({ url: 'https://x', type: 'http' })
  })
})

describe('geminiServerEnabled', () => {
  it('takes a server as on unless its name in lower case says enabled: false', () => {
    expect(geminiServerEnabled(null, 'A')).toBe(true)
    expect(geminiServerEnabled({ docs: { enabled: false } }, 'Docs')).toBe(false)
    expect(geminiServerEnabled({ docs: { enabled: true } }, 'docs')).toBe(true)
  })
})

describe('permissions', () => {
  it('shows the fields of the settings and keeps an unknown mode as an option', () => {
    const fields = geminiPermissionFields({ general: { defaultApprovalMode: 'yolo' }, tools: { allowed: ['read_file'] } })
    const mode = fields.find((f) => f.key === 'general.defaultApprovalMode')
    expect(mode?.kind === 'select' && mode.value).toBe('yolo')
    expect(mode?.kind === 'select' && mode.options.map((o) => o.value)).toEqual(['default', 'auto_edit', 'plan', 'yolo'])
    expect(fields.find((f) => f.key === 'tools.allowed')?.value).toEqual(['read_file'])
  })

  it('writes the values into their groups and removes what is emptied', () => {
    const data: Record<string, unknown> = { general: { vimMode: true }, tools: { allowed: ['a'], sandbox: 'docker' } }
    withGeminiPermissions(data, { 'general.defaultApprovalMode': 'plan', 'tools.allowed': [' b ', 'b', ''], 'context.includeDirectories': [] })
    expect(data).toEqual({ general: { vimMode: true, defaultApprovalMode: 'plan' }, tools: { allowed: ['b'], sandbox: 'docker' } })
    withGeminiPermissions(data, { 'general.defaultApprovalMode': null, 'tools.allowed': null })
    expect(data).toEqual({ general: { vimMode: true }, tools: { sandbox: 'docker' } })
    expect(() => withGeminiPermissions(data, { 'tools.core': ['x'] })).toThrow('kennt Nexa nicht')
  })
})

describe('GeminiConfig', () => {
  let dir: string
  let account: AccountEnv
  let project: string
  const userFile = () => join(dir, 'home', '.gemini', 'settings.json')
  const enablementFile = () => join(dir, 'home', '.gemini', 'mcp-server-enablement.json')
  const json = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-gemini-config-'))
    project = join(dir, 'app')
    await mkdir(join(project, '.gemini'), { recursive: true })
    await mkdir(join(dir, 'home', '.gemini'), { recursive: true })
    account = { accountId: 'acc', set: { GEMINI_CLI_HOME: join(dir, 'home') }, unset: [] }
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads the user scope with its switches and hook timeouts in seconds', async () => {
    await writeFile(
      userFile(),
      JSON.stringify({
        mcpServers: { docs: { command: 'docs' }, Web: { url: 'https://x', type: 'sse' } },
        hooks: { BeforeTool: [{ matcher: 'write_.*', hooks: [{ name: 'lint', type: 'command', command: 'lint.sh', timeout: 1500 }] }] },
      }),
    )
    await writeFile(enablementFile(), JSON.stringify({ web: { enabled: false } }))
    const read = await new GeminiConfig().read({ account, scope: 'user' })
    expect(read.files.map((f) => [f.path, f.exists])).toEqual([
      [userFile(), true],
      [enablementFile(), true],
    ])
    expect(read.mcp.servers.map((s) => [s.name, s.enabled])).toEqual([
      ['docs', true],
      ['Web', false],
    ])
    expect(read.hooks.configs[0]?.groups[0]?.hooks[0]).toMatchObject({ command: 'lint.sh', timeout: 1.5 })
    expect(read.readOnly).toBeUndefined()
  })

  it('only shows a file with comments, and the home folder as project', async () => {
    await writeFile(join(project, '.gemini', 'settings.json'), '{\n  // mine\n  "mcpServers": { "a": { "command": "a" } }\n}')
    const read = await new GeminiConfig().read({ account, scope: 'project', folder: project })
    expect(read.mcp.servers.map((s) => s.name)).toEqual(['a'])
    expect(read.readOnly).toContain('Kommentare')
    await expect(new GeminiConfig().removeMcpServer({ account, scope: 'project', folder: project }, 'a')).rejects.toThrow('kein gültiges JSON')

    const home = geminiConfigFiles(account, 'project', join(dir, 'home'))
    expect(home.sameAsUser).toBe(true)
    expect((await new GeminiConfig().read({ account, scope: 'project', folder: join(dir, 'home') })).readOnly).toContain('dieselbe Datei')
  })

  it('adds, renames in place, switches and removes a server, keeping what Nexa does not know', async () => {
    await writeFile(userFile(), JSON.stringify({ ui: { theme: 'x' }, mcpServers: { first: { command: 'a' }, docs: { command: 'd', env: { TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, trust: true } } }))
    const config = new GeminiConfig()
    const ctx = { account, scope: 'user' as const }
    const docs = (await config.read(ctx)).mcp.servers.find((s) => s.name === 'docs')!
    expect(docs.env).toEqual([{ name: 'TOKEN', value: '', masked: true }])

    await config.saveMcpServer(ctx, { ...docs, name: 'docs-2' }, 'docs')
    let file = await json(userFile())
    expect(Object.keys(file.mcpServers as object)).toEqual(['first', 'docs-2'])
    expect(file).toMatchObject({ ui: { theme: 'x' }, mcpServers: { 'docs-2': { command: 'd', env: { TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, trust: true } } })

    // The switch writes only the enablement file.
    const before = await readFile(userFile(), 'utf8')
    await config.saveMcpServer(ctx, { ...docs, name: 'docs-2', enabled: false }, 'docs-2')
    expect(await readFile(userFile(), 'utf8')).toBe(before)
    expect(await json(enablementFile())).toEqual({ 'docs-2': { enabled: false } })
    await config.saveMcpServer(ctx, { ...docs, name: 'docs-2', enabled: true }, 'docs-2')
    expect(await json(enablementFile())).toEqual({})

    await config.saveMcpServer(ctx, { name: 'web', transport: 'http', url: 'https://x/mcp' }, null)
    await expect(config.saveMcpServer(ctx, { name: 'web', transport: 'stdio', command: 'x' }, null)).rejects.toThrow('gibt es hier schon')
    await expect(config.saveMcpServer(ctx, { name: 'my_server', transport: 'stdio', command: 'x' }, null)).rejects.toThrow('„_“')
    file = await json(userFile())
    expect((file.mcpServers as Record<string, unknown>).web).toEqual({ url: 'https://x/mcp', type: 'http' })

    await config.removeMcpServer(ctx, 'first')
    await config.removeMcpServer(ctx, 'docs-2')
    await config.removeMcpServer(ctx, 'web')
    expect(await json(userFile())).toEqual({ ui: { theme: 'x' } })
  })

  it('saves hooks with their timeout in milliseconds and refuses a stale version', async () => {
    await writeFile(join(project, '.gemini', 'settings.json'), JSON.stringify({ hooks: { AfterTool: [{ matcher: 'x', sequential: true, hooks: [{ name: 'n', type: 'command', command: 'old' }] }] } }))
    const config = new GeminiConfig()
    const ctx = { account, scope: 'project' as const, folder: project }
    const read = await config.read(ctx)
    const group = read.hooks.configs[0]!.groups[0]!
    await config.saveHooks(ctx, { event: 'AfterTool', version: read.hooks.version, groups: [{ ...group, hooks: [{ ...group.hooks[0]!, command: 'new', timeout: 2 }] }] })
    expect(await json(join(project, '.gemini', 'settings.json'))).toEqual({
      hooks: { AfterTool: [{ matcher: 'x', sequential: true, hooks: [{ type: 'command', command: 'new', name: 'n', timeout: 2000 }] }] },
    })
    await expect(config.saveHooks(ctx, { event: 'AfterTool', version: read.hooks.version, groups: [] })).rejects.toThrow('außerhalb von Nexa')
  })
})
