import type { SettingsSection } from '@/stores/ui'
import { containsTerms, searchText } from './search'

/**
 * Every card and row of the settings, for their search. `id` is the anchor the dialog puts on the
 * card or row (`anchor` of SettingsSection and SettingField); a test checks the components use only
 * these. `keywords` are other words people may look for, e.g. from the description.
 */

interface FieldDef {
  readonly id: string
  readonly label: string
  readonly keywords?: string
  /** Only shown on Windows, e.g. what needs the window material. */
  readonly windowsOnly?: boolean
}

interface SectionDef {
  readonly id: string
  readonly title: string
  readonly keywords?: string
  readonly fields?: readonly FieldDef[]
}

interface TabDef {
  readonly tab: SettingsSection
  readonly label: string
  readonly sections: readonly SectionDef[]
}

/** The settings of a CLI; the same rows for each. */
function cliFields<P extends string>(p: P) {
  return [
    { id: `${p}.enabled`, label: 'In Nexa nutzen', keywords: 'aktiv aktivieren deaktivieren einschalten ausschalten ausblenden verwenden' },
    { id: `${p}.model`, label: 'Modell', keywords: 'Standardmodell neue Chats Opus Sonnet Haiku GPT' },
    { id: `${p}.path`, label: 'Pfad zur CLI', keywords: 'Programm exe installiert finden PATH Ordner' },
    { id: `${p}.extraArgs`, label: 'Zusätzliche Argumente', keywords: 'Parameter Flags Optionen Kommandozeile Start' },
  ] as const
}

const TREE = [
  {
    tab: 'appearance',
    label: 'Darstellung',
    sections: [
      {
        id: 'appearance.theme',
        title: 'Theme',
        keywords: 'Farben Farbschema hell dunkel Design Aussehen Claude Manager',
        fields: [
          {
            id: 'appearance.customThemes',
            label: 'Eigene Themes',
            keywords: 'Theme erstellen bearbeiten Editor Farbwähler Color Picker anpassen kopieren importieren exportieren teilen JSON Datei löschen Ordner',
          },
        ],
      },
      {
        id: 'appearance.window',
        title: 'Fenster',
        keywords: 'Oberfläche Windows 11',
        fields: [
          { id: 'appearance.material', label: 'Material', keywords: 'Acryl Mica Transparenz durchsichtig Hintergrund', windowsOnly: true },
          { id: 'appearance.keepMaterial', label: 'Auch im Hintergrund', keywords: 'Material inaktiv Fokus Hintergrund', windowsOnly: true },
          { id: 'appearance.surfaceOpacity', label: 'Deckkraft der Flächen', keywords: 'Transparenz durchsichtig undurchsichtig Material', windowsOnly: true },
          { id: 'appearance.uiFontSize', label: 'Schriftgröße', keywords: 'Text Größe Zoom Schrift' },
          { id: 'appearance.radius', label: 'Ecken', keywords: 'Eckenradius abgerundet Rundung' },
        ],
      },
      {
        id: 'appearance.chat',
        title: 'Chat',
        keywords: 'Verlauf Darstellung',
        fields: [{ id: 'appearance.chatWidth', label: 'Breite', keywords: 'schmal breit voll Spalte Nachrichten Layout' }],
      },
    ],
  },
  {
    tab: 'accounts',
    label: 'Accounts',
    sections: [
      {
        id: 'accounts.claude',
        title: 'Claude Code',
        keywords:
          'Account Konto Konten Login anmelden neu anmelden Profil wechseln Vorgabe Standard Abo Plan Max Pro Token setup-token API-Key Anthropic CLAUDE_CONFIG_DIR Konfigurationsordner hinzufügen entfernen Limits Usage',
      },
      {
        id: 'accounts.codex',
        title: 'Codex',
        keywords:
          'Account Konto Konten Login anmelden neu anmelden Profil wechseln Vorgabe Standard Abo Plan ChatGPT Plus Pro OpenAI CODEX_HOME Konfigurationsordner hinzufügen entfernen Limits Usage',
      },
      {
        id: 'accounts.import',
        title: 'Vom Claude Manager übernehmen',
        keywords: 'Claude Manager Signalbox Import importieren übernehmen migrieren Umzug Sessions Workspaces Projekte Unterordner Verlauf',
      },
    ],
  },
  {
    tab: 'usage',
    label: 'Verbrauch',
    sections: [
      {
        id: 'usage.claude',
        title: 'Claude Code',
        keywords: 'Verbrauch Usage Limits Auslastung 5 Stunden Woche Reset Tokens Kosten Antworten Dashboard Statistik',
      },
      {
        id: 'usage.codex',
        title: 'Codex',
        keywords: 'Verbrauch Usage Limits Auslastung Monat Reset Tokens Kosten Antworten Dashboard Statistik',
      },
      { id: 'usage.days', title: 'Tokens pro Tag', keywords: 'Verbrauch Diagramm Chart Verlauf Tage Statistik Dashboard' },
    ],
  },
  {
    tab: 'providers',
    label: 'CLIs',
    sections: [
      {
        id: 'providers.defaults',
        title: 'Neue Chats',
        keywords: 'Standard Vorgabe erkennen prüfen installiert',
        fields: [
          { id: 'providers.provider', label: 'CLI', keywords: 'Claude Code Codex Anbieter Standard' },
          { id: 'providers.permissionMode', label: 'Freigaben', keywords: 'Berechtigungen Rechte nachfragen erlauben automatisch Modus Plan' },
        ],
      },
      { id: 'claude', title: 'Claude Code', keywords: 'Anthropic Claude Version Anmeldung Login Konto', fields: cliFields('claude') },
      { id: 'codex', title: 'Codex', keywords: 'OpenAI ChatGPT Version Anmeldung Login Konto', fields: cliFields('codex') },
    ],
  },
  {
    tab: 'chat',
    label: 'Chat',
    sections: [
      {
        id: 'chat.history',
        title: 'Verlauf',
        fields: [
          { id: 'chat.showThinking', label: 'Gedanken anzeigen', keywords: 'Thinking Reasoning Denken Überlegungen' },
          { id: 'chat.collapseDiffs', label: 'Änderungen eingeklappt', keywords: 'Diffs Dateien schreiben bearbeiten Werkzeuge Tools zuklappen ausklappen aufklappen' },
        ],
      },
      {
        id: 'chat.input',
        title: 'Eingabe',
        keywords: 'Composer Nachricht schreiben',
        fields: [{ id: 'chat.enterSends', label: 'Enter sendet', keywords: 'Strg+Enter Zeilenumbruch Tastatur senden Shortcut' }],
      },
      {
        id: 'chat.tools',
        title: 'Nexa-Werkzeuge',
        keywords: 'MCP Server Tools Werkzeuge',
        fields: [
          { id: 'chat.renderTools', label: 'Diagramme, Charts und Tabellen', keywords: 'Mermaid Grafik Visualisierung rendern MCP' },
          { id: 'chat.browserTools', label: 'Browser neben dem Chat', keywords: 'Webseite Web testen Playwright Automatisierung MCP' },
          { id: 'chat.noClaudeInChrome', label: 'Ohne „Claude in Chrome“', keywords: 'Chrome Erweiterung Extension Browser' },
          { id: 'chat.browserData', label: 'Browserdaten', keywords: 'Cookies Cache abmelden löschen Browser' },
        ],
      },
    ],
  },
  {
    tab: 'api',
    label: 'Lokale API',
    sections: [
      {
        id: 'api.server',
        title: 'Lokale API',
        keywords: 'HTTP REST Stream Deck Skripte Automation Server Token',
        fields: [
          { id: 'api.enabled', label: 'Einschalten', keywords: 'aktivieren an aus starten' },
          { id: 'api.port', label: 'Port', keywords: 'Netzwerk Adresse localhost 127.0.0.1' },
        ],
      },
      { id: 'api.endpoints', title: 'Endpunkte', keywords: 'Routen Dokumentation SSE Events curl' },
    ],
  },
  {
    tab: 'updates',
    label: 'Updates',
    sections: [
      { id: 'updates.status', title: 'Updates', keywords: 'Version neue Aktualisierung herunterladen installieren neu starten suchen' },
      { id: 'updates.notes', title: 'Versionshinweise', keywords: 'Änderungen neu Changelog Release Notes Was ist neu GitHub' },
    ],
  },
  {
    tab: 'about',
    label: 'Info',
    sections: [
      { id: 'about.app', title: 'Nexa', keywords: 'Version Über Datenordner App-Daten Speicherort' },
      { id: 'about.command', title: 'Befehl nx', keywords: 'Kommandozeile Terminal Explorer Adressleiste CLI starten' },
    ],
  },
] as const satisfies readonly TabDef[]

type Section = (typeof TREE)[number]['sections'][number]
type Field = Extract<Section, { fields: unknown }>['fields'][number]
/** Anchor of a card or row of the settings. */
export type SettingsAnchor = Section['id'] | Field['id']

export interface SettingsEntry {
  id: SettingsAnchor
  kind: 'section' | 'field'
  tab: SettingsSection
  label: string
  /** The card a row is in. */
  section?: SettingsAnchor
  /** Where it is, for the quick open: the section of the dialog, and for a row its card. */
  path: string[]
  /** Text the search terms are tested against (see `searchText`). */
  text: string
}

/** The cards and rows the settings show on this platform (`process.platform`), in their order. */
export function settingsIndex(platform: string): SettingsEntry[] {
  const windows = platform === 'win32'
  const entries: SettingsEntry[] = []
  for (const tab of TREE as readonly TabDef[]) {
    for (const section of tab.sections) {
      entries.push({
        id: section.id as SettingsAnchor,
        kind: 'section',
        tab: tab.tab,
        label: section.title,
        path: [tab.label],
        text: searchText(section.title, section.keywords, tab.label),
      })
      for (const field of section.fields ?? []) {
        if (field.windowsOnly && !windows) continue
        entries.push({
          id: field.id as SettingsAnchor,
          kind: 'field',
          tab: tab.tab,
          label: field.label,
          section: section.id as SettingsAnchor,
          path: [tab.label, section.title],
          text: searchText(field.label, field.keywords, section.title, tab.label),
        })
      }
    }
  }
  return entries
}

export interface SettingsMatch {
  /** Cards and rows to show: the hits, every row of a card that is a hit, and the card of every row that is one. */
  ids: ReadonlySet<SettingsAnchor>
  /** Sections of the dialog with something to show, in their order, with how many hits. */
  tabs: Map<SettingsSection, number>
}

/** What of the settings matches the search terms (see `searchTerms`); null without terms. */
export function matchSettings(entries: readonly SettingsEntry[], terms: string[]): SettingsMatch | null {
  if (terms.length === 0) return null
  const hits = new Set(entries.filter((entry) => containsTerms(entry.text, terms)).map((entry) => entry.id))
  const ids = new Set<SettingsAnchor>()
  for (const entry of entries) {
    if (!hits.has(entry.id) && !(entry.section && hits.has(entry.section))) continue
    if (entry.section) ids.add(entry.section)
    ids.add(entry.id)
  }
  const tabs = new Map<SettingsSection, number>()
  for (const entry of entries) {
    if (hits.has(entry.id)) tabs.set(entry.tab, (tabs.get(entry.tab) ?? 0) + 1)
    else if (ids.has(entry.id) && !tabs.has(entry.tab)) tabs.set(entry.tab, 0)
  }
  return { ids, tabs }
}
