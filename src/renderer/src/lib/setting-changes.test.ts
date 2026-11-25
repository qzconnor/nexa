import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/defaults'
import { LOCAL_SETTINGS, type SettingChange, type SettingsImportPreview } from '@shared/settings-transfer'
import { findTheme } from '@shared/themes/builtin'
import { isPlainObject } from '@shared/utils'
import {
  groupChanges,
  importSelection,
  isCommandSetting,
  settingLabel,
  settingPlace,
  settingValueText,
  skippedNames,
  themeKey,
  withAddedThemes,
  withoutMissingMicrophone,
} from './setting-changes'
import { settingsIndex } from './settings-index'

/** Every setting a file can change: the leaves of the settings. */
function leaves(value: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return isPlainObject(child) ? leaves(child, path) : [path]
  })
}

const change = (path: string, from: unknown, to: unknown, sensitive = false): SettingChange => ({ path, from, to, sensitive })
const names = { theme: (id: string) => (id === 'nord' ? 'Nord' : null), account: (id: string) => (id === 'work' ? 'Arbeit' : null) }

describe('settingPlace', () => {
  it('knows the place of every setting, at a row or card the settings have', () => {
    const anchors = new Set(settingsIndex('win32').map((entry) => entry.id))
    const paths = leaves(defaultSettings() as unknown as Record<string, unknown>).filter((path) => !LOCAL_SETTINGS.includes(path))
    for (const path of paths) {
      const place = settingPlace(path)
      expect(place, path).toBeDefined()
      expect(anchors.has(place!.anchor), `${path} → ${place!.anchor}`).toBe(true)
    }
  })

  it('names the settings of a CLI with the CLI', () => {
    expect(settingLabel('codex.model', 'win32')).toBe('Modell (Codex)')
    expect(settingLabel('claude.effort', 'win32')).toBe('Denkaufwand (Claude Code)')
    expect(settingLabel('defaults.accounts.claude', 'win32')).toBe('Vorgabe-Account für Claude Code')
    expect(settingLabel('chat.voiceLanguage', 'win32')).toBe('Sprache der Spracheingabe')
    expect(settingLabel('appearance.zoom', 'win32')).toBe('Skalierung')
  })

  it('keeps the name of a row only Windows shows', () => {
    expect(settingLabel('general.nxReuseChat', 'linux')).toBe('„nx“ nutzt einen offenen Chat')
    expect(settingLabel('appearance.material', 'linux')).toBe('Fenster-Material')
  })
})

describe('groupChanges', () => {
  it('groups the changes by section of the settings, in their order', () => {
    const groups = groupChanges(
      [change('notifications.sound', true, false), change('appearance.zoom', 100, 125), change('general.runInTray', false, true), change('codex.model', '', 'gpt-5')],
      'win32',
    )
    expect(groups.map((g) => [g.label, g.changes.map((c) => c.label)])).toEqual([
      ['Allgemein', ['Im Infobereich weiterlaufen']],
      ['Darstellung', ['Skalierung']],
      ['CLIs', ['Modell (Codex)']],
      ['Benachrichtigungen', ['Ton der Benachrichtigung']],
    ])
  })

  it('puts settings it doesn’t know last, by their path', () => {
    expect(groupChanges([change('neu.etwas', 1, 2), change('appearance.zoom', 100, 125)], 'win32').map((g) => g.label)).toEqual([
      'Darstellung',
      'Weitere',
    ])
  })
})

describe('settingValueText', () => {
  it('names values as the settings do', () => {
    expect(settingValueText('appearance.theme', 'nord', names)).toBe('Nord')
    expect(settingValueText('appearance.theme', 'custom:x', names)).toBe('„custom:x“ (fehlt hier)')
    expect(settingValueText('appearance.material', 'tabbed', names)).toBe('Mica Alt')
    expect(settingValueText('appearance.zoom', 125, names)).toBe('125 %')
    expect(settingValueText('appearance.radius', 0.625, names)).toBe('0,63 rem')
    expect(settingValueText('defaults.permissionMode', 'full', names)).toBe('Volle Rechte')
    expect(settingValueText('defaults.provider', 'codex', names)).toBe('Codex')
    expect(settingValueText('defaults.accounts.codex', 'work', names)).toBe('Arbeit')
    expect(settingValueText('chat.voiceAccount', '', names)).toBe('Automatisch')
    expect(settingValueText('chat.voiceLanguage', 'fr', names)).toBe('Französisch')
    expect(settingValueText('claude.model', '', names)).toBe('Standard der CLI')
    expect(settingValueText('codex.effort', 'xhigh', names)).toBe('Sehr hoch')
    expect(settingValueText('claude.extraArgs', ['--a', 'b c'], names)).toBe('--a "b c"')
    expect(settingValueText('claude.extraArgs', [], names)).toBe('keine')
    expect(settingValueText('notifications.minBusySeconds', 0, names)).toBe('immer')
    expect(settingValueText('notifications.minBusySeconds', 30, names)).toBe('ab 30 s')
    expect(settingValueText('chat.continuePrompt', 'Weiter', names)).toBe('„Weiter“')
    expect(settingValueText('api.port', 47615, names)).toBe('47615')
    expect(settingValueText('tools.chatTools', true, names)).toBe('An')
  })
})

const theme = (name: string) => {
  const { id: _id, ...content } = findTheme('nord')
  return { ...content, name }
}
const preview = (patch: Partial<SettingsImportPreview> = {}): SettingsImportPreview => ({
  fileName: 'a.json',
  appVersion: null,
  exportedAt: null,
  platform: null,
  changes: [],
  themes: [],
  skipped: [],
  ...patch,
})

describe('import selection', () => {
  it('adds the theme the theme setting picks, also when the theme itself isn’t picked', () => {
    const p = preview({
      changes: [change('appearance.theme', 'ember', 'custom:a'), change('appearance.zoom', 100, 90)],
      themes: [
        { id: 'custom:a', theme: theme('A') },
        { id: 'custom:b', theme: theme('B') },
        { id: 'custom:c', theme: theme('C') },
      ],
    })
    const picked = importSelection(p, new Set(['appearance.theme', themeKey('custom:c')]))
    expect(picked.changes.map((c) => c.path)).toEqual(['appearance.theme'])
    expect(picked.themes.map((t) => t.id)).toEqual(['custom:a', 'custom:c'])
    expect(withAddedThemes(picked.changes, new Map([['custom:a', 'custom:a-2']]))).toEqual([change('appearance.theme', 'ember', 'custom:a-2')])
  })

  it('drops the microphone of the file when it isn’t connected here', () => {
    const p = preview({ changes: [change('chat.voiceMicrophone', '', 'Headset (USB)'), change('appearance.zoom', 100, 90)] })
    expect(withoutMissingMicrophone(p, ['Headset (USB)'])).toBe(p)
    expect(withoutMissingMicrophone(p, [])).toBe(p)
    const without = withoutMissingMicrophone(p, ['Laptop-Mikrofon'])
    expect(without.changes.map((c) => c.path)).toEqual(['appearance.zoom'])
    expect(without.skipped).toEqual([{ path: 'chat.voiceMicrophone', value: 'Headset (USB)', reason: 'missing' }])
  })

  it('names what was skipped by why, each once', () => {
    expect(
      skippedNames(
        [
          { path: 'claude.path', value: 'x', reason: 'missing' },
          { path: 'themes', value: 'Kaputt', reason: 'invalid' },
          { path: 'appearance.zoom', value: 3, reason: 'invalid' },
          { path: 'claude.path', value: 'y', reason: 'missing' },
        ],
        'win32',
      ),
    ).toEqual({ missing: ['Pfad zur CLI (Claude Code)'], invalid: ['Eigenes Theme „Kaputt“', 'Skalierung'] })
  })

  it('shows a CLI’s program and arguments as code', () => {
    expect(['claude.path', 'codex.extraArgs', 'claude.model', 'defaults.permissionMode', 'chat.continuePrompt'].map(isCommandSetting)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ])
  })
})
