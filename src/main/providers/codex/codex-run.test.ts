import { describe, expect, it } from 'vitest'
import { codexMcpConfig, commandView, skillInputs, unwrapShell } from './codex-run'

describe('unwrapShell', () => {
  it('takes the command out of PowerShell', () => {
    expect(unwrapShell(`"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Get-Content -LiteralPath hello.txt'`)).toBe(
      'Get-Content -LiteralPath hello.txt',
    )
  })

  it('undoes PowerShell quoting', () => {
    expect(unwrapShell(`powershell.exe -NoProfile -Command 'Write-Output ''hi'''`)).toBe("Write-Output 'hi'")
    expect(unwrapShell(`pwsh -Command "Add-Content x.txt -Value \`"a\`""`)).toBe('Add-Content x.txt -Value "a"')
  })

  it('finds a shell in a folder with spaces', () => {
    expect(unwrapShell(`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'git status'`)).toBe('git status')
  })

  it('takes the command out of bash and cmd', () => {
    expect(unwrapShell(`/bin/bash -lc 'ls -la src'`)).toBe('ls -la src')
    expect(unwrapShell(`bash -c "echo \\"hi\\""`)).toBe('echo "hi"')
    expect(unwrapShell(`cmd.exe /d /c "dir /b"`)).toBe('dir /b')
  })

  it('leaves other commands alone', () => {
    expect(unwrapShell('git status')).toBe('git status')
    expect(unwrapShell('node -c script.js')).toBe('node -c script.js')
  })
})

describe('commandView', () => {
  const ps = (inner: string) => `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command '${inner}'`

  it('shows a read as reading the file', () => {
    const view = commandView(ps('Get-Content README.md'), [{ type: 'read', command: 'Get-Content README.md', name: 'README.md', path: 'C:/p/README.md' }])
    expect(view).toEqual({ tool: 'read', title: 'Datei lesen', detail: 'C:/p/README.md', command: 'Get-Content README.md' })
  })

  it('shows searches and listings', () => {
    expect(commandView('rg foo src', [{ type: 'search', command: 'rg foo src', query: 'foo', path: 'src' }])).toMatchObject({
      tool: 'search',
      title: 'Suchen',
      detail: 'foo in src',
    })
    expect(commandView('ls', [{ type: 'listFiles', command: 'ls', path: 'src' }])).toMatchObject({ tool: 'search', detail: 'src' })
  })

  it('shows anything else as the plain command', () => {
    expect(commandView(ps('npm test'), [{ type: 'unknown', command: 'npm test' }])).toEqual({
      tool: 'bash',
      title: 'Befehl ausführen',
      detail: 'npm test',
      command: 'npm test',
    })
    expect(commandView(ps('npm test'), undefined).command).toBe('npm test')
  })

  it('joins several actions', () => {
    const view = commandView('x', [
      { type: 'read', command: 'cat a', name: 'a', path: 'a' },
      { type: 'unknown', command: 'npm test' },
    ])
    expect(view).toMatchObject({ tool: 'bash', command: 'cat a && npm test' })
  })
})

describe('codexMcpConfig', () => {
  const mcp = { url: 'http://127.0.0.1:4100/mcp', token: 'abc', allowed: ['render_chart', 'browser_click'], ask: ['browser_evaluate'] }

  it('gives each thread its own token, so the server knows its chat', () => {
    const config = codexMcpConfig(mcp, 'ask') as Record<string, unknown>
    expect(config['mcp_servers.nexa.url']).toBe(mcp.url)
    expect(config['mcp_servers.nexa.http_headers']).toEqual({ Authorization: 'Bearer abc' })
    expect(config['mcp_servers.nexa.tool_timeout_sec']).toBeGreaterThan(60)
  })

  it('runs the allowed tools without asking and asks for the sensitive ones', () => {
    const config = codexMcpConfig(mcp, 'auto') as Record<string, unknown>
    expect(config['mcp_servers.nexa.tools']).toEqual({
      render_chart: { approval_mode: 'approve' },
      browser_click: { approval_mode: 'approve' },
      browser_evaluate: { approval_mode: 'prompt' },
    })
  })

  it('asks for nothing with full permissions', () => {
    const config = codexMcpConfig(mcp, 'full') as Record<string, unknown>
    expect(config['mcp_servers.nexa.tools']).not.toHaveProperty('browser_evaluate')
  })
})

describe('skillInputs', () => {
  const skills = [
    { name: 'pdf', kind: 'skill' as const, insert: '$pdf', path: '/skills/pdf/SKILL.md' },
    { name: 'deploy.prod', kind: 'skill' as const, insert: '$deploy.prod', path: '/skills/deploy/SKILL.md' },
    { name: 'nopath', kind: 'skill' as const, insert: '$nopath' },
  ]

  it('adds the skills named with $ to the input', () => {
    expect(skillInputs('$pdf lies das und dann $deploy.prod', skills)).toEqual([
      { type: 'skill', name: 'pdf', path: '/skills/pdf/SKILL.md' },
      { type: 'skill', name: 'deploy.prod', path: '/skills/deploy/SKILL.md' },
    ])
  })

  it('ignores prices, unknown names and skills without a file', () => {
    expect(skillInputs('kostet 5$pdf, $unbekannt, $nopath', skills)).toEqual([])
  })
})
