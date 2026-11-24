import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { findOnPath, shellLaunch, UserShells } from './user-shells'

const WIN_ENV = { PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd;C:\\Program Files\\PowerShell\\7', ProgramFiles: 'C:\\Program Files', ComSpec: 'C:\\Windows\\system32\\cmd.exe' }
const has = (...paths: string[]) => (path: string) => paths.includes(path)

describe('shellLaunch', () => {
  it("takes the user's login shell outside Windows", () => {
    expect(shellLaunch('cmd', 'ls -la', 'linux', { SHELL: '/usr/bin/zsh' })).toEqual({ name: 'zsh', file: '/usr/bin/zsh', args: ['-c', 'ls -la'] })
    expect(shellLaunch('powershell', 'ls', 'darwin', {}).file).toBe('/bin/bash')
  })

  it('takes PowerShell 7 where it is installed, else 5.1, with the command encoded', () => {
    const seven = shellLaunch('powershell', 'git status', 'win32', WIN_ENV, has('C:\\Program Files\\PowerShell\\7\\pwsh.exe'))
    expect(seven).toMatchObject({ name: 'PowerShell 7', file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: expect.arrayContaining(['-Command', '-']) })
    const encoded = /FromBase64String\('([^']+)'\)/.exec(seven.stdin!)![1]!
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toMatch(/^git status\n/)
    expect(shellLaunch('powershell', 'dir', 'win32', WIN_ENV, has())).toMatchObject({ name: 'Windows PowerShell', file: 'powershell.exe' })
  })

  it('finds Git Bash next to git, and says when it is missing', () => {
    const bash = shellLaunch('gitbash', 'echo "$HOME"', 'win32', WIN_ENV, has('C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'))
    expect(bash).toMatchObject({ name: 'Git Bash', file: 'C:\\Program Files\\Git\\bin\\bash.exe', env: { NEXA_COMMAND: 'echo "$HOME"' } })
    expect(() => shellLaunch('gitbash', 'ls', 'win32', WIN_ENV, has())).toThrow('Git Bash ist nicht installiert')
  })

  it('hands cmd its command line as it is', () => {
    expect(shellLaunch('cmd', 'dir /b', 'win32', WIN_ENV, has())).toMatchObject({ file: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', '"dir /b"'], verbatim: true })
  })

  it('finds a program on the PATH', () => {
    expect(findOnPath('pwsh.exe', WIN_ENV, 'win32', has('C:\\Program Files\\PowerShell\\7\\pwsh.exe'))).toBe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')
    expect(findOnPath('git', { PATH: '/usr/local/bin:/usr/bin' }, 'linux', has('/usr/bin/git'))).toBe('/usr/bin/git')
  })
})

describe('UserShells', () => {
  /** Runs `command` in this system's shell; what came of it. */
  function run(shells: UserShells, command: string, id = 'item') {
    let output = ''
    const done = new Promise<{ code: number | null; stopped: boolean; error?: string }>((resolve) => {
      shells.run('chat', id, shellLaunch('powershell', command), tmpdir(), { output: (text) => (output = text), exit: resolve })
    })
    return { done, output: () => output }
  }

  it('runs a command and reports its output and exit code', async () => {
    const shells = new UserShells()
    const { done, output } = run(shells, 'echo hallo\nexit 3')
    expect(await done).toEqual({ code: 3, stopped: false })
    expect(output()).toContain('hallo')
    expect(shells.has('item')).toBe(false)
  }, 20_000)

  it.skipIf(process.platform !== 'win32')('gives PowerShell’s errors as text, with umlauts and several lines', async () => {
    const shells = new UserShells()
    const { done, output } = run(shells, 'if ($true) {\n  echo "Grüße"\n}\nGet-Item gibt-es-nicht.txt')
    expect(await done).toEqual({ code: 1, stopped: false })
    expect(output()).toContain('Grüße')
    expect(output()).toContain('Get-Item')
    expect(output()).not.toContain('CLIXML')
  }, 20_000)

  it('stops a command', async () => {
    const shells = new UserShells()
    const { done } = run(shells, process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30')
    await new Promise((r) => setTimeout(r, 500))
    expect(shells.has('item')).toBe(true)
    shells.stopAll('chat')
    expect((await done).stopped).toBe(true)
  }, 20_000)
})
