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
