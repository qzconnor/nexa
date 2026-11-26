import { isPlainObject } from '@shared/utils'
import { MAX_APP_RESULT_JSON, McpAppsInvoke, type McpAppRemotePage, type McpAppToolResult } from '@shared/mcp-apps'
import { handle } from '../ipc'
import type { SessionService } from '../services/session-service'
import { appPageOf, type McpAppViews } from './mcp-app-views'

const MAX_NAME = 256
const MAX_URI = 2048

function str(value: unknown, what: string, max = MAX_NAME): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`${what} fehlt.`)
  return value
}

/** The chat's side of the pages of MCP tools (MCP Apps): the page, and what it asks of its server. */
export function registerMcpAppsIpc(views: McpAppViews, sessions: SessionService): void {
  handle(McpAppsInvoke.open, (_e, sessionId: unknown, itemId: unknown) => {
    const session = str(sessionId, 'Chat')
    const item = str(itemId, 'Werkzeug')
    return views.open(session, item, () => sessions.readMcpAppResource(session, item))
  })
  handle(McpAppsInvoke.callTool, (_e, sessionId: unknown, itemId: unknown, name: unknown, args: unknown) =>
    sessions.callMcpAppTool(str(sessionId, 'Chat'), str(itemId, 'Werkzeug'), str(name, 'Werkzeugname'), isPlainObject(args) ? args : {}),
  )
  handle(McpAppsInvoke.readResource, (_e, sessionId: unknown, itemId: unknown, uri: unknown) =>
    sessions.readMcpAppResource(str(sessionId, 'Chat'), str(itemId, 'Werkzeug'), str(uri, 'Adresse', MAX_URI)),
  )
  // For another device's window: its chat leaves the pages' results out (slimItem), the page brings it.
  handle(McpAppsInvoke.page, async (_e, sessionId: unknown, itemId: unknown): Promise<McpAppRemotePage> => {
    const session = str(sessionId, 'Chat')
    const item = str(itemId, 'Werkzeug')
    const page = appPageOf(await sessions.readMcpAppResource(session, item))
    return { ...page, result: await sessions.mcpAppResult(session, item) }
  })
}

/**
 * Pages of other devices' chats: fetched from the device (`mcp-apps:page`), checked as a page of a
 * server here is, and served from this device's scheme. What the page asks of its server goes there.
 */
export function registerRemoteMcpAppsIpc(views: McpAppViews, invoke: (device: string, channel: string, args: unknown[]) => Promise<unknown>): void {
  handle(McpAppsInvoke.openRemote, async (_e, device: unknown, sessionId: unknown, itemId: unknown) => {
    const instance = str(device, 'Gerät')
    const session = str(sessionId, 'Chat')
    const item = str(itemId, 'Werkzeug')
    let result: McpAppToolResult | null = null
    const opened = await views.openRemote(instance, session, item, async () => {
      const page = (await invoke(instance, McpAppsInvoke.page, [session, item])) as Partial<McpAppRemotePage> | null
      result = remoteResult(page?.result)
      // The same checks as a page from a server here: HTML, its size, its `_meta`.
      return appPageOf({ contents: [{ mimeType: 'text/html', text: page?.html, _meta: page?.meta }] })
    })
    // A page held from before: its result comes again (the tool may have finished since).
    if (result === null) {
      const page = (await invoke(instance, McpAppsInvoke.page, [session, item]).catch(() => null)) as Partial<McpAppRemotePage> | null
      result = remoteResult(page?.result)
    }
    return { ...opened, result }
  })
}

function remoteResult(value: unknown): McpAppToolResult | null {
  if (!isPlainObject(value)) return null
  return JSON.stringify(value).length <= MAX_APP_RESULT_JSON ? (value as unknown as McpAppToolResult) : null
}
