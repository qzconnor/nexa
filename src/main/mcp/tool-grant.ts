import type { PermissionMode } from '@shared/chat'
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

/** Whether a CLI gets Nexa's MCP server at all. */
export function nexaToolsOn(tools: ToolSettings): boolean {
  return tools.renderTools || tools.browserTools
}

/**
 * The render tools and the browser's are used without asking; the browser tools that reach beyond
 * the page (`sensitive`: uploads, cookies and storage, request contents, scripts, deleting site
 * data) ask first.
 */
export function nexaToolGrant(
  tools: ToolSettings,
  names: { render: readonly string[]; browser: readonly string[] },
  sensitive: ReadonlySet<string>,
): NexaToolGrant {
  const render = tools.renderTools ? names.render : []
  const browser = tools.browserTools ? names.browser : []
  return {
    allowed: [...render, ...browser.filter((name) => !sensitive.has(name))],
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
