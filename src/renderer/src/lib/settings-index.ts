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
  /** Only while the Claude Manager's data is on this computer (its import). */
  readonly claudeManagerData?: boolean
  /** Only shown on Windows, with all its rows (the `nx` command). */
  readonly windowsOnly?: boolean
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
    tab: 'general',
    label: 'Allgemein',
    sections: [
      {
        id: 'general.window',
        title: 'Fenster und Start',
        keywords: 'schließen beenden Hintergrund',
        fields: [
          {
            id: 'general.runInTray',
            label: 'Im Infobereich weiterlaufen',
            keywords: 'Tray Taskleiste Symbol Statusbereich ausblenden minimieren schließen weiterlaufen Hintergrund',
          },
          {
            id: 'general.launchAtLogin',
            label: 'Mit Windows starten',
            keywords: 'Autostart Anmeldung Login hochfahren Systemstart automatisch starten',
          },
        ],
      },
      {
        id: 'general.command',
        title: 'Befehl „nx“',
        keywords: 'nx Kommandozeile Terminal Explorer Adressleiste CLI starten',
        windowsOnly: true,
        fields: [
          { id: 'general.commandRegistered', label: 'Befehl einrichten', keywords: 'PATH installieren registrieren abmelden entfernen' },
          { id: 'general.nxReuseChat', label: 'Offenen Chat wiederverwenden', keywords: 'Ordner wechseln neuer Chat' },
        ],
      },
      {
        id: 'general.transfer',
        title: 'Einstellungen übertragen',
        keywords:
          'exportieren importieren Export Import sichern Sicherung Backup wiederherstellen anderer Computer neuer PC Umzug umziehen mitnehmen Datei JSON Themes vergleichen übernehmen',
      },
    ],
  },
  {
    tab: 'appearance',
    label: 'Darstellung',
    sections: [
      {
        id: 'appearance.theme',
        title: 'Theme',
        keywords: 'Farben Farbschema hell dunkel Design Aussehen',
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
          { id: 'appearance.zoom', label: 'Skalierung', keywords: 'Zoom Größe vergrößern verkleinern Prozent Strg Plus Minus Oberfläche' },
          { id: 'appearance.radius', label: 'Ecken', keywords: 'Eckenradius abgerundet Rundung' },
        ],
      },
      {
        id: 'appearance.font',
        title: 'Schrift',
        keywords: 'Schriftarten Fonts Text',
        fields: [
          { id: 'appearance.uiFont', label: 'Schriftart', keywords: 'Font Schriftfamilie Oberfläche Nachrichten Text Geist Segoe Inter' },
          { id: 'appearance.uiFontSize', label: 'Schriftgröße', keywords: 'Text Größe Schrift' },
          {
            id: 'appearance.codeFont',
            label: 'Code-Schrift',
            keywords: 'Font Monospace Festbreitenschrift Programmierschrift Diffs Dateien Shell Werkzeuge Geist Mono Cascadia JetBrains Mono Fira Code Consolas',
          },
          { id: 'appearance.ligatures', label: 'Ligaturen', keywords: 'Code Schrift Zeichen verbinden Pfeil Ungleich JetBrains Mono Fira Code Cascadia Code' },
        ],
      },
      {
        id: 'appearance.chat',
        title: 'Chat',
        keywords: 'Verlauf Darstellung',
        fields: [{ id: 'appearance.chatWidth', label: 'Breite', keywords: 'schmal breit voll Spalte Nachrichten Layout Bildschirm Auflösung 4K Ultrawide' }],
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
          'Account Konto Konten Login anmelden neu anmelden Profil wechseln Vorgabe Standard Abo Plan Max Pro Token setup-token API-Key Anthropic CLAUDE_CONFIG_DIR Konfigurationsordner hinzufügen entfernen Limits Usage Reihenfolge sortieren verschieben',
      },
      {
        id: 'accounts.codex',
        title: 'Codex',
        keywords:
          'Account Konto Konten Login anmelden neu anmelden Profil wechseln Vorgabe Standard Abo Plan ChatGPT Plus Pro OpenAI CODEX_HOME Konfigurationsordner hinzufügen entfernen Limits Usage Reihenfolge sortieren verschieben',
      },
      {
        id: 'accounts.antigravity',
        title: 'Antigravity CLI',
        keywords:
          'Account Konto Konten Login anmelden neu anmelden Profil wechseln Vorgabe Standard Google AI Studio API-Key GEMINI_API_KEY gemini-dir Keyring Konfigurationsordner hinzufügen entfernen Reihenfolge sortieren verschieben',
      },
      {
        id: 'accounts.logins',
        title: 'Logins',
        keywords:
          'Login Anmeldung Token Access-Token Refresh-Token abgelaufen Ablauf läuft ab erneuern Jetzt erneuern neu anmelden gültig OAuth Tabelle Übersicht',
        fields: [
          {
            id: 'accounts.keepLoginsFresh',
            label: 'Logins frisch halten',
            keywords: 'automatisch erneuern Token abgelaufen ruhende Accounts Limits Usage Wechsel Refresh-Token Sperre',
          },
        ],
      },
      {
        id: 'accounts.limit',
        title: 'Bei erreichtem Limit',
        keywords: 'Limit Usage Rate Limit erschöpft aufgebraucht Reset Kontingent Abo',
        fields: [
          {
            id: 'accounts.autoSwitch',
            label: 'Account automatisch wechseln',
            keywords: 'Account wechseln weitermachen fortsetzen nächster freier Reihenfolge warten Countdown Reset automatisch',
          },
          { id: 'accounts.continuePrompt', label: 'Nachricht zum Weitermachen', keywords: 'Mach weiter Prompt Text fortsetzen Reset Nachricht' },
        ],
      },
      {
        id: 'accounts.cliImport',
        title: 'Sessions der CLIs übernehmen',
        keywords:
          'Import importieren übernehmen Sessions Unterhaltungen Verlauf Terminal IDE VS Code Claude Code Codex Desktop App vorhandene bestehende alte fortsetzen resume projects sessions Rollouts',
      },
      {
        id: 'accounts.import',
        title: 'Vom Claude Manager übernehmen',
        keywords: 'Claude Manager Signalbox Import importieren übernehmen migrieren Umzug Sessions Workspaces Projekte Unterordner Verlauf Prompts Themes',
        claudeManagerData: true,
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
        keywords: 'Verbrauch Usage Limits Auslastung 5 Stunden Woche Reset Tokens Antworten Dashboard Statistik',
      },
      {
        id: 'usage.codex',
        title: 'Codex',
        keywords: 'Verbrauch Usage Limits Auslastung Monat Reset Tokens Antworten Dashboard Statistik',
      },
      {
        id: 'usage.antigravity',
        title: 'Antigravity CLI',
        keywords: 'Verbrauch Usage Limits Kontingent Quota Auslastung 5 Stunden Woche Reset Tokens Antworten Dashboard Statistik Google Gemini Antigravity agy',
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
          { id: 'providers.provider', label: 'CLI', keywords: 'Claude Code Codex Antigravity agy Anbieter Standard' },
          { id: 'providers.permissionMode', label: 'Freigaben', keywords: 'Berechtigungen Rechte nachfragen erlauben automatisch Modus Plan' },
        ],
      },
      { id: 'claude', title: 'Claude Code', keywords: 'Anthropic Claude Version Anmeldung Login Konto', fields: cliFields('claude') },
      { id: 'codex', title: 'Codex', keywords: 'OpenAI ChatGPT Version Anmeldung Login Konto', fields: cliFields('codex') },
      { id: 'antigravity', title: 'Antigravity CLI', keywords: 'Google Antigravity agy Gemini Version Anmeldung Login Konto ACP', fields: cliFields('antigravity') },
    ],
  },
  {
    tab: 'cliConfig',
    label: 'CLI-Konfiguration',
    sections: [
      {
        id: 'cliConfig.target',
        title: 'Konfiguration',
        keywords: 'Einstellungen settings.json config.toml .claude.json .mcp.json Datei Ordner Profil',
        fields: [
          { id: 'cliConfig.provider', label: 'CLI', keywords: 'Claude Code Codex' },
          { id: 'cliConfig.account', label: 'Account', keywords: 'Konto Profil Konfigurationsordner CLAUDE_CONFIG_DIR CODEX_HOME' },
          { id: 'cliConfig.scope', label: 'Ebene', keywords: 'Nutzer Projekt Lokal global Bereich Scope' },
          { id: 'cliConfig.project', label: 'Projekt', keywords: 'Ordner Repository Arbeitsordner' },
        ],
      },
      {
        id: 'cliConfig.mcp',
        title: 'MCP-Server',
        keywords:
          'MCP Server Konnektoren Connectors Werkzeuge Tools hinzufügen bearbeiten entfernen stdio HTTP SSE Befehl URL Umgebungsvariablen Header Token Secrets',
      },
      {
        id: 'cliConfig.permissions',
        title: 'Berechtigungen',
        keywords:
          'Freigaben Rechte erlauben nachfragen verbieten allow ask deny Regeln Modus defaultMode Ordner additionalDirectories Sandbox approval_policy sandbox_mode Netzwerk',
      },
      {
        id: 'cliConfig.hooks',
        title: 'Hooks',
        keywords: 'Ereignisse Events Befehle Skripte automatisch PreToolUse PostToolUse Stop SessionStart Matcher vertrauen Trust',
      },
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
          { id: 'chat.autoTitles', label: 'Titel vom Modell', keywords: 'Name Session benennen automatisch Überschrift Seitenleiste' },
        ],
      },
      {
        id: 'chat.input',
        title: 'Eingabe',
        keywords: 'Composer Nachricht schreiben',
        fields: [
          { id: 'chat.enterSends', label: 'Enter sendet', keywords: 'Strg+Enter Zeilenumbruch Tastatur senden Shortcut' },
          { id: 'chat.shell', label: 'Shell für „!“', keywords: 'Ausrufezeichen Befehl Terminal Konsole PowerShell pwsh Git Bash cmd Kommandozeile Shell-Modus Startbefehle Dev-Server', windowsOnly: true },
        ],
      },
      {
        id: 'chat.voice',
        title: 'Spracheingabe',
        keywords: 'Mikrofon diktieren sprechen Stimme Voice Speech to Text Transkription Strg+M',
        fields: [
          { id: 'chat.voiceMicrophone', label: 'Mikrofon', keywords: 'Spracheingabe Headset Gerät Audio Eingang Aufnahme USB' },
          { id: 'chat.voiceLanguage', label: 'Sprache', keywords: 'Spracheingabe Deutsch Englisch Diktat Erkennung' },
          { id: 'chat.voiceAutoStop', label: 'Automatisch beenden', keywords: 'Spracheingabe Pause Stille aufhören stoppen Aufnahme Ende erkennen' },
          { id: 'chat.voiceAutoSend', label: 'Automatisch abschicken', keywords: 'Spracheingabe senden absenden Enter freihändig Nachricht' },
          { id: 'chat.voiceAccount', label: 'Account', keywords: 'Spracheingabe Claude Anmeldung Login claude.ai' },
        ],
      },
      {
        id: 'chat.removal',
        title: 'Löschen',
        keywords: 'entfernen Speicherplatz',
        fields: [
          {
            id: 'chat.deleteCliConversations',
            label: 'Transkripte der CLIs mitlöschen',
            keywords: 'Papierkorb Unterhaltung Claude Code Codex Rollout Subagents Checkpoints Dateien',
          },
          { id: 'chat.cleanup', label: 'Chats aufräumen', keywords: 'alte große mehrere löschen Filter Alter Größe Speicherplatz' },
        ],
      },
      {
        id: 'chat.tools',
        title: 'Nexa-Werkzeuge',
        keywords: 'MCP Server Tools Werkzeuge Limits Usage',
        fields: [
          { id: 'chat.renderTools', label: 'Diagramme, Charts und Tabellen', keywords: 'Mermaid Grafik Visualisierung rendern MCP' },
          { id: 'chat.browserTools', label: 'Browser neben dem Chat', keywords: 'Webseite Web testen Playwright Automatisierung MCP' },
          { id: 'chat.noClaudeInChrome', label: 'Ohne „Claude in Chrome“', keywords: 'Chrome Erweiterung Extension Browser' },
          { id: 'chat.chatTools', label: 'Nachrichten zwischen Chats', keywords: 'Session senden weiterleiten durchsuchen Suche frühere Claude Codex Agenten MCP' },
          { id: 'chat.browserData', label: 'Browserdaten', keywords: 'Cookies Cache abmelden löschen Browser' },
        ],
      },
    ],
  },
  {
    tab: 'notifications',
    label: 'Benachrichtigungen',
    sections: [
      {
        id: 'notifications.main',
        title: 'Benachrichtigungen',
        keywords: 'Mitteilungen Hinweise Windows Toast Glocke stumm stummschalten Ruhe',
        fields: [
          { id: 'notifications.enabled', label: 'Benachrichtigungen', keywords: 'an aus einschalten ausschalten Glocke Titelleiste' },
          { id: 'notifications.test', label: 'Ausprobieren', keywords: 'Test Beispiel' },
        ],
      },
      {
        id: 'notifications.events',
        title: 'Ereignisse',
        keywords: 'Agent Claude Codex',
        fields: [
          { id: 'notifications.onDone', label: 'Chat ist fertig', keywords: 'Antwort beendet abgeschlossen Fehler' },
          { id: 'notifications.minBusy', label: 'Erst nach längerer Arbeit', keywords: 'Mindestdauer Sekunden Dauer kurz' },
          { id: 'notifications.onInput', label: 'Agent braucht dich', keywords: 'Rückfrage Frage Erlaubnis Freigabe Plan Berechtigung warten' },
          { id: 'notifications.onLimit', label: 'Limit erreicht', keywords: 'Nutzungslimit Usage Reset gestoppt' },
          { id: 'notifications.onNearLimit', label: 'Limit fast verbraucht', keywords: 'Warnung Schwelle Usage Verbrauch Account 80' },
          { id: 'notifications.nearLimitPercent', label: 'Schwelle', keywords: 'Prozent Grenze Warnung 80' },
          { id: 'notifications.onLoginLost', label: 'Login abgelaufen', keywords: 'Anmeldung Account neu anmelden Token' },
        ],
      },
      {
        id: 'notifications.hints',
        title: 'Hinweise',
        keywords: 'Art Weise',
        fields: [
          { id: 'notifications.when', label: 'Benachrichtigen, wenn', keywords: 'Hintergrund Vordergrund anderer Chat minimiert' },
          { id: 'notifications.preview', label: 'Vorschau', keywords: 'Inhalt Text Antwort Befehl Datenschutz' },
          { id: 'notifications.sound', label: 'Ton', keywords: 'Klang Sound stumm leise' },
          { id: 'notifications.flash', label: 'Taskleiste blinkt', keywords: 'Taskleiste blinken Fenster markieren' },
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
      { id: 'api.endpoints', title: 'Endpunkte', keywords: 'Routen Dokumentation Docs OpenAPI Swagger Postman Schema SSE Events curl' },
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

/**
 * The cards and rows the settings show on this platform (`process.platform`), in their order;
 * `claudeManagerData`: whether the Claude Manager's data is there, for its import.
 */
export function settingsIndex(platform: string, claudeManagerData = true): SettingsEntry[] {
  const windows = platform === 'win32'
  const entries: SettingsEntry[] = []
  for (const tab of TREE as readonly TabDef[]) {
    for (const section of tab.sections) {
      if ((section.claudeManagerData && !claudeManagerData) || (section.windowsOnly && !windows)) continue
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
