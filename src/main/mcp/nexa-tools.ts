import { nexaCategoryOn, nexaToolCategory, nexaToolOn } from '@shared/nexa-tools'
import type { ToolSettings } from '@shared/types'
import type { BrowserTools } from '../browser/browser-tools'
import { BROWSER_INSTRUCTIONS, SENSITIVE_BROWSER_TOOLS } from '../browser/browser-tools'
import { ASK_INSTRUCTIONS, ASK_TOOL_DEF, isAskTool, type AskTool } from './ask-tool'
import { CHAT_INSTRUCTIONS, CHAT_TOOL_DEFS, CHAT_TOOL_NAMES, isChatTool, type ChatTools } from './chat-tools'
import { isLimitsTool, LIMITS_INSTRUCTIONS, LIMITS_TOOL_DEF, type LimitsTool } from './limits-tool'
import { isNotifyTool, NOTIFY_INSTRUCTIONS, NOTIFY_TOOL_DEF, type NotifyTool } from './notify-tool'
import type { McpServerSpec, McpTool } from './mcp-protocol'
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
      app: [LIMITS_TOOL_DEF.name, ASK_TOOL_DEF.name, NOTIFY_TOOL_DEF.name],
    },
    SENSITIVE_BROWSER_TOOLS,
  )
}

/** Why a tool switched off since the CLI listed it doesn't run, for the agent. */
function offMessage(tools: ToolSettings, name: string): string {
  const category = nexaToolCategory(name)
  if (category?.id === 'chat' && !tools.chatTools) return "The user turned the messages between chats off in Nexa's settings."
  if (category?.id === 'browser' && !tools.browserTools) return "The user turned the browser off in Nexa's settings."
  if (category?.id === 'render' && !tools.renderTools) return "The user turned the tools that draw in the chat off in Nexa's settings."
  return `The user turned ${name} off in Nexa's settings.`
}

/**
 * The tools the user switched off one by one in categories that are on: the instructions name tools,
 * so the agent learns that these aren't there instead of looking for them.
 */
function switchedOff(tools: ToolSettings, offered: readonly McpTool[], all: readonly McpTool[]): string | null {
  const names = new Set(offered.map((tool) => tool.name))
  const off = all.filter((tool) => !names.has(tool.name) && tools.disabled.includes(tool.name)).map((tool) => tool.name)
  return off.length ? `The user turned these tools of Nexa off in its settings; they are not available: ${off.join(', ')}.` : null
}

/**
 * What Nexa's MCP server offers one caller: the render tools, the browser of the caller's chat, the
 * other chats, the limits of the accounts, forms for the user (`ask_user`) and notifications (`notify`),
 * both for a chat's caller; each only while it is on (shared/nexa-tools.ts). It follows the settings of
 * the moment; a tool switched off since the CLI listed them says so when it is called.
 */
export function nexaServerSpec(
  caller: McpCaller,
  tools: ToolSettings,
  browser: BrowserTools | null,
  chats: ChatTools | null,
  limits: LimitsTool | null,
  ask: AskTool | null = null,
  notify: NotifyTool | null = null,
): McpServerSpec {
  const render = renderServerSpec()
  const on = (tool: McpTool) => nexaToolOn(tools, tool.name)
  const browserOn = nexaCategoryOn(tools, 'browser') && browser !== null && caller.sessionId !== null
  const chatsOn = nexaCategoryOn(tools, 'chat') && chats !== null && caller.sessionId !== null
  const limitsOn = limits !== null && nexaToolOn(tools, LIMITS_TOOL_DEF.name)
  const askOn = ask !== null && caller.sessionId !== null && nexaToolOn(tools, ASK_TOOL_DEF.name)
  const notifyOn = notify !== null && caller.sessionId !== null && nexaToolOn(tools, NOTIFY_TOOL_DEF.name)
  const browserList = browser?.list() ?? []
  const isBrowserTool = (name: string) => browserList.some((tool) => tool.name === name)
  const offered: McpTool[] = [
    ...render.tools.filter(on),
    ...(browserOn ? browserList.filter(on) : []),
    ...(chatsOn ? CHAT_TOOL_DEFS.filter(on) : []),
    ...(limitsOn ? [LIMITS_TOOL_DEF] : []),
    ...(askOn ? [ASK_TOOL_DEF] : []),
    ...(notifyOn ? [NOTIFY_TOOL_DEF] : []),
  ]
  const instructions = [
    nexaCategoryOn(tools, 'render') ? RENDER_INSTRUCTIONS : null,
    browserOn ? BROWSER_INSTRUCTIONS : null,
    chatsOn ? CHAT_INSTRUCTIONS : null,
    limitsOn ? LIMITS_INSTRUCTIONS : null,
    askOn ? ASK_INSTRUCTIONS : null,
    notifyOn ? NOTIFY_INSTRUCTIONS : null,
    switchedOff(tools, offered, [
      ...(nexaCategoryOn(tools, 'render') ? render.tools : []),
      ...(browserOn ? browserList : []),
      ...(chatsOn ? CHAT_TOOL_DEFS : []),
    ]),
  ].filter(Boolean)
  return {
    name: render.name,
    version: render.version,
    instructions: instructions.length ? instructions.join('\n\n') : undefined,
    tools: offered,
    knowsTool: (name) => render.tools.some((tool) => tool.name === name) || isBrowserTool(name) || isChatTool(name) || isLimitsTool(name) || isAskTool(name) || isNotifyTool(name),
    callTool: async (name, args, signal) => {
      if (nexaToolCategory(name) && !nexaToolOn(tools, name)) throw new Error(offMessage(tools, name))
      if (isAskTool(name)) {
        if (!ask) throw new Error('Nexa cannot show forms right now.')
        return ask.call(caller.sessionId, args, signal)
      }
      if (isNotifyTool(name)) {
        if (!notify) throw new Error('Nexa cannot send notifications right now.')
        return notify.call(caller.sessionId, args, signal)
      }
      if (isLimitsTool(name)) {
        if (!limits) throw new Error('Nexa cannot read the limits right now.')
        return limits.call(caller.sessionId, name)
      }
      if (isChatTool(name)) {
        if (!chats || caller.sessionId === null) throw new Error('This connection belongs to no chat of Nexa, so it reaches no other chats.')
        return chats.call(caller.sessionId, name, args)
      }
      if (!isBrowserTool(name)) return render.callTool(name, args)
      if (!browser || caller.sessionId === null) throw new Error('This connection belongs to no chat of Nexa, so it has no browser.')
      return browser.call(caller.sessionId, name, args)
    },
  }
}
