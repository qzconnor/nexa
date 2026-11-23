import { ANSI_COLORS, type AnsiColor, type ThemeColorKey } from '@shared/themes/file'

/** What a color of a theme is for, as the editor explains it. */
export interface ColorInfo {
  key: ThemeColorKey
  label: string
  description: string
}

export interface ColorGroup {
  id: string
  title: string
  colors: ColorInfo[]
}

export interface ColorSection {
  id: 'app' | 'code'
  title: string
  description: string
  groups: ColorGroup[]
}

const ANSI_LABELS: Record<AnsiColor, string> = {
  black: 'Schwarz',
  red: 'Rot',
  green: 'Grün',
  yellow: 'Gelb',
  blue: 'Blau',
  magenta: 'Magenta',
  cyan: 'Cyan',
  white: 'Weiß',
}

/** Where Nexa uses the colors of the palette (see themes/apply.ts and lib/code-colors.ts). */
const CODE_USES: Partial<Record<AnsiColor, string>> = {
  red: 'Entfernte Zeilen in Diffs und Fehler in Ausgaben; in Code z. B. Tags und Variablen.',
  green: 'Hinzugefügte Zeilen in Diffs; Strings in Code. Diagramme im Verbrauchs-Dashboard.',
  yellow: 'Zahlen und Klassen in Code. Diagramme im Verbrauchs-Dashboard.',
  blue: 'Funktionen in Code. Diagramme im Verbrauchs-Dashboard.',
  magenta: 'Schlüsselwörter in Code. Diagramme im Verbrauchs-Dashboard.',
  cyan: 'Typen und eingebaute Namen in Code.',
}

/** The colors Nexa uses for code: the six of the palette above. */
const CODE_COLORS: AnsiColor[] = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan']

/** The rest of the palette: Nexa has no terminal, the file keeps them for Claude Manager. */
function terminalOnly(): ColorInfo[] {
  const normal = ANSI_COLORS.filter((color) => !CODE_COLORS.includes(color)).map((color) => ({
    key: `terminal.normal.${color}` as const,
    label: ANSI_LABELS[color],
    description: `ANSI ${ANSI_COLORS.indexOf(color)}. Nur im Terminal des Claude Managers.`,
  }))
  const bright = ANSI_COLORS.map((color, i) => ({
    key: `terminal.bright.${color}` as const,
    label: `Helles ${ANSI_LABELS[color]}`,
    description: `ANSI ${i + 8}. Nur im Terminal des Claude Managers.`,
  }))
  return [
    { key: 'terminal.cursor', label: 'Cursor', description: 'Die Schreibmarke im Terminal des Claude Managers.' },
    { key: 'terminal.cursorAccent', label: 'Text unter dem Cursor', description: 'Das Zeichen unter einem Block-Cursor im Claude Manager.' },
    { key: 'terminal.selectionBackground', label: 'Auswahl', description: 'Hinter markiertem Text im Terminal des Claude Managers.' },
    ...normal,
    ...bright,
  ]
}

/** Every color of a theme, grouped by what it colors in Nexa. */
export const COLOR_SECTIONS: ColorSection[] = [
  {
    id: 'app',
    title: 'App',
    description: 'Fenster, Sidebar, Chat, Menüs und Dialoge.',
    groups: [
      {
        id: 'app.base',
        title: 'Fenster und Text',
        colors: [
          {
            key: 'app.background',
            label: 'Hintergrund',
            description: 'Grundfarbe des Fensters, der Titelleiste und der Sidebar. Unter Windows liegt sie je nach Deckkraft über Acryl oder Mica.',
          },
          {
            key: 'app.foreground',
            label: 'Text',
            description: 'Schrift und Symbole. Rahmen, Trennlinien und Hover-Flächen werden daraus gemischt.',
          },
          {
            key: 'app.mutedForeground',
            label: 'Gedämpfter Text',
            description: 'Beschreibungen, Platzhalter, Zeitangaben, Werkzeug-Details und die Fußzeile unter Antworten.',
          },
        ],
      },
      {
        id: 'app.surfaces',
        title: 'Flächen',
        colors: [
          {
            key: 'app.surface',
            label: 'Inhalt und Karten',
            description: 'Das Panel mit dem Chat, Karten, die Eingabe und Rückfragen. Durchscheinend, solange das Fenstermaterial an ist.',
          },
          {
            key: 'app.popover',
            label: 'Menüs und Dialoge',
            description: 'Deckende Fläche von Menüs, Tooltips, Dialogen und den Einstellungen.',
          },
        ],
      },
      {
        id: 'app.accent',
        title: 'Akzent',
        colors: [
          {
            key: 'app.primary',
            label: 'Akzent',
            description: 'Senden-Knopf, Auswahl, Fokusrahmen, offene Rückfragen, Schalter und Schieberegler.',
          },
          {
            key: 'app.primaryForeground',
            label: 'Text auf Akzent',
            description: 'Schrift und Symbole auf akzentfarbenen Knöpfen und Markierungen.',
          },
        ],
      },
      {
        id: 'app.status',
        title: 'Status',
        colors: [
          {
            key: 'app.destructive',
            label: 'Fehler',
            description: 'Löschen-Knöpfe, Fehlermeldungen, fehlgeschlagene Werkzeuge und Limits ab 85 %.',
          },
          {
            key: 'app.success',
            label: 'Erfolg',
            description: 'Bestätigungen, laufende Chats in der Sidebar und Limits unter 60 %.',
          },
          {
            key: 'app.warning',
            label: 'Warnung',
            description: 'Hinweise und Chats, die auf dich warten. Mit Rot gemischt: Limits ab 60 %.',
          },
        ],
      },
    ],
  },
  {
    id: 'code',
    title: 'Code',
    description: 'Codeblöcke, Diffs, Befehle und Ausgaben im Chat.',
    groups: [
      {
        id: 'code.base',
        title: 'Grundfarben',
        colors: [
          {
            key: 'terminal.background',
            label: 'Hintergrund',
            description: 'Hinter Codeblöcken, Diffs, Befehlen und ihren Ausgaben.',
          },
          {
            key: 'terminal.foreground',
            label: 'Text',
            description: 'Normaler Code und Ausgaben. Kommentare sind dieselbe Farbe, halb durchsichtig.',
          },
        ],
      },
      {
        id: 'code.syntax',
        title: 'Syntax und Diffs',
        colors: CODE_COLORS.map((color) => ({
          key: `terminal.normal.${color}` as const,
          label: ANSI_LABELS[color],
          description: CODE_USES[color] ?? '',
        })),
      },
      { id: 'code.terminal', title: 'Nur für den Claude Manager', colors: terminalOnly() },
    ],
  },
]
