import { claudeServerKey, toolUiOf, type McpToolUi } from '@shared/mcp-apps'
import { isPlainObject } from '@shared/utils'
import type { McpServerState } from './provider'

type Json = Record<string, unknown>

/** Nexa's own server is part of the app (its tools have their own settings), not one to switch. */
const NEXA_SERVER = 'nexa'
/** Codex's built-in server for the ChatGPT apps: not one of the user's, nor one a thread's config can leave out. */
const CODEX_APPS = 'codex_apps'

const STATES = new Set<McpServerState['status']>(['connected', 'failed', 'needs-auth', 'pending', 'disabled'])
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** Claude Code's answer to `mcp_status` (`mcpServers[]`) without Nexa's server. */
export function claudeMcpServers(raw: unknown): McpServerState[] {
  const list = isPlainObject(raw) && Array.isArray(raw.mcpServers) ? raw.mcpServers.filter(isPlainObject) : []
  return list
    .filter((s) => str(s.name) && s.name !== NEXA_SERVER)
    .map((s) => ({
      name: s.name as string,
      status: STATES.has(s.status as McpServerState['status']) ? (s.status as McpServerState['status']) : 'pending',
      scope: str(s.scope) ?? str(s.source),
      tools: Array.isArray(s.tools) ? s.tools.length : typeof s.toolCount === 'number' ? s.toolCount : undefined,
      error: str(s.error),
    }))
}

/** The tools with what their descriptors say about pages (MCP Apps), per server. */
export interface McpToolUis {
  /** The server as the CLI names it in its own calls. */
  server: string
  tools: Map<string, McpToolUi>
}

/**
 * The tools of Claude Code's `mcp_status` with their `_meta` (sent while Nexa hosts MCP Apps, see
 * PROTOCOLS.md), by the server's key in tool names (`mcp__<key>__<tool>`).
 */
export function claudeToolUis(raw: unknown): Map<string, McpToolUis> {
  const list = isPlainObject(raw) && Array.isArray(raw.mcpServers) ? raw.mcpServers.filter(isPlainObject) : []
  const map = new Map<string, McpToolUis>()
  for (const s of list) {
    const name = str(s.name)
    if (!name || name === NEXA_SERVER) continue
    const tools = new Map<string, McpToolUi>()
    for (const t of Array.isArray(s.tools) ? s.tools.filter(isPlainObject) : []) {
      if (str(t.name)) tools.set(t.name as string, toolUiOf(t._meta))
    }
    map.set(claudeServerKey(name), { server: name, tools })
  }
  return map
}

/** The tools of Codex's `mcpServerStatus/list` with what their descriptors say about pages, by server name. */
export function codexToolUis(raw: unknown): Map<string, McpToolUis> {
  const list = isPlainObject(raw) && Array.isArray(raw.data) ? raw.data.filter(isPlainObject) : []
  const map = new Map<string, McpToolUis>()
  for (const s of list) {
    const name = str(s.name)
    if (!name || name === NEXA_SERVER) continue
    const tools = new Map<string, McpToolUi>()
    for (const [toolName, t] of Object.entries(isPlainObject(s.tools) ? s.tools : {})) {
      if (isPlainObject(t)) tools.set(str(t.name) ?? toolName, toolUiOf(t._meta))
    }
    map.set(name, { server: name, tools })
  }
  return map
}

/** Codex's `mcpServerStatus/list` (`data[]`): its servers by name with their tools as a map. */
export function codexMcpServers(raw: unknown): McpServerState[] {
  const list = isPlainObject(raw) && Array.isArray(raw.data) ? raw.data.filter(isPlainObject) : []
  return list
    .filter((s) => str(s.name) && s.name !== NEXA_SERVER && s.name !== CODEX_APPS)
    .map((s) => {
      const tools = isPlainObject(s.tools) ? Object.keys(s.tools).length : undefined
      return { name: s.name as string, status: codexStatus(s, tools), tools }
    })
}

function codexStatus(s: Json, tools: number | undefined): McpServerState['status'] {
  const runtime = str(s.runtimeStatus) ?? (isPlainObject(s.runtimeStatus) ? str(s.runtimeStatus.type) : undefined)
  const auth = str(s.authStatus)
  if (auth === 'notLoggedIn') return 'needs-auth'
  switch (runtime) {
    case 'ready':
    case 'running':
    case 'connected':
      return 'connected'
    case 'failed':
    case 'error':
      return 'failed'
    case 'starting':
      return 'pending'
    default:
      return tools !== undefined ? 'connected' : 'pending'
  }
}
