import { isPlainObject } from '@shared/utils'
import { McpAppsInvoke } from '@shared/mcp-apps'
import { handle } from '../ipc'
import type { SessionService } from '../services/session-service'
import type { McpAppViews } from './mcp-app-views'

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
}
