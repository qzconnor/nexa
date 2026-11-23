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

/** A block of the timeline: one item, or tool calls in a row. */
export type ChatBlock = { type: 'item'; item: ChatItem } | { type: 'tools'; id: string; tools: ToolItem[] }

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
  for (const item of items) {
    if ((item.parentId ?? null) !== parentId) continue
    if (item.kind === 'tool') {
      if (item.tool === 'todo' || answeredTools.has(item.id)) continue
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
    if (item.kind !== 'thinking') group = null
    blocks.push({ type: 'item', item })
  }
  return blocks
}

/** "3 Befehle, 2 Dateien bearbeitet, 4 gelesen" for a group of tool calls. */
export function toolSummary(tools: readonly ToolItem[]): string {
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
