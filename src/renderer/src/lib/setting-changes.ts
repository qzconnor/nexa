import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
import { SYNC_GROUPS } from '@shared/remote-sync'
import type { SettingChange, SettingsFileTheme, SettingsImportPreview, SkippedSetting } from '@shared/settings-transfer'
import { VOICE_LANGUAGES } from '@shared/voice'
import { formatArgs } from './args'
import { effortLabel } from './effort'
import { settingsIndex, type SettingsAnchor, type SettingsEntry } from './settings-index'

/**
 * Names and values of the settings as the settings dialog shows them, for the import's list of
 * changes (SettingsImportDialog).
 */

/**
 * Where each setting is in the settings dialog: its row, or the card when it has none of its own.
 * `label` where the row's name alone would be unclear in a list of changes („Sprache“).
 * The settings every CLI has are in `providerPlace`.
 */
const PLACES: Record<string, { anchor: SettingsAnchor; label?: string }> = {
  'general.runInTray': { anchor: 'general.runInTray' },
  'general.launchAtLogin': { anchor: 'general.launchAtLogin' },
  'general.confirmQuitRunning': { anchor: 'general.confirmQuitRunning', label: 'Vor dem Beenden fragen' },
  'general.nxReuseChat': { anchor: 'general.nxReuseChat', label: '„nx“ nutzt einen offenen Chat' },
  'appearance.theme': { anchor: 'appearance.theme' },
  'appearance.material': { anchor: 'appearance.material', label: 'Fenster-Material' },
  'appearance.keepMaterialActive': { anchor: 'appearance.keepMaterial', label: 'Material auch im Hintergrund' },
  'appearance.surfaceOpacity': { anchor: 'appearance.surfaceOpacity' },
  'appearance.zoom': { anchor: 'appearance.zoom' },
  'appearance.radius': { anchor: 'appearance.radius' },
  'appearance.uiFont': { anchor: 'appearance.uiFont', label: 'Schriftart der Oberfläche' },
  'appearance.uiFontSize': { anchor: 'appearance.uiFontSize' },
  'appearance.codeFont': { anchor: 'appearance.codeFont' },
  'appearance.ligatures': { anchor: 'appearance.ligatures' },
  'appearance.chatWidth': { anchor: 'appearance.chatWidth', label: 'Breite des Chats' },
  'chat.keepLoginsFresh': { anchor: 'accounts.keepLoginsFresh' },
  'chat.autoSwitch': { anchor: 'accounts.autoSwitch' },
  'chat.continuePrompt': { anchor: 'accounts.continuePrompt' },
  'defaults.provider': { anchor: 'providers.provider', label: 'CLI für neue Chats' },
  'defaults.permissionMode': { anchor: 'providers.permissionMode', label: 'Freigaben für neue Chats' },
  'chat.showThinking': { anchor: 'chat.showThinking' },
  'chat.collapseDiffs': { anchor: 'chat.collapseDiffs' },
  'chat.autoTitles': { anchor: 'chat.autoTitles' },
  'chat.enterSends': { anchor: 'chat.enterSends' },
  'chat.promptSuggestions': { anchor: 'chat.promptSuggestions' },
  'chat.releaseIdleMinutes': { anchor: 'chat.releaseIdleMinutes', label: 'CLI nach Ruhe beenden' },
  'chat.shell': { anchor: 'chat.shell' },
  'chat.voiceMicrophone': { anchor: 'chat.voiceMicrophone', label: 'Mikrofon der Spracheingabe' },
  'chat.voiceLanguage': { anchor: 'chat.voiceLanguage', label: 'Sprache der Spracheingabe' },
  'chat.voiceAutoStop': { anchor: 'chat.voiceAutoStop', label: 'Spracheingabe automatisch beenden' },
  'chat.voiceAutoSend': { anchor: 'chat.voiceAutoSend', label: 'Diktat automatisch abschicken' },
  'chat.voiceAccount': { anchor: 'chat.voiceAccount', label: 'Account der Spracheingabe' },
  'chat.deleteCliConversations': { anchor: 'chat.deleteCliConversations' },
  'tools.renderTools': { anchor: 'chat.renderTools' },
  'tools.browserTools': { anchor: 'chat.browserTools' },
  'tools.noClaudeInChrome': { anchor: 'chat.noClaudeInChrome' },
  'tools.chatTools': { anchor: 'chat.chatTools' },
  'notifications.enabled': { anchor: 'notifications.enabled' },
  'notifications.onDone': { anchor: 'notifications.onDone' },
  'notifications.minBusySeconds': { anchor: 'notifications.minBusy' },
  'notifications.onInput': { anchor: 'notifications.onInput' },
  'notifications.onLimit': { anchor: 'notifications.onLimit' },
  'notifications.onNearLimit': { anchor: 'notifications.onNearLimit' },
  'notifications.nearLimitPercent': { anchor: 'notifications.nearLimitPercent', label: 'Schwelle für „Limit fast verbraucht“' },
  'notifications.onLoginLost': { anchor: 'notifications.onLoginLost' },
  'notifications.fromAgents': { anchor: 'notifications.fromAgents', label: 'Benachrichtigungen von den Agents' },
  'notifications.when': { anchor: 'notifications.when' },
  'notifications.preview': { anchor: 'notifications.preview', label: 'Vorschau in der Benachrichtigung' },
  'notifications.sound': { anchor: 'notifications.sound', label: 'Ton der Benachrichtigung' },
  'notifications.flashTaskbar': { anchor: 'notifications.flash' },
  'api.enabled': { anchor: 'api.enabled', label: 'Lokale API' },
  'api.port': { anchor: 'api.port', label: 'Port der API' },
  // What this device shares with another it controls: named with the card, „Projekte auf- und zuklappen“ alone says too little.
  ...Object.fromEntries(
    SYNC_GROUPS.flatMap((group) =>
      group.items.map((item) => [`remote.sync.${item.key}`, { anchor: `devices.sync.${item.key}` as const, label: `Abgleich: ${item.label}` }]),
    ),
  ),
}

/** The rows every CLI has, by the key of its settings; the effort has no row and goes with the model. */
const PROVIDER_ROWS: Record<string, { row: string; label: string }> = {
  enabled: { row: 'enabled', label: 'In Nexa nutzen' },
  model: { row: 'model', label: 'Modell' },
  effort: { row: 'model', label: 'Denkaufwand' },
  path: { row: 'path', label: 'Pfad zur CLI' },
  extraArgs: { row: 'extraArgs', label: 'Zusätzliche Argumente' },
}

const isProvider = (id: string): id is ProviderId => (PROVIDER_IDS as readonly string[]).includes(id)
const providerName = (id: ProviderId) => PROVIDERS[id]?.name ?? id

/** The place of a setting of a CLI (`codex.model`, `defaults.accounts.claude`), named with the CLI. */
function providerPlace(path: string): { anchor: SettingsAnchor; label: string } | undefined {
  const [section, key, more] = path.split('.')
  if (isProvider(section) && more === undefined && PROVIDER_ROWS[key]) {
    const { row, label } = PROVIDER_ROWS[key]
    return { anchor: `${section}.${row}` as SettingsAnchor, label: `${label} (${providerName(section)})` }
  }
  if (section === 'defaults' && key === 'accounts' && more && isProvider(more)) {
    return { anchor: `accounts.${more}` as SettingsAnchor, label: `Vorgabe-Account für ${providerName(more)}` }
  }
  return undefined
}

/** A CLI's program or its arguments: shown as code, whole. */
export function isCommandSetting(path: string): boolean {
  const [section, key, more] = path.split('.')
  return isProvider(section) && more === undefined && (key === 'path' || key === 'extraArgs')
}

/** Where a setting is in the settings dialog; undefined for one Nexa doesn't name (then its path stands). */
export function settingPlace(path: string): { anchor: SettingsAnchor; label?: string } | undefined {
  return PLACES[path] ?? providerPlace(path)
}

/** A change with the name the settings give it. */
export interface ShownChange extends SettingChange {
  label: string
}

/** The changes on one section of the settings dialog. */
export interface ChangeGroup {
  label: string
  changes: ShownChange[]
}

/**
 * Every row and card of the settings, also those this platform doesn't show (rows only Windows has
 * keep their place and name elsewhere).
 */
function allEntries(platform: string): SettingsEntry[] {
  const seen = new Set<string>()
  return [...settingsIndex('win32'), ...settingsIndex(platform)].filter((entry) => !seen.has(entry.id) && seen.add(entry.id))
}

/** The name of a setting as the settings show it. */
export function settingLabel(path: string, platform: string): string {
  if (path === 'themes') return 'Eigenes Theme'
  const place = settingPlace(path)
  const entry = place ? allEntries(platform).find((e) => e.id === place.anchor) : undefined
  return place?.label ?? entry?.label ?? path
}

/**
 * The changes grouped by the section of the settings dialog they are in, both in the dialog's order.
 * `platform`: `process.platform`, for names that differ between the systems.
 */
export function groupChanges(changes: readonly SettingChange[], platform: string): ChangeGroup[] {
  const order = allEntries(platform)
  const entries = new Map<string, SettingsEntry>(order.map((entry) => [entry.id, entry]))
  const rank = (path: string) => {
    const anchor = settingPlace(path)?.anchor
    const index = anchor ? order.findIndex((entry) => entry.id === anchor) : -1
    return index < 0 ? order.length : index
  }
  const groups = new Map<string, ChangeGroup>()
  const sorted = [...changes].sort((a, b) => rank(a.path) - rank(b.path))
  for (const change of sorted) {
    const place = settingPlace(change.path)
    const entry = place ? entries.get(place.anchor) : undefined
    const label = entry?.path[0] ?? 'Weitere'
    let group = groups.get(label)
    if (!group) groups.set(label, (group = { label, changes: [] }))
    group.changes.push({ ...change, label: place?.label ?? entry?.label ?? change.path })
  }
  return [...groups.values()]
}

const CHOICES: Record<string, Record<string, string>> = {
  'appearance.material': { mica: 'Mica', acrylic: 'Acryl', tabbed: 'Mica Alt', none: 'Aus' },
  'appearance.chatWidth': { normal: 'Normal', wide: 'Breit', full: 'Voll' },
  'chat.shell': { powershell: 'PowerShell', gitbash: 'Git Bash', cmd: 'cmd' },
  'notifications.when': { background: 'Im Hintergrund', hidden: 'Chat nicht offen' },
  'defaults.permissionMode': Object.fromEntries(Object.entries(PERMISSION_MODES).map(([id, mode]) => [id, mode.label])),
  'defaults.provider': Object.fromEntries(PROVIDER_IDS.map((id) => [id, providerName(id)])),
  'chat.voiceLanguage': Object.fromEntries(VOICE_LANGUAGES.map((language) => [language.code, language.label])),
}

/** What the settings show for an empty value. */
const EMPTY: Record<string, string> = {
  'appearance.uiFont': 'Geist (Standard)',
  'appearance.codeFont': 'Geist Mono (Standard)',
  'chat.voiceLanguage': 'Wie das System',
  'chat.voiceMicrophone': 'Wie das System',
  'chat.voiceAccount': 'Automatisch',
  'chat.continuePrompt': '„Mach weiter“',
}
const PROVIDER_EMPTY: Record<string, string> = {
  path: 'Im PATH suchen',
  model: 'Standard der CLI',
  effort: 'Standard des Modells',
  extraArgs: 'keine',
}

/** Names the window knows: themes (also those a file brings) and accounts; null for one that isn't here. */
export interface ValueNames {
  theme(id: string): string | null
  account(id: string): string | null
}

/** A setting's value the way the settings dialog names it. */
export function settingValueText(path: string, value: unknown, names: ValueNames): string {
  const [section, key] = path.split('.')
  if (path === 'appearance.theme' && typeof value === 'string') return names.theme(value) ?? `„${value}“ (fehlt hier)`
  if ((path.startsWith('defaults.accounts.') || path === 'chat.voiceAccount') && typeof value === 'string' && value) {
    return names.account(value) ?? 'Account, den es hier nicht gibt'
  }
  const choice = CHOICES[path]?.[String(value)]
  if (choice) return choice
  if (value === '' || (Array.isArray(value) && value.length === 0)) {
    return EMPTY[path] ?? (isProvider(section) ? PROVIDER_EMPTY[key] : undefined) ?? '(leer)'
  }
  if (isProvider(section) && key === 'effort' && typeof value === 'string') return effortLabel(value)
  if (value === true) return 'An'
  if (value === false) return 'Aus'
  if (typeof value === 'number') {
    switch (path) {
      case 'appearance.radius':
        return `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} rem`
      case 'appearance.uiFontSize':
        return `${value} px`
      case 'appearance.surfaceOpacity':
      case 'appearance.zoom':
      case 'notifications.nearLimitPercent':
        return `${value} %`
      case 'notifications.minBusySeconds':
        return value === 0 ? 'immer' : `ab ${value} s`
      case 'api.port':
        return String(value)
      default:
        return value.toLocaleString('de-DE')
    }
  }
  if (Array.isArray(value)) return formatArgs(value.map(String))
  if (path === 'chat.continuePrompt' && typeof value === 'string') return `„${value}“`
  return String(value)
}

/**
 * The settings of the file that stay as they are, by why: what names something this computer lacks,
 * and values Nexa doesn't take. Each name once, in the file's order.
 */
export function skippedNames(skipped: readonly SkippedSetting[], platform: string): { missing: string[]; invalid: string[] } {
  const names = (reason: SkippedSetting['reason']) => [
    ...new Set(
      skipped
        .filter((s) => s.reason === reason)
        .map((s) => {
          const label = settingLabel(s.path, platform)
          return s.path === 'themes' && typeof s.value === 'string' ? `${label} „${s.value}“` : label
        }),
    ),
  ]
  return { missing: names('missing'), invalid: names('invalid') }
}

/** The key of a theme of the file in the dialog's selection; settings go by their path. */
export const themeKey = (id: string) => `theme:${id}`

/**
 * What to take over for the selection of the import dialog: the settings picked, and the themes to add
 * first: those picked, and the one the theme setting picks from the file even when not picked itself.
 */
export function importSelection(preview: SettingsImportPreview, selected: ReadonlySet<string>): { changes: SettingChange[]; themes: SettingsFileTheme[] } {
  const changes = preview.changes.filter((change) => selected.has(change.path))
  const picked = changes.find((change) => change.path === 'appearance.theme')?.to
  const themes = preview.themes.filter((theme) => selected.has(themeKey(theme.id)) || theme.id === picked)
  return { changes, themes }
}

/** The theme setting with the id a theme of the file got here once it was added (`added`: file's id → id here). */
export function withAddedThemes(changes: readonly SettingChange[], added: ReadonlyMap<string, string>): SettingChange[] {
  return changes.map((change) =>
    change.path === 'appearance.theme' && typeof change.to === 'string' && added.has(change.to) ? { ...change, to: added.get(change.to) } : change,
  )
}

/**
 * The microphone of the file, when it isn't connected here: it stays as it is, like what main found
 * missing. Only the window sees the microphones (`labels`: the names of those connected; none when
 * they couldn't be read, then it is taken).
 */
export function withoutMissingMicrophone(preview: SettingsImportPreview, labels: readonly string[]): SettingsImportPreview {
  const change = preview.changes.find((c) => c.path === 'chat.voiceMicrophone')
  if (!change || typeof change.to !== 'string' || change.to === '' || labels.length === 0 || labels.includes(change.to)) return preview
  return {
    ...preview,
    changes: preview.changes.filter((c) => c !== change),
    skipped: [...preview.skipped, { path: change.path, value: change.to, reason: 'missing' }],
  }
}
