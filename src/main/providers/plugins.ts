import { resolve } from 'node:path'
import type { McpAuthStart, PluginInfo } from '@shared/types'
import { isPlainObject } from '@shared/utils'

type Json = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** A plugin of Claude Code with the folder its files are in, for its manifest. */
export interface ClaudePlugin extends PluginInfo {
  installPath?: string
}

/** The most specific installation wins, as in Claude Code: a project's own over the user's. */
const SCOPE_RANK: Record<string, number> = { local: 3, project: 2, user: 1 }

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

/** `<plugin>@<marketplace>` split into both. */
export function pluginIdParts(id: string): { name: string; marketplace?: string } {
  const at = id.lastIndexOf('@')
  return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) || undefined } : { name: id }
}

/**
 * `claude plugin list --json`: every installation of every plugin. Those for another project are left
 * out; of a plugin installed for the user and for the folder, the folder's counts. `enabled` is as the
 * settings seen from the folder the command ran in say.
 */
export function claudePlugins(raw: unknown, cwd: string): ClaudePlugin[] {
  const list = Array.isArray(raw) ? raw.filter(isPlainObject) : []
  const chosen = new Map<string, { entry: Json; rank: number }>()
  for (const entry of list) {
    const id = str(entry.id)
    if (!id) continue
    const scope = str(entry.scope) ?? 'user'
    const project = str(entry.projectPath)
    if (scope !== 'user' && project && !samePath(project, cwd)) continue
    const rank = SCOPE_RANK[scope] ?? 0
    const before = chosen.get(id)
    if (!before || rank > before.rank) chosen.set(id, { entry, rank })
  }
  return [...chosen.entries()].map(([id, { entry }]) => {
    const { name, marketplace } = pluginIdParts(id)
    return {
      id,
      name,
      marketplace,
      version: str(entry.version),
      scope: str(entry.scope) ?? 'user',
      enabled: entry.enabled !== false,
      installPath: str(entry.installPath),
    }
  })
}

/** What a plugin's manifest (`.claude-plugin/plugin.json`) tells about it. */
export function claudeManifest(raw: unknown): { name?: string; description?: string; version?: string } {
  if (!isPlainObject(raw)) return {}
  return { name: str(raw.name), description: str(raw.description), version: str(raw.version) }
}

/** The answer of `claude plugin enable|disable --json`: null when it worked, else what went wrong. */
export function claudePluginToggleError(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (!isPlainObject(parsed)) continue
    if (parsed.outcome === 'ok') return null
    return str(parsed.message) ?? str(parsed.error) ?? 'Claude Code hat den Schalter nicht übernommen.'
  }
  return 'Claude Code hat nicht geantwortet.'
}

/**
 * Codex's `plugin/installed`: the marketplaces with their plugins, of which only the installed ones
 * count here. A plugin the organization keeps off can't be switched.
 */
export function codexPlugins(raw: unknown): PluginInfo[] {
  const marketplaces = isPlainObject(raw) && Array.isArray(raw.marketplaces) ? raw.marketplaces.filter(isPlainObject) : []
  const plugins = new Map<string, PluginInfo>()
  for (const market of marketplaces) {
    const marketName = (isPlainObject(market.interface) ? str(market.interface.displayName) : undefined) ?? str(market.name)
    for (const p of Array.isArray(market.plugins) ? market.plugins.filter(isPlainObject) : []) {
      const id = str(p.id)
      if (!id || p.installed !== true || plugins.has(id)) continue
      const face = isPlainObject(p.interface) ? p.interface : {}
      const locked = p.availability === 'DISABLED_BY_ADMIN' || p.disabledReason === 'disabled_by_admin' ? 'Von der Organisation abgeschaltet' : undefined
      plugins.set(id, {
        id,
        name: str(face.displayName) ?? str(p.name) ?? pluginIdParts(id).name,
        description: str(face.shortDescription) ?? str(face.longDescription),
        version: str(p.localVersion) ?? str(p.version),
        marketplace: marketName,
        enabled: p.enabled === true && !locked,
        locked,
      })
    }
  }
  return [...plugins.values()]
}

/**
 * Claude Code's answer to `mcp_authenticate`. `callbackExpected`: it waits for the browser's redirect
 * itself; without, the sign-in is on claude.ai and the server has to connect anew afterwards. No URL:
 * nothing to sign in to.
 */
export function claudeAuthStart(raw: unknown): McpAuthStart | null {
  if (!isPlainObject(raw)) return null
  const url = str(raw.authUrl)
  if (!url || raw.requiresUserAction === false) return null
  return { url, waits: raw.callbackExpected === true }
}

/** Codex's `mcpServer/oauth/login`: the page to sign in on; the app-server takes the answer. */
export function codexAuthStart(raw: unknown): McpAuthStart | null {
  const url = isPlainObject(raw) ? str(raw.authorizationUrl) : undefined
  return url ? { url, waits: true } : null
}

/** Sorted for the menu: by name, as the CLIs list them. */
export function byPluginName(a: PluginInfo, b: PluginInfo): number {
  return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
}
