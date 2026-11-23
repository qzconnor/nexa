import type { AgentItem, ChatItem, ProviderId, ToolItem } from './chat'
import { PROVIDERS } from './providers'

/** What the head of the export says about the chat. */
export interface ChatMarkdownInfo {
  title: string
  /** The folder its agent works in. */
  cwd?: string
  branch?: string | null
  model?: string
  createdAt: number
  updatedAt: number
  /** The CLIs' own ids of the conversation (Claude Code's session, Codex's thread). */
  cli?: Partial<Record<ProviderId, string>>
}

export interface ChatMarkdownOptions {
  /** For the times; the system's own without one. */
  timeZone?: string
}

/** A fence around `text` longer than any run of backticks in it, so nothing in it ends the block. */
export function fenced(text: string, language = ''): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${language}\n${text.replace(/\n+$/, '')}\n${fence}`
}

/** `text` as code within a line: on one line, with enough backticks around it. */
export function inlineCode(text: string): string {
  const line = text.replace(/\s*\n\s*/g, ' ').trim()
  const longest = Math.max(0, ...[...line.matchAll(/`+/g)].map((m) => m[0].length))
  const ticks = '`'.repeat(longest + 1)
  const pad = longest > 0 || line.startsWith('`') || line.endsWith('`') ? ' ' : ''
  return `${ticks}${pad}${line}${pad}${ticks}`
}

/** One line of text that Markdown shows as it is (a title, a model's name). */
function plain(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/([\\`*_[\]<>#|])/g, '\\$1')
    .trim()
}

/** A file name for the export: the title without what Windows doesn't take in a name (also not a device's). */
export function markdownFileName(title: string): string {
  const name = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  if (!name || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i.test(name)) return 'Chat.md'
  return `${name}.md`
}

function toolLine(tool: ToolItem): string {
  const parts = [`**${plain(tool.title || tool.name)}**`]
  if (tool.detail) parts.push(inlineCode(tool.detail))
  if (tool.status === 'error') parts.push('(Fehler)')
  else if (tool.status === 'denied') parts.push('(abgelehnt)')
  return `- ${parts.join(' ')}`
}

function agentLine(agent: AgentItem): string {
  const parts = [`**Agent ${plain(agent.agentType)}**`]
  if (agent.description) parts.push(`– ${plain(agent.description)}`)
  if (agent.status === 'error') parts.push('(Fehler)')
  return `- ${parts.join(' ')}`
}

/**
 * The last answer of the main thread: what the agent said last, without its subagents' words. Null
 * while it hasn't said anything.
 */
export function lastAnswer(items: readonly ChatItem[]): string | null {
  const answer = items.findLast((i) => i.kind === 'assistant' && !i.parentId && i.text.trim())
  return answer?.kind === 'assistant' ? answer.text.trim() : null
}

/**
 * A chat as a Markdown document: what it is about first (folder, branch, model, when), then the
 * messages by day, each author's turn under a heading of its own. The agent's tools and subagents are
 * a list under its words; its thoughts, questions and its subagents' own work stay out.
 */
export function chatMarkdown(info: ChatMarkdownInfo, items: readonly ChatItem[], options: ChatMarkdownOptions = {}): string {
  const { timeZone } = options
  const dateTime = new Intl.DateTimeFormat('de', { dateStyle: 'medium', timeStyle: 'short', timeZone })
  const dayFormat = new Intl.DateTimeFormat('de', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone })
  const timeFormat = new Intl.DateTimeFormat('de', { hour: '2-digit', minute: '2-digit', timeZone })

  const blocks: string[] = [`# ${plain(info.title) || 'Chat'}`]
  const facts: string[] = []
  if (info.cwd) facts.push(`- **Ordner:** ${inlineCode(info.cwd)}`)
  if (info.branch) facts.push(`- **Branch:** ${inlineCode(info.branch)}`)
  if (info.model) facts.push(`- **Modell:** ${plain(info.model)}`)
  facts.push(`- **Begonnen:** ${dateTime.format(info.createdAt)}`)
  facts.push(`- **Zuletzt aktiv:** ${dateTime.format(info.updatedAt)}`)
  for (const [provider, id] of Object.entries(info.cli ?? {}) as [ProviderId, string][]) {
    facts.push(`- **${PROVIDERS[provider].name}:** ${inlineCode(id)}`)
  }
  blocks.push(facts.join('\n'))

  let day = ''
  /** Who wrote before: the next words by the same author go on under the same heading. */
  let author: string | null = null
  /** The agent's tools since its last words, listed together. */
  let tools: string[] = []
  const flush = () => {
    if (tools.length) blocks.push(tools.join('\n'))
    tools = []
  }
  const heading = (who: string, ts: number) => {
    const label = dayFormat.format(ts)
    if (label !== day) {
      flush()
      day = label
      author = null
      blocks.push(`## ${label}`)
    }
    if (author === who) return
    flush()
    author = who
    blocks.push(`### ${who} · ${timeFormat.format(ts)}`)
  }

  for (const item of items) {
    if (item.parentId) continue
    switch (item.kind) {
      case 'user': {
        // The context Nexa sent along when the chat went to the other CLI isn't the user's.
        if (item.handoff) break
        heading('Du', item.ts)
        const images = item.images?.length ? `\n\n*${item.images.length === 1 ? 'Ein Bild' : `${item.images.length} Bilder`} angehängt*` : ''
        blocks.push(`${item.text.trim()}${images}`)
        break
      }
      case 'assistant':
        if (!item.text.trim()) break
        heading(PROVIDERS[item.provider].short, item.ts)
        flush()
        blocks.push(item.text.trim())
        break
      case 'tool':
        heading(PROVIDERS[item.provider].short, item.ts)
        tools.push(toolLine(item))
        break
      case 'agent':
        heading(PROVIDERS[item.provider].short, item.ts)
        tools.push(agentLine(item))
        break
      case 'notice':
        flush()
        author = null
        if (item.compaction) blocks.push('---', `*${plain([item.text, item.detail].filter(Boolean).join(' · '))}*`)
        else if (item.level !== 'info') blocks.push(`> **${plain(item.text)}**${item.detail ? ` ${plain(item.detail)}` : ''}`)
        else blocks.push(`*${plain([item.text, item.detail].filter(Boolean).join(' · '))}*`)
        break
      default:
        break
    }
  }
  flush()
  return `${blocks.filter((block) => block.trim()).join('\n\n')}\n`
}
