import {
  BotIcon,
  ChartColumnIcon,
  CircleHelpIcon,
  FilePenIcon,
  FilePlusIcon,
  FileTextIcon,
  GlobeIcon,
  ImageIcon,
  ListChecksIcon,
  MapIcon,
  PlugIcon,
  SearchIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from '@lucide/vue'
import type { Component } from 'vue'
import type { ChatItem, ToolItem, ToolKind } from '@shared/chat'
import { isRenderTool, RENDER_SERVER, type RenderToolName } from '@shared/render'

/** Icon and colour per kind of tool, as Claude Manager's file tree colours what Claude does. */
export const TOOL_META: Record<ToolKind, { icon: Component; color: string }> = {
  bash: { icon: SquareTerminalIcon, color: 'text-(--tool-run)' },
  read: { icon: FileTextIcon, color: 'text-(--tool-read)' },
  edit: { icon: FilePenIcon, color: 'text-(--tool-write)' },
  write: { icon: FilePlusIcon, color: 'text-(--tool-write)' },
  search: { icon: SearchIcon, color: 'text-(--tool-search)' },
  web: { icon: GlobeIcon, color: 'text-(--tool-search)' },
  mcp: { icon: PlugIcon, color: 'text-muted-foreground' },
  todo: { icon: ListChecksIcon, color: 'text-muted-foreground' },
  plan: { icon: MapIcon, color: 'text-primary' },
  question: { icon: CircleHelpIcon, color: 'text-primary' },
  render: { icon: ChartColumnIcon, color: 'text-primary' },
  image: { icon: ImageIcon, color: 'text-muted-foreground' },
  other: { icon: WrenchIcon, color: 'text-muted-foreground' },
}

export const AGENT_ICON = BotIcon

/** A block of the timeline: one item, tool calls in a row, or what an agent did in the browser in a row. */
export type ChatBlock = { type: 'item'; item: ChatItem } | { type: 'tools'; id: string; tools: ToolItem[] } | { type: 'browser'; id: string; tools: ToolItem[] }

/**
 * The action of one of the browser tools of Nexa's MCP server (`navigate` for `browser_navigate`), as
 * Claude (`mcp__nexa__browser_…`) or Codex (`nexa.browser_…`) names it; null for other tools.
 */
export function browserAction(tool: ToolItem): string | null {
  if (tool.server !== 'nexa') return null
  return /(?:^|__|\.)browser_([a-z_]+)$/.exec(tool.name)?.[1] ?? null
}

const BROWSER_STEPS: Record<string, string> = {
  navigate: 'Seite öffnen',
  history: 'Vor oder zurück',
  tabs: 'Tabs',
  snapshot: 'Seite lesen',
  take_screenshot: 'Screenshot',
  find: 'Auf der Seite suchen',
  click: 'Klicken',
  type: 'Eintippen',
  fill_form: 'Formular ausfüllen',
  press_key: 'Taste drücken',
  hover: 'Zeigen',
  select_option: 'Auswählen',
  scroll: 'Scrollen',
  drag: 'Ziehen',
  file_upload: 'Datei hochladen',
  handle_dialog: 'Dialog beantworten',
  wait_for: 'Warten',
  evaluate: 'Skript ausführen',
  resize: 'Größe ändern',
  emulate: 'Umgebung nachstellen',
  inspect: 'Element prüfen',
  check_accessibility: 'Barrierefreiheit prüfen',
  console_messages: 'Konsole lesen',
  network_requests: 'Netzwerk lesen',
  network_request: 'Anfrage lesen',
  performance: 'Leistung messen',
  storage: 'Speicher der Seite',
  route: 'Anfragen umleiten',
  clear_site_data: 'Daten der Seite löschen',
  pdf_save: 'Als PDF speichern',
  generate_test: 'Test erzeugen',
}

/** What Nexa's drawing tools make, in words. */
const RENDER_NAMES: Record<RenderToolName, string> = {
  render_chart: 'Chart',
  render_diagram: 'Diagramm',
  render_table: 'Tabelle',
  render_stats: 'Kennzahlen',
  render_callout: 'Hinweis',
  render_code: 'Code',
}

/** One of Nexa's tools in words (`render_chart` → „Chart“, `browser_click` → „Klicken“). */
function nexaToolName(short: string): string {
  if (isRenderTool(short)) return RENDER_NAMES[short]
  const action = /^browser_(.+)$/.exec(short)?.[1]
  return (action && BROWSER_STEPS[action]) || short.replace(/_/g, ' ')
}

/** The tools of Nexa a ToolSearch of Claude Code loads by name (`select:mcp__nexa__render_chart,…`); null when it loads others too or searches. */
function nexaToolsLoaded(tool: ToolItem): string[] | null {
  if (tool.name !== 'ToolSearch') return null
  const query = (tool.input as { query?: unknown } | undefined)?.query
  if (typeof query !== 'string' || !query.startsWith('select:')) return null
  const prefix = `mcp__${RENDER_SERVER}__`
  const names = query.slice('select:'.length).split(',').map((name) => name.trim()).filter(Boolean)
  return names.length && names.every((name) => name.startsWith(prefix)) ? names.map((name) => name.slice(prefix.length)) : null
}

/**
 * A call of one of Nexa's own tools, or Claude loading them: they are the app itself, not a server the
 * user added, so they show with Nexa's mark and in words. `plumbing`: only the CLI getting the tools
 * ready, with nothing in it worth opening. Null for every other tool.
 */
export function nexaToolView(tool: ToolItem): { title: string; detail?: string; plumbing: boolean } | null {
  const loaded = nexaToolsLoaded(tool)
  if (loaded) return { title: 'Nexa-Werkzeuge laden', detail: [...new Set(loaded.map(nexaToolName))].join(', '), plumbing: true }
  if (tool.server !== RENDER_SERVER) return null
  // Claude names them `mcp__nexa__render_chart`, Codex `nexa.render_chart`.
  const prefix = [`mcp__${RENDER_SERVER}__`, `${RENDER_SERVER}.`].find((p) => tool.name.startsWith(p)) ?? ''
  return { title: nexaToolName(tool.name.slice(prefix.length)), detail: tool.detail, plumbing: false }
}

/** Claude Code's ToolSearch for one of the browser tools (it loads them when it needs them). */
function loadsBrowserTool(tool: ToolItem): boolean {
  if (tool.name !== 'ToolSearch') return false
  const query = (tool.input as { query?: unknown } | undefined)?.query
  return typeof query === 'string' && /browser_/.test(query)
}

/** A browser tool call as a step of the browser card: what it does, and to what. */
export function browserStep(tool: ToolItem): { title: string; detail?: string } {
  const action = browserAction(tool) ?? ''
  const input = (tool.input ?? {}) as Record<string, unknown>
  const text = (key: string) => (typeof input[key] === 'string' && input[key] ? (input[key] as string) : undefined)
  const detail = text('url') ?? text('element') ?? text('key') ?? text('text') ?? text('selector') ?? text('ref')
  return { title: BROWSER_STEPS[action] ?? action.replace(/_/g, ' '), detail }
}

/**
 * The items of one thread (the main one or a subagent's) as blocks: tool calls in a row form a
 * group; drawings of Nexa's tools, todo lists and the tool calls behind a question stand alone or
 * are left out, as their own items show them.
 */
export function chatBlocks(items: readonly ChatItem[], parentId: string | null, showThinking: boolean): ChatBlock[] {
  // A tool call a question is about: the question shows it while it is open; questions and plans for good.
  const answeredTools = new Set<string>()
  for (const item of items) {
    if (item.kind !== 'interaction' || !item.toolItemId) continue
    if (item.state === 'pending' || item.request.type === 'question' || item.request.type === 'plan') answeredTools.add(item.toolItemId)
  }
  const blocks: ChatBlock[] = []
  let group: ToolItem[] | null = null
  // The browser's steps in a row: one card with the page, not a row each.
  let browser: ToolItem[] | null = null
  for (const item of items) {
    if ((item.parentId ?? null) !== parentId) continue
    if (item.kind === 'tool') {
      if (item.tool === 'todo' || answeredTools.has(item.id)) continue
      if (browserAction(item)) {
        group = null
        if (!browser) {
          browser = []
          blocks.push({ type: 'browser', id: `browser:${item.id}`, tools: browser })
        }
        browser.push(item)
        continue
      }
      // Claude loading the next browser tool doesn't end the agent's work in the page.
      if (browser && loadsBrowserTool(item)) {
        browser.push(item)
        continue
      }
      browser = null
      if (item.render) {
        group = null
        blocks.push({ type: 'item', item })
        continue
      }
      if (!group) {
        group = []
        blocks.push({ type: 'tools', id: `tools:${item.id}`, tools: group })
      }
      group.push(item)
      continue
    }
    if (item.kind === 'thinking' && (!showThinking || !item.text.trim())) continue
    if (item.kind === 'assistant' && !item.text.trim() && !item.streaming) continue
    // Thinking between tool calls doesn't break their group.
    if (item.kind !== 'thinking') {
      group = null
      browser = null
    }
    blocks.push({ type: 'item', item })
  }
  return blocks
}

/** "3 Befehle, 2 Dateien bearbeitet, 4 gelesen" for a group of tool calls; Claude loading Nexa's tools isn't one of them. */
export function toolSummary(all: readonly ToolItem[]): string {
  const tools = all.filter((t) => !nexaToolView(t)?.plumbing)
  const count = (kinds: ToolKind[]) => tools.filter((t) => kinds.includes(t.tool)).length
  const parts: string[] = []
  const edits = new Set(tools.filter((t) => t.tool === 'edit' || t.tool === 'write').flatMap((t) => t.changes?.map((c) => c.path) ?? [t.detail ?? t.id]))
  const commands = count(['bash'])
  const reads = count(['read'])
  const searches = count(['search', 'web'])
  const other = tools.length - commands - reads - searches - count(['edit', 'write'])
  if (edits.size) parts.push(edits.size === 1 ? '1 Datei bearbeitet' : `${edits.size} Dateien bearbeitet`)
  if (commands) parts.push(commands === 1 ? '1 Befehl' : `${commands} Befehle`)
  if (reads) parts.push(reads === 1 ? '1 Datei gelesen' : `${reads} Dateien gelesen`)
  if (searches) parts.push(searches === 1 ? '1 Suche' : `${searches} Suchen`)
  if (other > 0) parts.push(other === 1 ? '1 Werkzeug' : `${other} Werkzeuge`)
  return parts.join(' · ')
}

/** `nexa-file://` URL of an image on disk (main/window/file-protocol.ts). */
export function fileImageUrl(path: string): string {
  return `nexa-file://image?path=${encodeURIComponent(path)}`
}
