import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalInfo } from '@shared/terminals'
import { Terminals, terminalLaunch, trimStart, type TerminalTarget } from './terminals'

const WIN_ENV = { PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd;C:\\Program Files\\PowerShell\\7', ProgramFiles: 'C:\\Program Files', ComSpec: 'C:\\Windows\\system32\\cmd.exe' }
const has = (...paths: string[]) => (path: string) => paths.includes(path)

describe('terminalLaunch', () => {
  it("takes the user's login shell outside Windows", () => {
    expect(terminalLaunch('cmd', 'linux', { SHELL: '/usr/bin/zsh' })).toEqual({ name: 'zsh', file: '/usr/bin/zsh', args: ['-l'] })
  })

  it('starts the shell of the settings interactively on Windows', () => {
    expect(terminalLaunch('powershell', 'win32', WIN_ENV, has('C:\\Program Files\\PowerShell\\7\\pwsh.exe'))).toEqual({
      name: 'PowerShell 7',
      file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoLogo'],
    })
    expect(terminalLaunch('powershell', 'win32', WIN_ENV, has())).toMatchObject({ name: 'Windows PowerShell', file: 'powershell.exe' })
    expect(terminalLaunch('cmd', 'win32', WIN_ENV, has())).toEqual({ name: 'cmd', file: 'C:\\Windows\\system32\\cmd.exe', args: [] })
  })

  it('keeps Git Bash in the folder it starts in, and says when it is missing', () => {
    expect(terminalLaunch('gitbash', 'win32', WIN_ENV, has('C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'))).toEqual({
      name: 'Git Bash',
      file: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['--login', '-i'],
      env: { CHERE_INVOKING: '1' },
    })
    expect(() => terminalLaunch('gitbash', 'win32', WIN_ENV, has())).toThrow('Git Bash ist nicht installiert')
  })
})

describe('trimStart', () => {
  it('keeps the end from the start of a line', () => {
    expect(trimStart('eins\nzwei\ndrei\n', 8)).toBe('drei\n')
    expect(trimStart('kurz', 10)).toBe('kurz')
  })
})

/** A pseudo console that only remembers what it was told. */
class FakePty {
  pid = 0
  cols: number
  rows: number
  written: string[] = []
  killed = false
  private data: ((data: string) => void)[] = []
  private exit: ((e: { exitCode: number }) => void)[] = []

  constructor(readonly file: string, readonly args: string[], readonly options: { cwd: string; env: Record<string, string>; cols: number; rows: number }) {
    this.cols = options.cols
    this.rows = options.rows
  }

  onData(cb: (data: string) => void) {
    this.data.push(cb)
    return { dispose: () => {} }
  }
  onExit(cb: (e: { exitCode: number }) => void) {
    this.exit.push(cb)
    return { dispose: () => {} }
  }
  write(data: string) {
    this.written.push(data)
  }
  resize(cols: number, rows: number) {
    this.cols = cols
    this.rows = rows
  }
  kill() {
    this.killed = true
  }
  say(data: string) {
    for (const cb of this.data) cb(data)
  }
  end(exitCode: number) {
    for (const cb of this.exit) cb({ exitCode })
  }
}

function setup(target: Partial<TerminalTarget> = {}) {
  const ptys: FakePty[] = []
  const terminals = new Terminals(
    () => ({ cwd: tmpdir(), env: null, account: null, ...target }),
    () => ({ name: 'zsh', file: '/bin/zsh', args: ['-l'] }),
    async () => ({ spawn: ((file: string, args: string[], options: FakePty['options']) => {
      const pty = new FakePty(file, args, options)
      ptys.push(pty)
      return pty
    }) as never }),
  )
  const data: [string, string, number][] = []
  const changes: TerminalInfo[][] = []
  terminals.on('data', (...args) => data.push(args))
  terminals.on('changed', (list) => changes.push(list))
  return { terminals, ptys, data, changes }
}

describe('Terminals', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts the shell in the chat's folder with its account's environment", async () => {
    const { terminals, ptys } = setup({ env: { accountId: 'a', set: { CLAUDE_CONFIG_DIR: '/profiles/a' }, unset: ['ANTHROPIC_API_KEY'] }, account: 'Arbeit' })
    process.env.ANTHROPIC_API_KEY = 'sk-test'
    try {
      const info = await terminals.create('chat', { cols: 120, rows: 40 })
      expect(info).toMatchObject({ sessionId: 'chat', shell: 'zsh', cwd: tmpdir(), account: 'Arbeit', status: 'running' })
      expect(ptys[0]!.options).toMatchObject({ cwd: tmpdir(), cols: 120, rows: 40 })
      expect(ptys[0]!.options.env.CLAUDE_CONFIG_DIR).toBe('/profiles/a')
      expect(ptys[0]!.options.env.ANTHROPIC_API_KEY).toBeUndefined()
    } finally {
      delete process.env.ANTHROPIC_API_KEY
    }
  })

  it('refuses a folder that is gone', async () => {
    const { terminals } = setup({ cwd: `${tmpdir()}/gibt-es-nicht-${Date.now()}` })
    await expect(terminals.create('chat', { cols: 80, rows: 24 })).rejects.toThrow('Den Ordner des Chats gibt es nicht mehr')
  })

  it('sends output in batches, and a buffer asked for in between gets nothing twice', async () => {
    vi.useFakeTimers()
    const { terminals, ptys, data } = setup()
    const { id } = await terminals.create('chat', { cols: 80, rows: 24 })
    ptys[0]!.say('PS> ')
    ptys[0]!.say('dir')
    expect(data).toEqual([])
    // The buffer sends what was pending first: the window drops it, it ends where the buffer does.
    expect(terminals.buffer(id)).toEqual({ text: 'PS> dir', end: 7 })
    expect(data).toEqual([[id, 'PS> dir', 7]])
    ptys[0]!.say('\r\n')
    vi.advanceTimersByTime(10)
    expect(data.at(-1)).toEqual([id, '\r\n', 9])
  })

  it('passes input and sizes on to the shell', async () => {
    const { terminals, ptys } = setup()
    const { id } = await terminals.create('chat', { cols: 80, rows: 24 })
    terminals.write(id, 'ls\r')
    terminals.resize(id, { cols: 132.7, rows: 50 })
    expect(ptys[0]!.written).toEqual(['ls\r'])
    expect([ptys[0]!.cols, ptys[0]!.rows]).toEqual([132, 50])
  })

  it('drops a terminal whose shell exits with 0, and keeps one that failed', async () => {
    const { terminals, ptys } = setup()
    const ok = await terminals.create('chat', { cols: 80, rows: 24 })
    const failed = await terminals.create('chat', { cols: 80, rows: 24 })
    ptys[0]!.end(0)
    ptys[1]!.end(2)
    expect(terminals.list()).toEqual([expect.objectContaining({ id: failed.id, status: 'exited', exitCode: 2 })])
    expect(terminals.list().some((t) => t.id === ok.id)).toBe(false)
  })

  it('ends the terminals of chats that went, and all of them when Nexa quits', async () => {
    const { terminals, ptys } = setup()
    await terminals.create('a', { cols: 80, rows: 24 })
    await terminals.create('b', { cols: 80, rows: 24 })
    terminals.keepSessions(new Set(['b']))
    expect(terminals.list().map((t) => t.sessionId)).toEqual(['b'])
    expect(ptys[0]!.killed).toBe(true)
    terminals.dispose()
    expect(terminals.list()).toEqual([])
    expect(ptys[1]!.killed).toBe(true)
    await expect(terminals.create('b', { cols: 80, rows: 24 })).rejects.toThrow()
  })
})
