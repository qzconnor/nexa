import type { PermissionMode } from '@shared/chat'
import { nexaCategoryOn } from '@shared/nexa-tools'
import { RENDER_SERVER } from '@shared/render'
import type { ToolSettings } from '@shared/types'

/**
 * What a CLI may do with the tools of Nexa's server, decided when it starts: `allowed` it uses
 * without asking, `ask` only after the user agreed (Nexa's permission prompt). Names without the
 * server's prefix. Apart from the tools themselves (they need Electron), so it can be tested.
 */
export interface NexaToolGrant {
  allowed: string[]
  ask: string[]
}

/**
 * Whether a CLI gets Nexa's MCP server at all: while a tool of the render, browser or chat tools is
 * on. The app's own tools (`limits`, `ask_user`, `notify`) come with it, but don't start it alone.
 */
export function nexaToolsOn(tools: ToolSettings): boolean {
  return nexaCategoryOn(tools, 'render') || nexaCategoryOn(tools, 'browser') || nexaCategoryOn(tools, 'chat')
}

/**
 * The render tools, the browser's and the chat tools are used without asking (the user switched the
 * chat tools on for this, and each chat keeps its own permissions); the browser tools that reach
 * beyond the page (`sensitive`: uploads, cookies and storage, request contents, scripts, deleting
 * site data) ask first. `app`: the tools that come with the server whenever it is there (`limits`,
 * read-only), also without asking. Tools the user switched off one by one (`disabled`) are in neither.
 */
export function nexaToolGrant(
  tools: ToolSettings,
  names: { render: readonly string[]; browser: readonly string[]; chat?: readonly string[]; app?: readonly string[] },
  sensitive: ReadonlySet<string>,
): NexaToolGrant {
  const on = (name: string) => !tools.disabled.includes(name)
  const render = tools.renderTools ? names.render.filter(on) : []
  const browser = tools.browserTools ? names.browser.filter(on) : []
  const chat = tools.chatTools ? (names.chat ?? []).filter(on) : []
  const app = nexaToolsOn(tools) ? (names.app ?? []).filter(on) : []
  return {
    allowed: [...render, ...browser.filter((name) => !sensitive.has(name)), ...chat, ...app],
    ask: browser.filter((name) => sensitive.has(name)),
  }
}

/** Claude Code's names of the tools (`mcp__nexa__render_chart`), for `--allowedTools`. */
export function claudeToolNames(names: readonly string[]): string[] {
  return names.map((name) => `mcp__${RENDER_SERVER}__${name}`)
}

/**
 * Codex's approval of each tool, for the thread's config (`mcp_servers.nexa.tools.<tool>.approval_mode`):
 * the allowed ones run without asking, the others ask; with full permissions Codex asks for nothing.
 */
export function codexToolApprovals(grant: NexaToolGrant, mode: PermissionMode): Record<string, { approval_mode: 'approve' | 'prompt' }> {
  const approvals: Record<string, { approval_mode: 'approve' | 'prompt' }> = {}
  for (const name of grant.allowed) approvals[name] = { approval_mode: 'approve' }
  if (mode !== 'full') for (const name of grant.ask) approvals[name] = { approval_mode: 'prompt' }
  return approvals
}
