import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  CliConfigScope,
  CliConfigScopeInfo,
  CliConfigSnapshot,
  HookEventConfig,
  HookGroup,
  HookHandler,
  HooksSave,
  McpEntry,
  McpServerConfig,
  McpTransport,
  PermissionValue,
} from '@shared/cli-config'
import { redactSecrets } from '@shared/redact'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../accounts/account-env'
import { writeJsonAtomic } from '../lib/json-file'

export type Json = Record<string, unknown>

/** Whose settings an adapter reads or changes: the account (its folder, its login) and the scope. */
export interface CliConfigContext {
  account: AccountEnv
  scope: CliConfigScope
  /** A project's folder, for its scopes (checked by the service: one Nexa knows). */
  folder?: string
}

/** What an adapter reads; the service adds the target and the scopes. */
export type CliConfigRead = Omit<CliConfigSnapshot, 'target' | 'scopes'>

/**
 * The settings of one CLI in its own files (see shared/cli-config.ts). A CLI without one isn't offered
 * under Einstellungen › CLI-Konfiguration.
 */
export interface CliConfigAdapter {
  readonly scopes: CliConfigScopeInfo[]
  /** The kinds of MCP servers the CLI has. */
  readonly transports: McpTransport[]
  read(ctx: CliConfigContext): Promise<CliConfigRead>
  saveMcpServer(ctx: CliConfigContext, server: McpServerConfig, previousName: string | null): Promise<void>
  removeMcpServer(ctx: CliConfigContext, name: string): Promise<void>
  savePermissions(ctx: CliConfigContext, values: Record<string, PermissionValue>): Promise<void>
  saveHooks(ctx: CliConfigContext, save: HooksSave): Promise<void>
  /** For CLIs that run a hook only once it is trusted (Codex). */
  trustHook?(ctx: CliConfigContext, key: string, hash: string): Promise<void>
}

// ---------------------------------------------------------------------------------------------
// Files

/** A JSON file of a CLI: null when it isn't there; one that can't be read is an error, never `{}`. */
export async function readJsonFile(file: string): Promise<Json | null> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (!text.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`„${basename(file)}“ ist kein gültiges JSON. Nexa ändert die Datei nicht, damit nichts verloren geht.`)
  }
  if (!isPlainObject(parsed)) throw new Error(`„${basename(file)}“ enthält kein JSON-Objekt. Nexa ändert die Datei nicht.`)
  return parsed
}

/**
 * Changes a CLI's JSON file: read right before, changed, written atomically. Keys Nexa doesn't know stay
 * as they are; a file that isn't valid JSON (comments, a CLI writing it right now) isn't touched.
 */
export async function updateJsonFile(file: string, change: (data: Json) => void): Promise<void> {
  const data = (await readJsonFile(file)) ?? {}
  change(data)
  await writeJsonAtomic(file, data)
}

/** A short hash of what was read, to notice that a file changed before a save. */
export function versionOf(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null))
    .digest('hex')
    .slice(0, 16)
}

// ---------------------------------------------------------------------------------------------
// Variables and headers of MCP servers

const REFERENCE = /^\$\{?[\w:-]+\}?$|^%\w+%$/

/**
 * Whether a variable's or header's value is a secret the window shouldn't see: by its name (API_KEY,
 * Authorization …) or its shape (a token). A reference to a variable (`${GITHUB_TOKEN}`) isn't one.
 */
export function isSecretEntry(name: string, value: string): boolean {
  const bare = value.trim()
  if (!bare || REFERENCE.test(bare)) return false
  // Headers and variables called „…-Key“ are keys too, though not every text with „key“ is one.
  if (/authorization|cookie|(?:^|[-_.])key$/i.test(name)) return true
  return redactSecrets(`${name}=${bare}`).count > 0 || redactSecrets(bare).count > 0
}

/** A record of variables or headers for the window, secrets without their value. */
export function entriesOut(record: unknown): McpEntry[] | undefined {
  if (!isPlainObject(record)) return undefined
  return Object.entries(record).map(([name, raw]) => {
    const value = typeof raw === 'string' ? raw : JSON.stringify(raw)
    return isSecretEntry(name, value) ? { name, value: '', masked: true } : { name, value }
  })
}

/** The record to save: a masked entry keeps the value it has in `current`. */
export function entriesIn(entries: readonly McpEntry[] | undefined, current: unknown): Record<string, string> | undefined {
  if (!entries?.length) return undefined
  const before = isPlainObject(current) ? current : {}
  const out: Record<string, string> = {}
  for (const entry of entries) {
    const name = entry.name.trim()
    if (!name) continue
    if (entry.masked) {
      const kept = before[name]
      if (typeof kept !== 'string') throw new Error(`Für „${name}“ ist kein Wert gespeichert. Bitte neu eintragen.`)
      out[name] = kept
    } else out[name] = entry.value
  }
  return Object.keys(out).length ? out : undefined
}

/** The keys of a server's entry that Nexa doesn't edit. */
export function otherKeys(raw: Json, edited: readonly string[]): string[] | undefined {
  const other = Object.keys(raw).filter((key) => !edited.includes(key))
  return other.length ? other : undefined
}

/** `raw` without the keys Nexa edits, to lay the edited ones over. */
export function withoutKeys(raw: unknown, keys: readonly string[]): Json {
  if (!isPlainObject(raw)) return {}
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !keys.includes(key)))
}

// ---------------------------------------------------------------------------------------------
// Hooks: both CLIs keep them as `{ <Event>: [{ matcher, hooks: [{ type, command, timeout }] }] }`

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

function handlerOut(raw: unknown, origin: HookHandler['origin']): HookHandler {
  const h = isPlainObject(raw) ? raw : {}
  const type = str(h.type) ?? 'command'
  const timeout = typeof h.timeout === 'number' && h.timeout > 0 ? h.timeout : undefined
  if (type === 'command') return { type, command: typeof h.command === 'string' ? h.command : '', timeout, origin }
  // Another kind: what it does in a line, without anything a header may hide.
  const summary = str(h.prompt) ?? str(h.url) ?? (str(h.server) && str(h.tool) ? `${h.server as string} › ${h.tool as string}` : undefined) ?? str(h.agent)
  return { type, summary: summary ? redactSecrets(summary.split(/\r?\n/)[0]!).text : undefined, timeout, origin }
}

/** The hooks of a file's `hooks` object by event, in the order of `events` and then the others. */
export function hookConfigsOut(raw: unknown, events: readonly string[]): HookEventConfig[] {
  if (!isPlainObject(raw)) return []
  const names = Object.keys(raw).filter((name) => Array.isArray(raw[name]))
  names.sort((a, b) => rank(events, a) - rank(events, b))
  return names.map((event) => ({
    event,
    groups: (raw[event] as unknown[]).map((group, g): HookGroup => {
      const entry = isPlainObject(group) ? group : {}
      const hooks = Array.isArray(entry.hooks) ? entry.hooks : []
      return { matcher: str(entry.matcher) ?? null, origin: g, hooks: hooks.map((h, index) => handlerOut(h, { group: g, index })) }
    }),
  }))
}

function rank(events: readonly string[], name: string): number {
  const at = events.indexOf(name)
  return at < 0 ? events.length : at
}

/**
 * The groups of one event as the file gets them: each group and handler over what it was in the file
 * (`origin`), so keys Nexa doesn't edit stay; a command gets its command and timeout from the window,
 * another kind stays as it was. Empty groups go.
 */
export function hookGroupsIn(groups: readonly HookGroup[], before: unknown): Json[] {
  const old = Array.isArray(before) ? before : []
  const out: Json[] = []
  for (const group of groups) {
    const base = group.origin !== undefined && isPlainObject(old[group.origin]) ? withoutKeys(old[group.origin], ['matcher', 'hooks']) : {}
    const hooks: Json[] = []
    for (const handler of group.hooks) {
      const originGroup = handler.origin ? old[handler.origin.group] : undefined
      const originHooks = isPlainObject(originGroup) && Array.isArray(originGroup.hooks) ? originGroup.hooks : []
      const raw = handler.origin && isPlainObject(originHooks[handler.origin.index]) ? (originHooks[handler.origin.index] as Json) : null
      if (handler.type !== 'command') {
        // Nexa can't write another kind from what the window has; only move it as it was.
        if (raw) hooks.push(raw)
        continue
      }
      const command = handler.command?.trim()
      if (!command) throw new Error('Ein Hook braucht einen Befehl.')
      const next: Json = { ...withoutKeys(raw, ['type', 'command', 'timeout']), type: 'command', command }
      if (handler.timeout !== undefined) {
        if (!Number.isFinite(handler.timeout) || handler.timeout <= 0) throw new Error('Die Zeitgrenze muss eine positive Zahl (Sekunden) sein.')
        next.timeout = handler.timeout
      }
      // `type` first, as the CLIs write it.
      hooks.push({ type: next.type, command: next.command, ...next })
    }
    if (!hooks.length) continue
    const matcher = group.matcher?.trim()
    out.push({ ...(matcher ? { matcher } : {}), ...base, hooks })
  }
  return out
}

/** A file's `hooks` object with one event's groups replaced; without groups the event goes, without events the object. */
export function withHookEvent(hooks: unknown, event: string, groups: Json[]): Json | undefined {
  const next: Json = isPlainObject(hooks) ? { ...hooks } : {}
  if (groups.length) next[event] = groups
  else delete next[event]
  return Object.keys(next).length ? next : undefined
}

/** Settings files keep lists of strings; empty lines and doubles go. */
export function cleanList(value: PermissionValue): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value.map((v) => String(v).trim()).filter((v) => v && !seen.has(v) && seen.add(v))
}
