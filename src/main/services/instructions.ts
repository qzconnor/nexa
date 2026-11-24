import type { ChatItem, ProviderId, ToolItem } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import { firstLine } from '@shared/utils'

/**
 * What Nexa adds to the system prompt of every session (Claude: --append-system-prompt, Codex:
 * developerInstructions). Kept short and stable: Claude Code records it once per conversation.
 */
export function sessionInstructions(options: { renderTools: boolean; browserTools: boolean; projectName: string }): string {
  const lines = [
    '# Nexa',
    'You are running inside Nexa, a desktop app that shows this conversation as a chat UI instead of a terminal.',
    '- Markdown is rendered (headings, lists, tables, code blocks with syntax highlighting). Keep answers well structured.',
    '- Tool calls, file diffs, permission prompts and your todo list are rendered by Nexa itself; do not repeat diffs as text.',
    '- Ask the user with your question tool (AskUserQuestion / request_user_input) when a decision is theirs: Nexa shows it as clickable options.',
    `- The project is "${options.projectName}". Answer in the language the user writes in.`,
  ]
  if (options.renderTools) {
    lines.push(
      '- The MCP server `nexa` draws inline visuals in the chat: render_chart, render_diagram (Mermaid), render_table, render_stats, render_callout.',
      '  Use them when a visual explains better than prose: architecture and flows as diagrams, numbers as charts, comparisons as tables. Do not overuse them for trivial answers.',
    )
  }
  if (options.browserTools) {
    lines.push(
      '- Nexa shows a browser beside this chat that the user watches; the `nexa` MCP server drives it with its browser_* tools. Prefer it over other browser tools.',
      '  Use it to open and test web apps and dev servers (e.g. http://localhost:5173), to check UI changes you made, to read web pages and to fill in forms.',
      '  Start with browser_navigate or browser_snapshot: elements you can act on carry refs like [ref=e12] for browser_click, browser_type and the others; after an action you get only what changed (a diff). Take a screenshot when the look matters.',
      '  The user can take the browser over at any time. Do not enter passwords or payment details unless asked. When done, close the tabs you opened (browser_tabs close) unless the user wants to see them.',
    )
  }
  return lines.join('\n')
}

const MAX_HANDOFF = 14_000
/** Output of one `!` command the CLI gets: its end, where errors and summaries are. */
const MAX_SHELL_OUTPUT = 8_000
/** All `!` commands before one prompt: the latest win. */
const MAX_SHELL_CONTEXT = 24_000

/**
 * The commands the user ran with `!` since their last prompt, for the CLI with the next one: so it
 * knows what the user saw, as in Claude Code's bash mode. Their secrets are masked already.
 */
export function userShellContext(items: readonly ToolItem[]): string | null {
  const parts: string[] = []
  for (const item of items) {
    let output = (item.output ?? '').trimEnd()
    if (output.length > MAX_SHELL_OUTPUT) output = `…\n${output.slice(output.length - MAX_SHELL_OUTPUT)}`
    const end =
      item.status === 'running'
        ? '[still running]'
        : item.status === 'denied'
          ? '[stopped by the user]'
          : item.exitCode != null
            ? `[exit code ${item.exitCode}]`
            : `[${item.status}]`
    parts.push([`$ ${item.detail ?? ''}`, output, end].filter(Boolean).join('\n'))
  }
  if (parts.length === 0) return null
  let text = parts.join('\n\n')
  if (text.length > MAX_SHELL_CONTEXT) text = `…\n${text.slice(text.length - MAX_SHELL_CONTEXT)}`
  return [
    '<nexa-shell>',
    "The user ran these commands themselves in this chat's working directory (Nexa's shell mode) since their last message. You did not run them; Nexa replaced secrets in commands and output with ••••.",
    '',
    text,
    '</nexa-shell>',
  ].join('\n')
}

/**
 * The part of the chat a CLI hasn't seen, as context for it: when a session moves from Claude Code to
 * Codex (or back), the other CLI gets what happened meanwhile with the next prompt.
 */
export function handoffContext(items: ChatItem[], to: ProviderId): string | null {
  const parts: string[] = []
  for (const item of items) {
    if (item.parentId) continue
    switch (item.kind) {
      case 'user':
        if (!item.handoff) parts.push(`User: ${item.text}`)
        break
      case 'assistant':
        if (item.text.trim()) parts.push(`${PROVIDERS[item.provider].short}: ${item.text.trim()}`)
        break
      case 'tool':
        if (item.tool === 'render' || item.tool === 'question' || item.tool === 'todo') break
        if (item.byUser) {
          parts.push(`[User ran in the shell: ${firstLine(item.detail ?? '', 160)} → ${item.exitCode != null ? `exit code ${item.exitCode}` : item.status}]`)
          break
        }
        parts.push(`[${PROVIDERS[item.provider].short} tool ${item.name}${item.detail ? `: ${firstLine(item.detail, 160)}` : ''} → ${item.status}]`)
        break
      case 'agent':
        parts.push(`[Subagent "${item.description}" → ${item.status}${item.result ? `: ${firstLine(item.result, 300)}` : ''}]`)
        break
      case 'todo':
        parts.push(`[Todo list: ${item.entries.map((e) => `${e.status === 'completed' ? '✓' : e.status === 'in_progress' ? '…' : '○'} ${e.text}`).join('; ')}]`)
        break
    }
  }
  if (parts.length === 0) return null
  let text = parts.join('\n\n')
  if (text.length > MAX_HANDOFF) text = `…\n${text.slice(text.length - MAX_HANDOFF)}`
  return [
    '<nexa-context>',
    `This conversation was continued in Nexa with another coding agent before you (now: ${PROVIDERS[to].name}).`,
    'This is what happened since you last took part; files it changed are already on disk. Continue from here.',
    '',
    text,
    '</nexa-context>',
  ].join('\n')
}
