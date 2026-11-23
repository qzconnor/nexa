import type { ContextDetail, ContextEntry, ContextPart } from '@shared/chat'
import { isPlainObject } from '@shared/utils'

type Json = Record<string, unknown>

/** German names of the parts Claude Code counts; one it adds later keeps its own name. */
const PART_NAMES: Record<string, string> = {
  system_prompt: 'Systemprompt',
  system_tools: 'System-Werkzeuge',
  mcp_tools: 'MCP-Werkzeuge',
  mcp_instructions: 'Anweisungen der MCP-Server',
  custom_agents: 'Eigene Agents',
  memory_files: 'Anweisungsdateien',
  skills: 'Skills',
  slash_commands: 'Befehle',
  messages: 'Nachrichten',
  autocompact_buffer: 'Puffer fürs Zusammenfassen',
  free_space: 'Frei',
  mcp_tools_deferred: 'MCP-Werkzeuge (bei Bedarf)',
  system_tools_deferred: 'System-Werkzeuge (bei Bedarf)',
}

const KINDS = new Set<ContextPart['kind']>(['used', 'deferred', 'buffer', 'free'])

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isPlainObject) : [])

/** The parts' ids as the name for one the CLI names in its own words only. */
function partName(id: string, name: string | undefined): string {
  return PART_NAMES[id] ?? name ?? id
}

/**
 * Claude Code's answer to `get_context_usage` as Nexa shows it: the parts in its order, MCP tools
 * by server, agents and memory files. Null when it isn't one.
 */
export function contextDetailOf(raw: unknown, at = Date.now()): ContextDetail | null {
  if (!isPlainObject(raw)) return null
  const used = num(raw.totalTokens)
  const window = num(raw.maxTokens) ?? num(raw.rawMaxTokens)
  if (used === undefined || !window) return null
  const parts: ContextPart[] = []
  for (const c of list(raw.categories)) {
    const id = str(c.id) ?? str(c.name)
    const tokens = num(c.tokens)
    if (!id || tokens === undefined) continue
    const kind = KINDS.has(c.kind as ContextPart['kind']) ? (c.kind as ContextPart['kind']) : c.isDeferred === true ? 'deferred' : 'used'
    parts.push({ id, name: partName(id, str(c.name)), tokens, kind })
  }

  const servers = new Map<string, ContextEntry>()
  for (const tool of list(raw.mcpTools)) {
    const server = str(tool.serverName) ?? 'MCP'
    const entry = servers.get(server) ?? { name: server, tokens: 0, count: 0, loaded: 0 }
    entry.tokens += num(tool.tokens) ?? 0
    entry.count = (entry.count ?? 0) + 1
    if (tool.isLoaded === true) entry.loaded = (entry.loaded ?? 0) + 1
    servers.set(server, entry)
  }
  const agents = list(raw.agents).map((a) => ({ name: str(a.agentType) ?? str(a.name) ?? 'Agent', tokens: num(a.tokens) ?? 0 }))
  const memoryFiles = list(raw.memoryFiles).map((f) => ({ name: str(f.path) ?? 'CLAUDE.md', tokens: num(f.tokens) ?? 0 }))
  const byTokens = (a: ContextEntry, b: ContextEntry) => b.tokens - a.tokens

  return {
    used,
    window,
    parts,
    compactAt: raw.isAutoCompactEnabled === false ? undefined : num(raw.autoCompactThreshold),
    mcpServers: servers.size ? [...servers.values()].sort(byTokens) : undefined,
    agents: agents.length ? agents.sort(byTokens) : undefined,
    memoryFiles: memoryFiles.length ? memoryFiles.sort(byTokens) : undefined,
    at,
  }
}
