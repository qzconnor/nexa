import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Account } from '@shared/accounts'
import { PROVIDER_IDS } from '@shared/chat'
import {
  MAX_SETTINGS_FILE_BYTES,
  readSettingsFile,
  settingChanges,
  settingsFile,
  validSettings,
  type ReadSettingsFile,
  type SettingsFileTheme,
  type SettingsImportPreview,
  type SkippedSetting,
} from '@shared/settings-transfer'
import { THEMES } from '@shared/themes/builtin'
import { customThemeStem, MAX_THEME_NAME_LENGTH, parseThemeFile } from '@shared/themes/file'
import type { CustomThemeEntry, ThemeContent } from '@shared/themes/types'
import type { AppSettings, DeepPartial, UserShell } from '@shared/types'
import { isPlainObject, mergeKnown } from '@shared/utils'
import { writeJsonAtomic } from '../lib/json-file'

/** What the settings of a file are checked against: this computer. */
export interface TransferHere {
  settings(): AppSettings
  accounts(): readonly Pick<Account, 'id' | 'provider'>[]
  /** The user's own themes here. */
  themes(): Promise<CustomThemeEntry[]>
  /** The font families installed here; none when they couldn't be read (then no font counts as missing). */
  fonts(): Promise<string[]>
  /** Whether something is at the path; a CLI's path may name its file or its folder. */
  exists(path: string): boolean
  /** Whether the shell for `!` can start here. */
  hasShell(shell: UserShell): boolean
}

/**
 * Settings to another computer (Einstellungen › Allgemein): `exportTo` writes them with the user's
 * own themes into a file, `preview` reads what such a file would change here. Nothing is taken over
 * before the user picked it; the window applies what they chose as an ordinary settings update.
 */
export class SettingsTransfer {
  constructor(
    private readonly here: TransferHere,
    private readonly app: { version: string; platform: string },
  ) {}

  async exportTo(file: string): Promise<void> {
    const themes: SettingsFileTheme[] = (await this.here.themes()).flatMap((entry) => (entry.theme ? [{ id: entry.id, theme: entry.theme }] : []))
    await writeJsonAtomic(file, settingsFile(this.here.settings(), themes, { appVersion: this.app.version, platform: this.app.platform }))
  }

  /**
   * What the file would change: each setting with its value now and the one from the file, the
   * file's themes this computer lacks, and what stays as it is because it doesn't fit here.
   */
  async preview(file: string): Promise<SettingsImportPreview> {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('Das ist keine Datei.')
    if (info.size > MAX_SETTINGS_FILE_BYTES) throw new Error('Die Datei ist zu groß für exportierte Einstellungen.')
    let data: unknown
    try {
      data = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''))
    } catch {
      throw new Error('Die Datei ist kein gültiges JSON.')
    }
    const read = readSettingsFile(data)
    const { settings: imported, invalid } = validSettings(read.settings)
    const current = this.here.settings()
    const skipped: SkippedSetting[] = [...invalid]

    const localThemes = (await this.here.themes()).flatMap((entry) => (entry.theme ? [{ id: entry.id, theme: entry.theme }] : []))
    const themes = fileThemes(read.themes, localThemes)
    skipped.push(...themes.invalid)
    const themeSkipped = placeTheme(imported, current, read, themes, new Set(localThemes.map((theme) => theme.id)))
    if (themeSkipped) skipped.push(themeSkipped)
    skipped.push(...(await this.missingHere(imported, current)))

    return {
      fileName: basename(file),
      appVersion: read.appVersion,
      exportedAt: read.exportedAt,
      platform: read.platform,
      changes: settingChanges(current, mergeKnown(current, imported)),
      themes: themes.offered,
      skipped,
    }
  }

  /**
   * Leaves out what names something this computer lacks: the CLI's program, accounts (their ids are
   * made on each computer), fonts and Git Bash. Only settings that would change count; the rest isn't
   * named. The microphone only the window can look for (renderer lib/setting-changes.ts).
   */
  private async missingHere(imported: DeepPartial<AppSettings>, current: AppSettings): Promise<SkippedSetting[]> {
    const skipped: SkippedSetting[] = []
    const drop = (section: unknown, key: string, path: string, missing: (value: unknown) => boolean) => {
      if (!isPlainObject(section) || !Object.hasOwn(section, key)) return
      const value = section[key]
      if (value === pathValue(current, path) || !missing(value)) return
      delete section[key]
      skipped.push({ path, value, reason: 'missing' })
    }
    /** A text that names something (`check`); empty means the default and is always there. */
    const named = (check: (value: string) => boolean) => (value: unknown) => typeof value === 'string' && value.trim() !== '' && !check(value.trim())

    for (const id of PROVIDER_IDS) {
      drop(imported[id], 'path', `${id}.path`, named((path) => this.here.exists(path)))
    }
    const accounts = this.here.accounts()
    const hasAccount = (provider: string, id: unknown) => accounts.some((account) => account.id === id && account.provider === provider)
    for (const provider of PROVIDER_IDS) {
      drop(imported.defaults?.accounts, provider, `defaults.accounts.${provider}`, (id) => !hasAccount(provider, id))
    }
    drop(imported.chat, 'voiceAccount', 'chat.voiceAccount', named((id) => hasAccount('claude', id)))
    drop(imported.chat, 'shell', 'chat.shell', (shell) => !this.here.hasShell(shell as UserShell))

    const appearance = imported.appearance
    // Listing the fonts takes Windows a few seconds the first time: only when a font would change.
    const fontChanges = (['uiFont', 'codeFont'] as const).some((key) => appearance?.[key] && appearance[key] !== current.appearance[key])
    if (appearance && fontChanges) {
      const installed = new Set((await this.here.fonts()).map(nameKey))
      if (installed.size > 0) {
        // A list is fine while one of its fonts is there: the browser takes the first it has.
        const available = (font: string) => fontFamilies(font).some((family) => GENERIC_FONTS.has(nameKey(family)) || installed.has(nameKey(family)))
        drop(appearance, 'uiFont', 'appearance.uiFont', named(available))
        drop(appearance, 'codeFont', 'appearance.codeFont', named(available))
      }
    }
    return skipped
  }
}

interface FileThemes {
  /** The file's themes this computer lacks, with the id they had there. */
  offered: SettingsFileTheme[]
  /** The id here of a theme of the file this computer has, by the file's id. */
  localIdOf: Map<string, string>
  invalid: SkippedSetting[]
}

/**
 * The file's themes: those this computer has (by name, as the theme import counts them), and those
 * it lacks, to offer. A theme that doesn't read as one is named.
 */
function fileThemes(entries: ReadSettingsFile['themes'], local: readonly { id: string; theme: ThemeContent }[]): FileThemes {
  const known = new Map<string, string>()
  // The user's own after the built-in ones: a theme of theirs named like a built-in one is theirs.
  for (const theme of [...THEMES.map((t) => ({ id: t.id, name: t.name })), ...local.map((t) => ({ id: t.id, name: t.theme.name }))]) {
    known.set(nameKey(theme.name), theme.id)
  }
  const result: FileThemes = { offered: [], localIdOf: new Map(), invalid: [] }
  const offeredNames = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    const fileName = isPlainObject(entry.theme) && typeof entry.theme.name === 'string' ? entry.theme.name.slice(0, MAX_THEME_NAME_LENGTH) : ''
    let theme: ThemeContent
    try {
      theme = parseThemeFile(entry.theme, fileName || `Theme ${index + 1}`)
    } catch {
      result.invalid.push({ path: 'themes', value: fileName || `Theme ${index + 1}`, reason: 'invalid' })
      continue
    }
    const id = typeof entry.id === 'string' && customThemeStem(entry.id) ? entry.id : null
    const here = known.get(nameKey(theme.name))
    if (here) {
      if (id) result.localIdOf.set(id, here)
    } else if (!offeredNames.has(nameKey(theme.name))) {
      offeredNames.add(nameKey(theme.name))
      // Without an id of its own (edited by hand) the theme can still be added, the setting just can't name it.
      result.offered.push({ id: id ?? `custom:nexa-import-${index}`, theme })
    }
  }
  return result
}

/**
 * Points the theme setting to the theme as it is called here: one of the file that this computer
 * has under another file name takes that one's id; one of the file that it lacks keeps the file's id,
 * which the window replaces once it added the theme. A theme that is nowhere stays as it is here.
 */
function placeTheme(
  imported: DeepPartial<AppSettings>,
  current: AppSettings,
  read: ReadSettingsFile,
  themes: FileThemes,
  localIds: ReadonlySet<string>,
): SkippedSetting | null {
  const appearance = imported.appearance
  const id = appearance?.theme
  if (!appearance || !id || !customThemeStem(id) || id === current.appearance.theme) return null
  const local = themes.localIdOf.get(id)
  if (local) appearance.theme = local
  else if (themes.offered.some((theme) => theme.id === id)) return null
  // A plain settings.json has no themes: a theme file of the same name here is taken as the one meant.
  else if (read.themes.length > 0 || !localIds.has(id)) {
    delete appearance.theme
    return { path: 'appearance.theme', value: id, reason: 'missing' }
  }
  return null
}

/** CSS's own families: always there. */
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded'])

/** The families of a font setting (`"JetBrains Mono", Consolas`), without quotes. */
export function fontFamilies(font: string): string[] {
  return font
    .split(',')
    .map((family) => family.trim().replace(/^(["'])(.*)\1$/, '$2').trim())
    .filter(Boolean)
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase('de-DE')

function pathValue(settings: AppSettings, path: string): unknown {
  let node: unknown = settings
  for (const key of path.split('.')) node = isPlainObject(node) ? node[key] : undefined
  return node
}
