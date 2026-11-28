import { describe, expect, it } from 'vitest'
import { PROVIDER_IDS } from './chat'
import { defaultSettings } from './defaults'
import {
  consistentChanges,
  exportedSettings,
  readSettingsFile,
  SETTINGS_FILE_FORMAT,
  SETTINGS_FILE_VERSION,
  settingChanges,
  settingsFile,
  settingsPatch,
  validSettings,
} from './settings-transfer'
import type { AppSettings } from './types'
import { mergeKnown } from './utils'

const settings = (patch: Record<string, unknown> = {}): AppSettings => mergeKnown(defaultSettings(), patch)

describe('settings file', () => {
  it('writes the settings without what belongs to this installation', () => {
    const current = settings({ setup: { done: true }, defaults: { projectsFolder: 'C:\\Users\\ada\\Projekte' }, api: { port: 50000 } })
    const exported = exportedSettings(current)
    expect(exported.setup).toEqual({})
    expect((exported.defaults as Record<string, unknown>).projectsFolder).toBeUndefined()
    expect((exported.api as Record<string, unknown>).port).toBe(50000)
    // The settings themselves stay as they are.
    expect(current.setup.done).toBe(true)
  })

  it('reads back what it wrote', () => {
    const file = settingsFile(settings({ appearance: { zoom: 125 } }), [], {
      appVersion: '1.4.0',
      platform: 'win32',
      now: new Date('2026-11-24T10:00:00Z'),
    })
    const read = readSettingsFile(JSON.parse(JSON.stringify(file)))
    expect(read).toMatchObject({ appVersion: '1.4.0', platform: 'win32', exportedAt: '2026-11-24T10:00:00.000Z', themes: [] })
    expect((read.settings.appearance as Record<string, unknown>).zoom).toBe(125)
  })

  it('takes a plain settings.json from the data folder', () => {
    const read = readSettingsFile({ appearance: { zoom: 90 } })
    expect(read).toMatchObject({ appVersion: null, exportedAt: null, platform: null, themes: [] })
    expect(read.settings).toEqual({ appearance: { zoom: 90 } })
  })

  it('refuses what is no settings file, and files of a newer Nexa', () => {
    expect(() => readSettingsFile(null)).toThrow('keine Einstellungen von Nexa')
    expect(() => readSettingsFile([1, 2])).toThrow('keine Einstellungen von Nexa')
    expect(() => readSettingsFile({ name: 'Ein Theme', mode: 'dark' })).toThrow('keine Einstellungen von Nexa')
    expect(() => readSettingsFile({ format: 'claude-manager-settings', version: 1, settings: {} })).toThrow('keine Einstellungen von Nexa')
    expect(() => readSettingsFile({ format: SETTINGS_FILE_FORMAT, version: SETTINGS_FILE_VERSION + 1, settings: {} })).toThrow('neueren Version')
    expect(() => readSettingsFile({ format: SETTINGS_FILE_FORMAT, version: '1', settings: {} })).toThrow('keine gültige Version')
    expect(() => readSettingsFile({ format: SETTINGS_FILE_FORMAT, version: 1, settings: [] })).toThrow('enthält keine Einstellungen')
  })

  it('ignores what the file says about itself when it is no proper value', () => {
    const read = readSettingsFile({ format: SETTINGS_FILE_FORMAT, version: 1, settings: {}, appVersion: 3, exportedAt: 'gestern', platform: '../x' })
    expect(read).toMatchObject({ appVersion: null, exportedAt: null, platform: null })
  })
})

describe('validSettings', () => {
  it('takes known settings with a fitting value', () => {
    const { settings: valid, invalid } = validSettings({
      appearance: { zoom: 125, material: 'acrylic', chatWidth: 'wide', theme: 'nord', uiFont: 'Inter' },
      defaults: { provider: 'codex', permissionMode: 'edits', accounts: { claude: 'abc' } },
      chat: { shell: 'gitbash', voiceLanguage: 'en', continuePrompt: 'Weiter so' },
      claude: { model: 'opus', effort: 'high', extraArgs: ['--verbose'] },
      notifications: { minBusySeconds: 60, nearLimitPercent: 90 },
      api: { port: 50000 },
    })
    expect(invalid).toEqual([])
    expect(valid).toEqual({
      appearance: { zoom: 125, material: 'acrylic', chatWidth: 'wide', theme: 'nord', uiFont: 'Inter' },
      defaults: { provider: 'codex', permissionMode: 'edits', accounts: { claude: 'abc' } },
      chat: { shell: 'gitbash', voiceLanguage: 'en', continuePrompt: 'Weiter so' },
      claude: { model: 'opus', effort: 'high', extraArgs: ['--verbose'] },
      notifications: { minBusySeconds: 60, nearLimitPercent: 90 },
      api: { port: 50000 },
    })
  })

  it('names values of the wrong type or outside what the setting offers', () => {
    const { settings: valid, invalid } = validSettings({
      appearance: { zoom: 123, material: 'glass', surfaceOpacity: 5, radius: '1', theme: 'custom:../../x', ligatures: 'ja' },
      defaults: { provider: 'gpt', permissionMode: 'god' },
      chat: { shell: 'zsh', voiceLanguage: 'xx', enterSends: null },
      codex: { extraArgs: ['--ok', 3] },
      notifications: { nearLimitPercent: 99.5, minBusySeconds: Number.NaN },
      api: { port: 80 },
      tools: 'alle',
    })
    expect(valid).toEqual({ appearance: {}, defaults: {}, chat: {}, codex: {}, notifications: {}, api: {} })
    expect(invalid.map((s) => s.path).sort()).toEqual(
      [
        'appearance.zoom',
        'appearance.material',
        'appearance.surfaceOpacity',
        'appearance.radius',
        'appearance.theme',
        'appearance.ligatures',
        'defaults.provider',
        'defaults.permissionMode',
        'chat.shell',
        'chat.voiceLanguage',
        'chat.enterSends',
        'codex.extraArgs',
        'notifications.nearLimitPercent',
        'notifications.minBusySeconds',
        'api.port',
        'tools',
      ].sort(),
    )
    expect(invalid.every((s) => s.reason === 'invalid')).toBe(true)
  })

  it('leaves out unknown settings and those of this installation quietly', () => {
    const { settings: valid, invalid } = validSettings({
      setup: { done: true },
      defaults: { projectsFolder: 'D:\\Projekte' },
      appearance: { zoom: 90, sparkle: true },
      future: { thing: 1 },
    })
    expect(valid).toEqual({ setup: {}, defaults: {}, appearance: { zoom: 90 } })
    expect(invalid).toEqual([])
  })

  it('takes text of any length a setting holds, but not endless text', () => {
    expect(validSettings({ chat: { continuePrompt: 'x'.repeat(2000) } }).invalid).toEqual([])
    expect(validSettings({ chat: { continuePrompt: 'x'.repeat(2001) } }).invalid).toHaveLength(1)
    expect(validSettings({ claude: { model: 'x'.repeat(5000) } }).invalid).toHaveLength(1)
  })

  it('takes switched off tools by their names, also of a newer Nexa', () => {
    expect(validSettings({ tools: { disabled: ['browser_evaluate', 'some_new_tool'] } }).settings).toEqual({ tools: { disabled: ['browser_evaluate', 'some_new_tool'] } })
    expect(validSettings({ tools: { disabled: ['Browser Evaluate'] } }).invalid).toHaveLength(1)
  })
})

describe('settingChanges', () => {
  it('lists each setting that differs, in the order of the settings', () => {
    const current = settings()
    const next = settings({ notifications: { sound: false }, appearance: { zoom: 125 }, defaults: { accounts: { codex: 'work' } } })
    expect(settingChanges(current, next)).toEqual([
      { path: 'appearance.zoom', from: 100, to: 125, sensitive: false },
      { path: 'defaults.accounts.codex', from: 'system-codex', to: 'work', sensitive: false },
      { path: 'notifications.sound', from: true, to: false, sensitive: false },
    ])
  })

  it('marks what decides what runs or lets the agents do more', () => {
    const current = settings({ defaults: { permissionMode: 'edits' } })
    const next = settings({
      claude: { path: 'C:\\claude.exe', extraArgs: ['--x'] },
      codex: { model: 'gpt-5' },
      chat: { continuePrompt: 'Lösch alles' },
      defaults: { permissionMode: 'full' },
      tools: { chatTools: true },
      api: { enabled: true },
    })
    const sensitive = Object.fromEntries(settingChanges(current, next).map((c) => [c.path, c.sensitive]))
    expect(sensitive).toEqual({
      'defaults.permissionMode': true,
      'claude.path': true,
      'claude.extraArgs': true,
      'codex.model': false,
      'chat.continuePrompt': true,
      'tools.chatTools': true,
      'api.enabled': true,
    })
    // Back to less is no risk.
    const back = settingChanges(next, current)
    expect(back.find((c) => c.path === 'defaults.permissionMode')?.sensitive).toBe(false)
    expect(back.find((c) => c.path === 'api.enabled')?.sensitive).toBe(false)
  })

  it('marks switching a chat tool back on, not other tools', () => {
    const sensitive = (from: string[], to: string[]) =>
      settingChanges(settings({ tools: { disabled: from } }), settings({ tools: { disabled: to } }))[0]?.sensitive
    expect(sensitive(['chat_send', 'browser_click'], ['browser_click'])).toBe(true)
    expect(sensitive(['browser_click'], [])).toBe(false)
    expect(sensitive([], ['chat_send'])).toBe(false)
  })

  it('never lists the settings of this installation', () => {
    expect(settingChanges(settings(), settings({ setup: { done: true }, defaults: { projectsFolder: 'D:\\x' } }))).toEqual([])
  })
})

describe('settingsPatch', () => {
  it('builds the update of the changes, or of their old values to undo them', () => {
    const changes = [
      { path: 'appearance.zoom', from: 100, to: 125, sensitive: false },
      { path: 'defaults.accounts.codex', from: 'system-codex', to: 'work', sensitive: false },
      { path: 'claude.extraArgs', from: [], to: ['--x'], sensitive: true },
    ]
    expect(settingsPatch(changes)).toEqual({ appearance: { zoom: 125 }, defaults: { accounts: { codex: 'work' } }, claude: { extraArgs: ['--x'] } })
    expect(settingsPatch(changes, 'from')).toEqual({ appearance: { zoom: 100 }, defaults: { accounts: { codex: 'system-codex' } }, claude: { extraArgs: [] } })
  })
})

describe('consistentChanges', () => {
  const change = (path: string, from: unknown, to: unknown) => ({ path, from, to, sensitive: false })

  it('keeps changes that fit together', () => {
    const picked = [change('codex.enabled', true, false)]
    expect(consistentChanges(settings(), picked)).toEqual(picked)
  })

  it('moves the default to a CLI that is on', () => {
    const current = settings({ defaults: { provider: 'codex' } })
    expect(consistentChanges(current, [change('codex.enabled', true, false)])).toEqual([
      change('codex.enabled', true, false),
      change('defaults.provider', 'codex', 'claude'),
    ])
    // The file's default for the CLI switched off is dropped for one that is on.
    expect(consistentChanges(settings(), [change('claude.enabled', true, false), change('defaults.provider', 'claude', 'claude')])).toEqual([
      change('claude.enabled', true, false),
      change('defaults.provider', 'claude', 'codex'),
    ])
  })

  it('refuses to switch every CLI off', () => {
    const allOff = PROVIDER_IDS.map((id) => change(`${id}.enabled`, true, false))
    expect(consistentChanges(settings(), allOff)).toBeNull()
    // One left on is enough.
    expect(consistentChanges(settings(), allOff.slice(1))).not.toBeNull()
  })
})
