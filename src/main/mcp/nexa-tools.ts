import type { ToolSettings } from '@shared/types'
import type { BrowserTools } from '../browser/browser-tools'
import { BROWSER_INSTRUCTIONS, SENSITIVE_BROWSER_TOOLS } from '../browser/browser-tools'
import { ASK_INSTRUCTIONS, ASK_TOOL_DEF, isAskTool, type AskTool } from './ask-tool'
import { CHAT_INSTRUCTIONS, CHAT_TOOL_DEFS, CHAT_TOOL_NAMES, isChatTool, type ChatTools } from './chat-tools'
import { isLimitsTool, LIMITS_INSTRUCTIONS, LIMITS_TOOL_DEF, type LimitsTool } from './limits-tool'
import type { McpServerSpec } from './mcp-protocol'
import type { McpCaller } from './mcp-server'
import { RENDER_INSTRUCTIONS, RENDER_TOOL_DEFS, renderServerSpec } from './render-tools'
import { nexaToolGrant, type NexaToolGrant } from './tool-grant'

/** The grant of a CLI that starts now (see tool-grant.ts). */
export function grantFor(tools: ToolSettings, browser: BrowserTools | null): NexaToolGrant {
  return nexaToolGrant(
    tools,
    {
      render: RENDER_TOOL_DEFS.map((tool) => tool.name),
      browser: browser?.list().map((tool) => tool.name) ?? [],
      chat: CHAT_TOOL_NAMES,
      app: [LIMITS_TOOL_DEF.name, ASK_TOOL_DEF.name],
    },
    SENSITIVE_BROWSER_TOOLS,
  )
}

/**
 * What Nexa's MCP server offers one caller: the render tools, the browser of the caller's chat, the
 * other chats, the limits of the accounts and forms for the user (`ask_user`, for a chat's caller). It follows the settings of the moment; a tool switched
 * off since the CLI listed them says so when it is called.
 */
export function nexaServerSpec(
  caller: McpCaller,
  tools: ToolSettings,
  browser: BrowserTools | null,
  chats: ChatTools | null,
  limits: LimitsTool | null,
  ask: AskTool | null = null,
): McpServerSpec {
  const render = renderServerSpec()
  const browserOn = tools.browserTools && browser !== null && caller.sessionId !== null
  const chatsOn = tools.chatTools && chats !== null && caller.sessionId !== null
  const askOn = ask !== null && caller.sessionId !== null
  const browserList = browser?.list() ?? []
  const isBrowserTool = (name: string) => browserList.some((tool) => tool.name === name)
  const instructions = [
    tools.renderTools ? RENDER_INSTRUCTIONS : null,
    browserOn ? BROWSER_INSTRUCTIONS : null,
    chatsOn ? CHAT_INSTRUCTIONS : null,
    limits ? LIMITS_INSTRUCTIONS : null,
    askOn ? ASK_INSTRUCTIONS : null,
  ].filter(Boolean)
  return {
    name: render.name,
    version: render.version,
    instructions: instructions.length ? instructions.join('\n\n') : undefined,
    tools: [
      ...(tools.renderTools ? render.tools : []),
      ...(browserOn ? browserList : []),
      ...(chatsOn ? CHAT_TOOL_DEFS : []),
      ...(limits ? [LIMITS_TOOL_DEF] : []),
      ...(askOn ? [ASK_TOOL_DEF] : []),
    ],
    knowsTool: (name) => render.tools.some((tool) => tool.name === name) || isBrowserTool(name) || isChatTool(name) || isLimitsTool(name) || isAskTool(name),
    callTool: async (name, args, signal) => {
      if (isAskTool(name)) {
        if (!ask) throw new Error('Nexa cannot show forms right now.')
        return ask.call(caller.sessionId, args, signal)
      }
      if (isLimitsTool(name)) {
        if (!limits) throw new Error('Nexa cannot read the limits right now.')
        return limits.call(caller.sessionId, name)
      }
      if (isChatTool(name)) {
        if (!tools.chatTools) throw new Error("The user turned the messages between chats off in Nexa's settings.")
        if (!chats || caller.sessionId === null) throw new Error('This connection belongs to no chat of Nexa, so it reaches no other chats.')
        return chats.call(caller.sessionId, name, args)
      }
      if (!isBrowserTool(name)) return render.callTool(name, args)
      if (!tools.browserTools) throw new Error("The user turned the browser off in Nexa's settings.")
      if (!browser || caller.sessionId === null) throw new Error('This connection belongs to no chat of Nexa, so it has no browser.')
      return browser.call(caller.sessionId, name, args)
    },
  }
}
