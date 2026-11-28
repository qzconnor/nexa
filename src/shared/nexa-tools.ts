import type { ToolSettings } from './types'

/**
 * The tools of Nexa's MCP server as the settings show them (Einstellungen › Nexa-Werkzeuge): by
 * category and group, each in words. The definitions the server offers are in main
 * (`mcp/render-tools.ts`, `browser/browser-tools`, `mcp/chat-tools.ts` …); a test there keeps both
 * in step. Every tool can be switched off on its own (`ToolSettings.disabled`); three categories also
 * have a switch for all of their tools.
 */

export type NexaToolCategoryId = 'render' | 'browser' | 'chat' | 'app'

export interface NexaToolInfo {
  /** As the server names it, without its prefix (`browser_click`). */
  name: string
  label: string
  description: string
  /** The CLI asks before it runs (it reaches beyond the page: `sensitive` of the browser tools). */
  asks?: boolean
}

export interface NexaToolGroup {
  id: string
  label: string
  tools: readonly NexaToolInfo[]
}

export interface NexaToolCategory {
  id: NexaToolCategoryId
  /** The switch of `ToolSettings` for the whole category; the app's tools have none, they come with the server. */
  setting: 'renderTools' | 'browserTools' | 'chatTools' | null
  groups: readonly NexaToolGroup[]
}

export const NEXA_TOOL_CATEGORIES: readonly NexaToolCategory[] = [
  {
    id: 'render',
    setting: 'renderTools',
    groups: [
      {
        id: 'render',
        label: 'Im Chat zeichnen',
        tools: [
          { name: 'render_chart', label: 'Charts', description: 'Balken-, Linien-, Flächen- und Kreisdiagramme aus Zahlen.' },
          { name: 'render_diagram', label: 'Diagramme', description: 'Abläufe und Aufbau als Mermaid-Diagramm.' },
          { name: 'render_table', label: 'Tabellen', description: 'Größere Vergleiche, sortierbar.' },
          { name: 'render_stats', label: 'Kennzahlen', description: 'Wichtige Zahlen als Kacheln.' },
          { name: 'render_callout', label: 'Hinweise', description: 'Warnungen und Tipps als Kasten.' },
        ],
      },
    ],
  },
  {
    id: 'browser',
    setting: 'browserTools',
    groups: [
      {
        id: 'navigation',
        label: 'Seiten öffnen',
        tools: [
          { name: 'browser_navigate', label: 'Seite öffnen', description: 'Öffnet eine Adresse, auch localhost.' },
          { name: 'browser_history', label: 'Vor, zurück und neu laden', description: 'Geht im Verlauf vor oder zurück, lädt neu.' },
          { name: 'browser_tabs', label: 'Tabs', description: 'Listet, öffnet, wechselt und schließt die Tabs des Chats.' },
        ],
      },
      {
        id: 'reading',
        label: 'Lesen',
        tools: [
          { name: 'browser_snapshot', label: 'Seite lesen', description: 'Die Seite als Gliederung, mit Verweisen auf ihre Elemente.' },
          { name: 'browser_find', label: 'Auf der Seite suchen', description: 'Findet Elemente nach Text oder Rolle, auch auf langen Seiten.' },
          { name: 'browser_take_screenshot', label: 'Screenshot', description: 'Ein Bild der Seite oder eines Elements, auch in mehreren Breiten.' },
          { name: 'browser_wait_for', label: 'Warten', description: 'Bis ein Text erscheint oder verschwindet, oder eine Zeit lang.' },
          { name: 'browser_pdf_save', label: 'Als PDF speichern', description: 'Speichert die Seite als PDF in deinen Downloads.' },
        ],
      },
      {
        id: 'interaction',
        label: 'Bedienen',
        tools: [
          { name: 'browser_click', label: 'Klicken', description: 'Klickt ein Element oder eine Stelle an.' },
          { name: 'browser_type', label: 'Eintippen', description: 'Schreibt Text in ein Feld.' },
          { name: 'browser_fill_form', label: 'Formular ausfüllen', description: 'Füllt mehrere Felder auf einmal.' },
          { name: 'browser_press_key', label: 'Taste drücken', description: 'Drückt eine Taste oder Tastenkombination.' },
          { name: 'browser_hover', label: 'Zeigen', description: 'Fährt mit dem Zeiger über ein Element.' },
          { name: 'browser_select_option', label: 'Auswählen', description: 'Wählt in einer Auswahlliste.' },
          { name: 'browser_scroll', label: 'Scrollen', description: 'Scrollt die Seite oder ein Element.' },
          { name: 'browser_drag', label: 'Ziehen', description: 'Zieht ein Element auf ein anderes.' },
          { name: 'browser_handle_dialog', label: 'Dialoge beantworten', description: 'Beantwortet alert, confirm und prompt der Seite.' },
          { name: 'browser_file_upload', label: 'Dateien hochladen', description: 'Gibt der Seite Dateien von deinem Computer.', asks: true },
        ],
      },
      {
        id: 'debugging',
        label: 'Prüfen und Debuggen',
        tools: [
          { name: 'browser_inspect', label: 'Element prüfen', description: 'Box-Modell, Styles und warum ein Element verdeckt oder versteckt ist.' },
          { name: 'browser_check_accessibility', label: 'Barrierefreiheit prüfen', description: 'Fehlende Beschriftungen, Kontrast, falsche Rollen.' },
          { name: 'browser_console_messages', label: 'Konsole lesen', description: 'Meldungen und Fehler der Seite.' },
          { name: 'browser_network_requests', label: 'Netzwerk lesen', description: 'Die Anfragen der Seite mit Status und Dauer.' },
          { name: 'browser_network_request', label: 'Anfrage lesen', description: 'Header und Inhalt einer Anfrage, auch WebSocket-Nachrichten.', asks: true },
          { name: 'browser_performance', label: 'Leistung messen', description: 'Ladezeiten und Web Vitals.' },
          { name: 'browser_resize', label: 'Größe ändern', description: 'Andere Fenstergrößen, etwa Handy oder Tablet.' },
          { name: 'browser_emulate', label: 'Umgebung nachstellen', description: 'Dunkler Modus, langsames Netz, Sprache, Zeitzone, Ort, Berechtigungen.' },
        ],
      },
      {
        id: 'page',
        label: 'In die Seite eingreifen',
        tools: [
          { name: 'browser_evaluate', label: 'Skript ausführen', description: 'Führt JavaScript in der Seite aus.', asks: true },
          { name: 'browser_route', label: 'Anfragen umleiten', description: 'Beantwortet Anfragen selbst, lässt sie scheitern oder bremst sie.' },
          { name: 'browser_storage', label: 'Cookies und Speicher', description: 'Liest und setzt Cookies, Local und Session Storage.', asks: true },
          { name: 'browser_clear_site_data', label: 'Daten der Seite löschen', description: 'Löscht Cookies, Speicher und Cache einer Seite.', asks: true },
        ],
      },
      {
        id: 'testing',
        label: 'Tests',
        tools: [{ name: 'browser_generate_test', label: 'Test erzeugen', description: 'Macht aus den Schritten einen Playwright-Test.' }],
      },
    ],
  },
  {
    id: 'chat',
    setting: 'chatTools',
    groups: [
      {
        id: 'chat',
        label: 'Andere Chats',
        tools: [
          { name: 'chat_list', label: 'Chats auflisten', description: 'Findet deine Chats nach Name und Projekt.' },
          { name: 'chat_read', label: 'Chats lesen', description: 'Liest, was in einem anderen Chat steht.' },
          { name: 'sessions_search', label: 'Frühere Chats durchsuchen', description: 'Sucht in allem, was in deinen Chats gesagt wurde, auch in archivierten.' },
          { name: 'chat_send', label: 'Nachrichten senden', description: 'Schreibt einem anderen Chat, dessen Agent antwortet.' },
          { name: 'chat_new', label: 'Neue Chats anlegen', description: 'Startet einen Chat mit Claude Code, Codex oder Antigravity CLI.' },
        ],
      },
    ],
  },
  {
    id: 'app',
    setting: null,
    groups: [
      {
        id: 'app',
        label: 'Nexa',
        tools: [
          { name: 'ask_user', label: 'Rückfragen mit Formular', description: 'Fragt dich mit mehreren Feldern auf einmal, auch in CLIs ohne eigenes Fragewerkzeug.' },
          { name: 'notify', label: 'Benachrichtigungen', description: 'Meldet sich, wenn du wahrscheinlich nicht hinsiehst, auch mit Knöpfen zur Antwort.' },
          { name: 'limits', label: 'Limits abfragen', description: 'Liest die Limits deiner Accounts, etwa um vor einer langen Aufgabe zu prüfen.' },
        ],
      },
    ],
  },
]

/** Every tool of the catalog, in its order. */
export const NEXA_TOOLS: readonly NexaToolInfo[] = NEXA_TOOL_CATEGORIES.flatMap((category) => category.groups.flatMap((group) => group.tools))

const CATEGORY_OF = new Map(NEXA_TOOL_CATEGORIES.flatMap((category) => category.groups.flatMap((group) => group.tools.map((tool) => [tool.name, category] as const))))

/** The category of one of Nexa's tools; undefined for any other name. */
export function nexaToolCategory(name: string): NexaToolCategory | undefined {
  return CATEGORY_OF.get(name)
}

/** One of Nexa's tools in words; the name itself for one the catalog doesn't know (of a newer Nexa). */
export function nexaToolLabel(name: string): string {
  return NEXA_TOOLS.find((tool) => tool.name === name)?.label ?? name
}

/** Whether the switch of the tool's category is on; the app's tools have none. */
function categorySwitchOn(tools: ToolSettings, category: NexaToolCategory): boolean {
  return category.setting === null || tools[category.setting]
}

/** Whether the agents get one of Nexa's tools: its category is on and the tool isn't switched off on its own. */
export function nexaToolOn(tools: ToolSettings, name: string): boolean {
  const category = nexaToolCategory(name)
  return !!category && categorySwitchOn(tools, category) && !tools.disabled.includes(name)
}

/** Whether a category gives the agents anything: its switch is on and one of its tools too. */
export function nexaCategoryOn(tools: ToolSettings, id: NexaToolCategoryId): boolean {
  const category = NEXA_TOOL_CATEGORIES.find((c) => c.id === id)
  return !!category && categorySwitchOn(tools, category) && category.groups.some((group) => group.tools.some((tool) => !tools.disabled.includes(tool.name)))
}

/** `disabled` with the tools of `names` switched on or off; in the catalog's order, unknown names kept. */
export function withToolsSwitched(disabled: readonly string[], names: readonly string[], on: boolean): string[] {
  const next = new Set(disabled)
  for (const name of names) {
    if (on) next.delete(name)
    else next.add(name)
  }
  const known = NEXA_TOOLS.map((tool) => tool.name).filter((name) => next.has(name))
  return [...known, ...[...next].filter((name) => !nexaToolCategory(name))]
}
