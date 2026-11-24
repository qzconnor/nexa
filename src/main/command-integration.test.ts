import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { CommandIntegration, parseDefaultValue } = await import('./command-integration')
type CommandSystem = import('./command-integration').CommandSystem

const LAUNCHER = 'C:\\Programme\\Nexa\\bin\\nx.exe'

/** nx.exe and the registry as a fake: what was registered, and which program owns the App Path. */
function fakeSystem(options: { registered?: boolean; owner?: string | null; files?: string[]; platform?: NodeJS.Platform; packaged?: boolean } = {}) {
  const state = { registered: options.registered ?? false }
  const calls: string[][] = []
  const files = new Set([LAUNCHER, ...(options.files ?? [])])
  const system: CommandSystem = {
    platform: options.platform ?? 'win32',
    packaged: options.packaged ?? true,
    launcher: LAUNCHER,
    exists: (path) => files.has(path),
    launch: async (file, args) => {
      calls.push([file, ...args])
      if (args[0] === '--nx-register') state.registered = true
      else if (args[0] === '--nx-unregister') state.registered = false
      else if (args[0] === '--nx-status' && !state.registered) throw new Error('exit code 1')
    },
    appPath: async () => options.owner ?? null,
  }
  return { system, calls, state }
}

describe('CommandIntegration', () => {
  it('asks nx.exe whether it is registered', async () => {
    const { system, calls } = fakeSystem({ registered: true })
    expect(await new CommandIntegration(system).status()).toEqual({ available: true, registered: true, launcherPath: LAUNCHER, hint: null })
    expect(calls).toEqual([[LAUNCHER, '--nx-status']])
  })

  it('registers and unregisters through nx.exe', async () => {
    const { system, calls, state } = fakeSystem()
    const command = new CommandIntegration(system)
    expect((await command.setRegistered(true)).registered).toBe(true)
    expect(state.registered).toBe(true)
    expect((await command.setRegistered(false)).registered).toBe(false)
    expect(calls.map((call) => call[1])).toEqual(['--nx-register', '--nx-status', '--nx-unregister', '--nx-status'])
  })

  it("names another program's nx, which it leaves alone", async () => {
    const other = 'C:\\Tools\\nx.exe'
    const { system } = fakeSystem({ owner: other, files: [other] })
    expect((await new CommandIntegration(system).status()).hint).toMatch(/schon für C:\\Tools\\nx\.exe registriert/)
    // A leftover entry of a program that is gone is no reason to worry.
    expect((await new CommandIntegration(fakeSystem({ owner: other }).system).status()).hint).toBeNull()
  })

  it('does nothing outside the installed app on Windows', async () => {
    for (const options of [{ packaged: false }, { platform: 'linux' as const }]) {
      const { system, calls } = fakeSystem(options)
      const command = new CommandIntegration(system)
      expect(await command.status()).toEqual({ available: false, registered: false, launcherPath: null, hint: null })
      await expect(command.setRegistered(true)).rejects.toThrow(/nur in der installierten App/)
      expect(calls).toEqual([])
    }
  })
})

describe('parseDefaultValue', () => {
  it('reads the value whatever the language calls it', () => {
    const output = '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\nx.exe\r\n    (Standard)    REG_SZ    "C:\\Programme\\Nexa\\bin\\nx.exe"\r\n'
    expect(parseDefaultValue(output)).toBe(LAUNCHER)
    expect(parseDefaultValue(output.replace('(Standard)', '(Default)'))).toBe(LAUNCHER)
  })

  it('expands variables and knows when there is none', () => {
    expect(parseDefaultValue('    (Default)    REG_EXPAND_SZ    %LOCALAPPDATA%\\x\\nx.exe', { LOCALAPPDATA: 'C:\\Local' })).toBe('C:\\Local\\x\\nx.exe')
    expect(parseDefaultValue('\r\nHKEY_CURRENT_USER\\Software\\Classes\r\n')).toBeNull()
  })
})
