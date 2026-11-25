import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/defaults'
import { SETTINGS_FILE_FORMAT } from '@shared/settings-transfer'
import { findTheme } from '@shared/themes/builtin'
import { themeToFile } from '@shared/themes/file'
import type { CustomThemeEntry, ThemeContent } from '@shared/themes/types'
import type { AppSettings } from '@shared/types'
import { mergeKnown } from '@shared/utils'
import { fontFamilies, SettingsTransfer, type TransferHere } from './settings-transfer'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nexa-transfer-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const theme = (name: string): ThemeContent => {
  const { id: _id, ...content } = findTheme('nord')
  return { ...content, name }
}
const entry = (stem: string, name: string): CustomThemeEntry => ({
  id: `custom:${stem}`,
  file: `themes/${stem}.json`,
  theme: { ...theme(name), id: `custom:${stem}` },
  error: null,
})

function here(settings: AppSettings, patch: Partial<TransferHere> = {}): TransferHere {
  return {
    settings: () => settings,
    accounts: () => [
      { id: 'system', provider: 'claude' },
      { id: 'system-codex', provider: 'codex' },
    ],
    themes: async () => [],
    fonts: async () => ['Consolas', 'Segoe UI'],
    exists: () => false,
    hasShell: () => true,
    ...patch,
  }
}

const APP = { version: '1.4.0', platform: 'win32' }
const settings = (patch: Record<string, unknown> = {}): AppSettings => mergeKnown(defaultSettings(), patch)

function write(name: string, data: unknown): string {
  const file = join(dir, name)
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data))
  return file
}

describe('SettingsTransfer', () => {
  it('exports the settings and the own themes, and a computer with the same reads no change', async () => {
    const mine = settings({ appearance: { zoom: 125, theme: 'custom:mein' } })
    const transfer = new SettingsTransfer(here(mine, { themes: async () => [entry('mein', 'Mein Theme')] }), APP)
    const file = join(dir, 'export.json')
    await transfer.exportTo(file)
    const data = JSON.parse(readFileSync(file, 'utf8'))
    expect(data).toMatchObject({ format: SETTINGS_FILE_FORMAT, version: 1, appVersion: '1.4.0', platform: 'win32' })
    expect(data.settings.setup).toEqual({})
    expect(data.themes).toEqual([{ id: 'custom:mein', theme: expect.objectContaining({ name: 'Mein Theme', mode: 'dark' }) }])

    const preview = await transfer.preview(file)
    expect(preview).toMatchObject({ fileName: 'export.json', appVersion: '1.4.0', platform: 'win32', changes: [], themes: [], skipped: [] })
  })

  it('shows each change of another computer, and offers the themes this one lacks', async () => {
    const other = settings({ appearance: { zoom: 90, theme: 'custom:dunkel' }, notifications: { sound: false } })
    const file = join(dir, 'other.json')
    await new SettingsTransfer(here(other, { themes: async () => [entry('dunkel', 'Dunkel'), entry('nord-kopie', 'Nord Kopie')] }), APP).exportTo(file)

    // This computer has „Nord Kopie“ under another file name, „Dunkel“ not.
    const transfer = new SettingsTransfer(here(settings(), { themes: async () => [entry('nord-copy', 'nord kopie')] }), APP)
    const preview = await transfer.preview(file)
    expect(preview.changes).toEqual([
      { path: 'appearance.theme', from: 'ember', to: 'custom:dunkel', sensitive: false },
      { path: 'appearance.zoom', from: 100, to: 90, sensitive: false },
      { path: 'notifications.sound', from: true, to: false, sensitive: false },
    ])
    expect(preview.themes.map((t) => [t.id, t.theme.name])).toEqual([['custom:dunkel', 'Dunkel']])
  })

  it('points the theme setting to the theme of the same name here', async () => {
    const file = write('s.json', {
      format: SETTINGS_FILE_FORMAT,
      version: 1,
      settings: { appearance: { theme: 'custom:a' } },
      themes: [{ id: 'custom:a', theme: themeToFile(theme('Abend')) }],
    })
    const transfer = new SettingsTransfer(here(settings(), { themes: async () => [entry('abend-2', 'Abend')] }), APP)
    const preview = await transfer.preview(file)
    expect(preview.changes).toEqual([{ path: 'appearance.theme', from: 'ember', to: 'custom:abend-2', sensitive: false }])
    expect(preview.themes).toEqual([])
  })

  it('leaves the theme as it is when the file chose one it lacks', async () => {
    const file = write('s.json', {
      format: SETTINGS_FILE_FORMAT,
      version: 1,
      settings: { appearance: { theme: 'custom:weg' } },
      themes: [{ id: 'custom:x', theme: { name: 'kaputt', mode: 'grün' } }],
    })
    const preview = await new SettingsTransfer(here(settings()), APP).preview(file)
    expect(preview.changes).toEqual([])
    expect(preview.skipped).toEqual([
      { path: 'themes', value: 'kaputt', reason: 'invalid' },
      { path: 'appearance.theme', value: 'custom:weg', reason: 'missing' },
    ])
  })

  it('skips what this computer lacks: the CLI, accounts, fonts and Git Bash', async () => {
    const file = write('s.json', {
      format: SETTINGS_FILE_FORMAT,
      version: 1,
      settings: {
        claude: { path: 'D:\\Tools\\claude.exe' },
        codex: { path: 'C:\\da\\codex.exe' },
        defaults: { accounts: { claude: 'acc-other', codex: 'system-codex' } },
        chat: { voiceAccount: 'acc-other', shell: 'gitbash' },
        appearance: { uiFont: '"Fehlt Sans", Fehlt Zwei', codeFont: '"JetBrains Mono", consolas' },
      },
    })
    const transfer = new SettingsTransfer(
      here(settings(), { exists: (path) => path === 'C:\\da\\codex.exe', hasShell: (shell) => shell !== 'gitbash' }),
      APP,
    )
    const preview = await transfer.preview(file)
    expect(preview.changes.map((c) => [c.path, c.to])).toEqual([
      ['appearance.codeFont', '"JetBrains Mono", consolas'],
      ['codex.path', 'C:\\da\\codex.exe'],
    ])
    expect(preview.skipped.map((s) => s.path)).toEqual([
      'claude.path',
      'defaults.accounts.claude',
      'chat.voiceAccount',
      'chat.shell',
      'appearance.uiFont',
    ])
  })

  it('only lists the fonts when a font would change', async () => {
    let listed = 0
    const fonts = async () => {
      listed++
      return ['Consolas']
    }
    const transfer = new SettingsTransfer(here(settings({ appearance: { codeFont: 'Consolas' } }), { fonts }), APP)
    await transfer.preview(write('a.json', { appearance: { uiFont: '', codeFont: 'Consolas', zoom: 110 } }))
    expect(listed).toBe(0)
    await transfer.preview(write('b.json', { appearance: { uiFont: 'Consolas' } }))
    expect(listed).toBe(1)
  })

  it('takes every font when the installed ones could not be read', async () => {
    const file = write('s.json', { appearance: { uiFont: 'Fehlt Sans' } })
    const preview = await new SettingsTransfer(here(settings(), { fonts: async () => [] }), APP).preview(file)
    expect(preview.changes.map((c) => c.path)).toEqual(['appearance.uiFont'])
  })

  it('names nothing for a setting that names something missing but would not change', async () => {
    const current = settings({ claude: { path: 'D:\\alt\\claude.exe' } })
    const file = write('s.json', { claude: { path: 'D:\\alt\\claude.exe' } })
    const preview = await new SettingsTransfer(here(current), APP).preview(file)
    expect(preview).toMatchObject({ changes: [], skipped: [] })
  })

  it('keeps a theme of this computer that a plain settings.json chose', async () => {
    const file = write('settings.json', { appearance: { theme: 'custom:mein' } })
    const transfer = new SettingsTransfer(here(settings(), { themes: async () => [entry('mein', 'Mein')] }), APP)
    const preview = await transfer.preview(file)
    expect(preview.changes).toEqual([{ path: 'appearance.theme', from: 'ember', to: 'custom:mein', sensitive: false }])
  })

  it('refuses files that are no settings, too big or broken', async () => {
    const transfer = new SettingsTransfer(here(settings()), APP)
    await expect(transfer.preview(write('a.json', '{ kaputt'))).rejects.toThrow('kein gültiges JSON')
    await expect(transfer.preview(write('b.json', { name: 'Theme' }))).rejects.toThrow('keine Einstellungen von Nexa')
    await expect(transfer.preview(write('c.json', 'x'.repeat(3 * 1024 * 1024)))).rejects.toThrow('zu groß')
    await expect(transfer.preview(dir)).rejects.toThrow('keine Datei')
  })

  it('reads a file with a byte order mark', async () => {
    const file = write('bom.json', `\uFEFF${JSON.stringify({ appearance: { zoom: 110 } })}`)
    const preview = await new SettingsTransfer(here(settings()), APP).preview(file)
    expect(preview.changes).toEqual([{ path: 'appearance.zoom', from: 100, to: 110, sensitive: false }])
  })
})

describe('fontFamilies', () => {
  it('splits a font list and takes off the quotes', () => {
    expect(fontFamilies(`"JetBrains Mono", 'Fira Code',Consolas , monospace`)).toEqual(['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'])
    expect(fontFamilies(' , ')).toEqual([])
  })
})
