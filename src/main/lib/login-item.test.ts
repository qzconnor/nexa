import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn(),
  },
}))
vi.mock('electron', () => electron)

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const setPlatform = (value: NodeJS.Platform) => Object.defineProperty(process, 'platform', { ...platform, value })

// The AppImage the system starts; the package type is read once, at the first call.
const APPIMAGE = '/home/a/Apps/Nexa 1.0 "neu".AppImage'
vi.stubEnv('APPIMAGE', APPIMAGE)
setPlatform('linux')
const { autostartEntry, quoteExec, setLaunchAtLogin } = await import('./login-item')

let dir: string
const file = () => join(dir, 'autostart', 'nexa.desktop')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexa-autostart-'))
  vi.stubEnv('XDG_CONFIG_HOME', dir)
  setPlatform('linux')
  electron.app.isPackaged = true
  electron.app.setLoginItemSettings.mockClear()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

afterAll(() => {
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
})

describe('autostart entry', () => {
  it('quotes the path for the Exec key', () => {
    expect(quoteExec('/a b/"x"$y%z\\')).toBe('"/a b/\\"x\\"\\$y%%z\\\\"')
    expect(autostartEntry('/opt/Nexa/nexa')).toContain('Exec="/opt/Nexa/nexa" --autostart\n')
  })
})

describe('setLaunchAtLogin on Linux', () => {
  it('writes and removes the entry with the AppImage file', async () => {
    setLaunchAtLogin(true)
    expect(await readFile(file(), 'utf8')).toBe(autostartEntry(APPIMAGE))
    setLaunchAtLogin(false)
    expect(existsSync(file())).toBe(false)
  })

  it('keeps an entry the desktop switched off, as long as it starts the same file', async () => {
    const own = autostartEntry(APPIMAGE).replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=false')
    await mkdir(join(dir, 'autostart'), { recursive: true })
    await writeFile(file(), own)
    setLaunchAtLogin(true, true)
    expect(await readFile(file(), 'utf8')).toBe(own)
    // Asked for by the user: the entry is written again.
    setLaunchAtLogin(true)
    expect(await readFile(file(), 'utf8')).toBe(autostartEntry(APPIMAGE))
  })

  it('leaves development builds alone', () => {
    electron.app.isPackaged = false
    setLaunchAtLogin(true)
    expect(existsSync(file())).toBe(false)
  })
})

describe('setLaunchAtLogin on Windows', () => {
  it('registers the start with the switch, and leaves a matching one alone', () => {
    setPlatform('win32')
    setLaunchAtLogin(true)
    expect(electron.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, args: ['--autostart'] })
    electron.app.setLoginItemSettings.mockClear()
    setLaunchAtLogin(false, true)
    expect(electron.app.setLoginItemSettings).not.toHaveBeenCalled()
  })
})
