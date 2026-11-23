import type { ToolSettings } from '@shared/types'
import type { BrowserTools } from '../browser/browser-tools'
import { BROWSER_INSTRUCTIONS, SENSITIVE_BROWSER_TOOLS } from '../browser/browser-tools'
import type { McpServerSpec } from './mcp-protocol'
import type { McpCaller } from './mcp-server'
import { RENDER_INSTRUCTIONS, RENDER_TOOL_DEFS, renderServerSpec } from './render-tools'
import { nexaToolGrant, type NexaToolGrant } from './tool-grant'

/** The grant of a CLI that starts now (see tool-grant.ts). */
export function grantFor(tools: ToolSettings, browser: BrowserTools | null): NexaToolGrant {
  return nexaToolGrant(
    tools,
    { render: RENDER_TOOL_DEFS.map((tool) => tool.name), browser: browser?.list().map((tool) => tool.name) ?? [] },
    SENSITIVE_BROWSER_TOOLS,
  )
}

/**
 * What Nexa's MCP server offers one caller: the render tools, and the browser of the caller's chat.
 * It follows the settings of the moment; a tool switched off since the CLI listed them says so when
 * it is called.
 */
export function nexaServerSpec(caller: McpCaller, tools: ToolSettings, browser: BrowserTools | null): McpServerSpec {
  const render = renderServerSpec()
  const browserOn = tools.browserTools && browser !== null && caller.sessionId !== null
  const browserList = browser?.list() ?? []
  const isBrowserTool = (name: string) => browserList.some((tool) => tool.name === name)
  const instructions = [tools.renderTools ? RENDER_INSTRUCTIONS : null, browserOn ? BROWSER_INSTRUCTIONS : null].filter(Boolean)
  return {
    name: render.name,
    version: render.version,
    instructions: instructions.length ? instructions.join('\n\n') : undefined,
    tools: [...(tools.renderTools ? render.tools : []), ...(browserOn ? browserList : [])],
    knowsTool: (name) => render.tools.some((tool) => tool.name === name) || isBrowserTool(name),
    callTool: async (name, args) => {
      if (!isBrowserTool(name)) return render.callTool(name, args)
      if (!tools.browserTools) throw new Error("The user turned the browser off in Nexa's settings.")
      if (!browser || caller.sessionId === null) throw new Error('This connection belongs to no chat of Nexa, so it has no browser.')
      return browser.call(caller.sessionId, name, args)
    },
  }
}
