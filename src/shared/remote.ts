/**
 * Remote Control between two paired devices (docs/NEXA-SERVER.md, „Remote Control“): what a controlling
 * device asks of a host and what the host sends back. The messages go sealed for the pair and signed
 * (`main/server-link/device-channel.ts`); the host still checks every request itself, against the level
 * it gives the asking device. Shared with the later PWA, so nothing here needs Node or Electron.
 */

import type { ChatItem, InteractionResponse, SessionEvent, SessionRuntime } from './chat'
import type { SessionMeta } from './types'

/** `kind`s of Remote Control messages; the server sees them in plain text. */
export const RemoteKind = {
  /** Controller → host: `{ m, p }`, answered by a `response` naming its id. */
  request: 'rc.request',
  /** Host → controller: `{ re, r }` or `{ re, e }`. */
  response: 'rc.response',
  /** Host → controller: `{ events }`, for the chats it watches (`watch`). */
  events: 'rc.events',
} as const

/** What a host lets another device do; each level includes the ones before it. */
export type RemoteLevel = 'off' | 'read' | 'prompt' | 'full'
export const REMOTE_LEVELS: readonly RemoteLevel[] = ['off', 'read', 'prompt', 'full']
/** A device the user hasn't given a level yet: it may look, not act. */
export const DEFAULT_REMOTE_LEVEL: RemoteLevel = 'read'

export const REMOTE_LEVEL_LABELS: Record<RemoteLevel, string> = {
  off: 'Aus',
  read: 'Nur mitlesen',
  prompt: 'Prompts senden und abbrechen',
  full: 'Alles, auch Rückfragen und Freigaben',
}

export function isRemoteLevel(value: unknown): value is RemoteLevel {
  return typeof value === 'string' && (REMOTE_LEVELS as readonly string[]).includes(value)
}

export function levelAllows(level: RemoteLevel, needed: RemoteLevel): boolean {
  return REMOTE_LEVELS.indexOf(level) >= REMOTE_LEVELS.indexOf(needed)
}

/** The host as it answers `hello`: whether it lets anyone in, and how far the asking device. */
export interface RemoteHostInfo {
  name: string
  /** Remote Control is on at the host (Einstellungen › Geräte). */
  enabled: boolean
  /** What the host lets the asking device do; `off` while Remote Control is off. */
  level: RemoteLevel
  /** Nexa's version at the host. */
  version: string
}

export interface RemoteProject {
  id: string
  name: string
  path: string
  /** The separator it shows under at the host, if not the default one. */
  section?: string
}

/** A chat as a controlling device lists it. */
export type RemoteSession = Pick<SessionMeta, 'id' | 'projectId' | 'title' | 'provider' | 'model' | 'createdAt' | 'updatedAt' | 'pinned' | 'cwd' | 'preview'>

export interface RemoteChats {
  projects: RemoteProject[]
  /** Without archived chats, newest first. */
  sessions: RemoteSession[]
  /** Of the chats that aren't idle. */
  runtimes: Record<string, SessionRuntime>
}

/** A page of a chat's history, from its end backwards (`open`). */
export interface RemotePage {
  session: RemoteSession
  /** `items` are the chat's items from `start` on, up to `before` or its end. */
  items: ChatItem[]
  start: number
  /** How many items the chat has. */
  total: number
  runtime: SessionRuntime
}

/** The requests, with what each takes and returns. */
export interface RemoteMethods {
  hello: { params: Record<string, never>; result: RemoteHostInfo }
  chats: { params: Record<string, never>; result: RemoteChats }
  /** The newest items, or those before `before` (an index, for „Ältere laden“). */
  open: { params: { id: string; before?: number }; result: RemotePage }
  /**
   * The chats whose items and streamed text the device gets as `rc.events`, besides the state of all
   * chats; replaces the last set and lasts `WATCH_TTL_MS`, so it is renewed while a window shows them.
   * `renewed` false: the host had no watch of this device (it restarted, or the last one ran out), and
   * what happened meanwhile came as no event: open chats are to be read anew.
   */
  watch: { params: { ids: string[] }; result: { renewed: boolean } }
  unwatch: { params: Record<string, never>; result: null }
  send: { params: { id: string; text: string }; result: null }
  interrupt: { params: { id: string }; result: null }
  respond: { params: { id: string; itemId: string; response: InteractionResponse }; result: null }
}
export type RemoteMethod = keyof RemoteMethods

/** The level each request needs; null: every member may ask (to learn its level, or to stop). */
export const METHOD_LEVEL: Record<RemoteMethod, RemoteLevel | null> = {
  hello: null,
  chats: 'read',
  open: 'read',
  watch: 'read',
  unwatch: null,
  send: 'prompt',
  interrupt: 'prompt',
  respond: 'full',
}

/** A watch lasts this long unless renewed; the controller renews it every `WATCH_RENEW_MS`. */
export const WATCH_TTL_MS = 90_000
export const WATCH_RENEW_MS = 30_000

/** What `rc.events` carries: the chats' own events, and `chats` when the list changed (read it anew). */
export type RemoteEvent = SessionEvent | { type: 'chats' }

export type RemoteErrorCode =
  /** Remote Control is off at the host. */
  | 'disabled'
  /** The host doesn't let this device do that. */
  | 'forbidden'
  | 'not-found'
  | 'bad-request'
  /** The answer would be larger than the server passes on. */
  | 'too-large'
  /** The host tried, and it went wrong; `message` says why, in German. */
  | 'failed'
  /** On the controlling side: the host isn't connected, didn't answer, or this device isn't. */
  | 'unreachable'
  /** The host is connected but doesn't keep up with reading (the server said `busy`). */
  | 'busy'
  /** The server knows no such device (any more): it was removed. */
  | 'gone'
  | 'timeout'
  | 'offline'

export interface RemoteErrorBody {
  code: RemoteErrorCode
  message: string
}

export type RemoteResponse = { re: string; r: unknown } | { re: string; e: RemoteErrorBody }

/** For the user, by code; `failed` brings the host's own words. */
export function remoteErrorText(error: RemoteErrorBody): string {
  switch (error.code) {
    case 'disabled':
      return 'Auf diesem Gerät ist die Fernsteuerung aus. Schalte sie dort unter Einstellungen › Geräte ein.'
    case 'forbidden':
      return 'Das darf dieses Gerät dort nicht. Mehr gibst du am anderen Gerät unter Einstellungen › Geräte frei.'
    case 'not-found':
      return 'Den Chat gibt es dort nicht mehr.'
    case 'bad-request':
      return 'Das andere Gerät hat die Anfrage nicht verstanden. Läuft dort eine andere Version von Nexa?'
    case 'too-large':
      return 'Die Antwort wäre zu groß für den Server.'
    case 'unreachable':
      return 'Das Gerät ist gerade nicht verbunden.'
    case 'busy':
      return 'Das Gerät kommt gerade nicht hinterher. Versuch es gleich noch einmal.'
    case 'gone':
      return 'Das Gerät gibt es beim Server nicht mehr.'
    case 'timeout':
      return 'Das Gerät hat nicht geantwortet.'
    case 'offline':
      return 'Dieses Gerät ist nicht mit dem Server verbunden.'
    case 'failed':
      return error.message
  }
}

const REMOTE_ERROR_CODES = new Set<string>(['disabled', 'forbidden', 'not-found', 'bad-request', 'too-large', 'failed', 'unreachable', 'busy', 'gone', 'timeout', 'offline'])

// --- Parsing what comes over the relay -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const ID = /^[A-Za-z0-9_-]{1,128}$/
const isId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
/** Items are named by their CLIs (`toolu_…`, `ask:<uuid>`, Codex' own): any printable text of some length. */
const isItemId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value)
/** A prompt as long as a pasted log; the CLIs take far more, but over the relay this is plenty. */
export const MAX_REMOTE_PROMPT = 200_000

export type RemoteRequest = { [M in RemoteMethod]: { m: M; p: RemoteMethods[M]['params'] } }[RemoteMethod]

/** A request as the host takes it, its parameters checked; null when it isn't one. */
export function parseRemoteRequest(data: unknown): RemoteRequest | null {
  if (!isRecord(data) || typeof data.m !== 'string') return null
  const p = isRecord(data.p) ? data.p : {}
  switch (data.m) {
    case 'hello':
    case 'chats':
    case 'unwatch':
      return { m: data.m, p: {} }
    case 'open': {
      const before = p.before
      if (!isId(p.id) || (before !== undefined && !(Number.isInteger(before) && (before as number) >= 0))) return null
      return { m: 'open', p: before === undefined ? { id: p.id } : { id: p.id, before: before as number } }
    }
    case 'watch': {
      if (!Array.isArray(p.ids) || p.ids.length > 32 || !p.ids.every(isId)) return null
      return { m: 'watch', p: { ids: [...new Set(p.ids as string[])] } }
    }
    case 'send':
      if (!isId(p.id) || typeof p.text !== 'string' || !p.text.trim() || p.text.length > MAX_REMOTE_PROMPT) return null
      return { m: 'send', p: { id: p.id, text: p.text } }
    case 'interrupt':
      return isId(p.id) ? { m: 'interrupt', p: { id: p.id } } : null
    case 'respond': {
      const response = parseInteractionResponse(p.response)
      if (!isId(p.id) || !isItemId(p.itemId) || !response) return null
      return { m: 'respond', p: { id: p.id, itemId: p.itemId, response } }
    }
    default:
      return null
  }
}

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

/** An answer to a question of the agent, in one of the shapes the chat sends; null otherwise. */
export function parseInteractionResponse(value: unknown): InteractionResponse | null {
  if (!isRecord(value)) return null
  const optional = (v: unknown) => v === undefined || typeof v === 'string'
  switch (value.type) {
    case 'permission':
      if (!['allow', 'allow-session', 'deny'].includes(value.decision as string) || !optional(value.message)) return null
      return { type: 'permission', decision: value.decision as 'allow' | 'allow-session' | 'deny', ...(value.message !== undefined ? { message: value.message as string } : {}) }
    case 'question': {
      const answers = value.answers
      if (!isRecord(answers) || !Object.values(answers).every(isStringArray)) return null
      return { type: 'question', answers: answers as Record<string, string[]> }
    }
    case 'plan': {
      const modes = ['ask', 'edits', 'plan', 'auto', 'full']
      if (typeof value.approve !== 'boolean' || (value.mode !== undefined && !modes.includes(value.mode as string)) || !optional(value.feedback)) return null
      return value as InteractionResponse
    }
    case 'elicitation':
      if (!['accept', 'decline', 'cancel'].includes(value.action as string) || (value.content !== undefined && !isRecord(value.content))) return null
      return value as InteractionResponse
    case 'form': {
      if (!['submit', 'decline'].includes(value.action as string)) return null
      const values = value.values
      const fine = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || isStringArray(v)
      if (values !== undefined && !(isRecord(values) && Object.values(values).every(fine))) return null
      return value as InteractionResponse
    }
    default:
      return null
  }
}

export function parseRemoteResponse(data: unknown): RemoteResponse | null {
  if (!isRecord(data) || typeof data.re !== 'string') return null
  if (isRecord(data.e)) {
    const { code, message } = data.e
    if (typeof code !== 'string' || typeof message !== 'string') return null
    return { re: data.re, e: { code: REMOTE_ERROR_CODES.has(code) ? (code as RemoteErrorCode) : 'failed', message: message.slice(0, 1000) } }
  }
  return 'r' in data ? { re: data.re, r: data.r } : null
}

const EVENT_TYPES = new Set(['item', 'delta', 'runtime', 'truncated', 'chats'])

/** The events of an `rc.events`, roughly checked: they come from a member, but a broken one mustn't break the window. */
export function parseRemoteEvents(data: unknown): RemoteEvent[] | null {
  if (!isRecord(data) || !Array.isArray(data.events)) return null
  const events: RemoteEvent[] = []
  for (const event of data.events) {
    if (!isRecord(event) || !EVENT_TYPES.has(event.type as string)) continue
    if (event.type !== 'chats' && typeof event.sessionId !== 'string') continue
    if (event.type === 'item' && !(isRecord(event.item) && typeof event.item.id === 'string' && typeof event.item.kind === 'string')) continue
    if (event.type === 'delta' && (typeof event.itemId !== 'string' || typeof event.text !== 'string' || (event.field !== 'text' && event.field !== 'output'))) continue
    if (event.type === 'runtime' && !(isRecord(event.runtime) && typeof event.runtime.status === 'string')) continue
    if (event.type === 'truncated' && !Number.isInteger(event.length)) continue
    events.push(event as RemoteEvent)
  }
  return events
}

// --- What goes over the relay of a chat --------------------------------------------------------------

/** Longest text of one field of an item that goes to another device, in UTF-8 bytes; the rest is cut. */
export const REMOTE_TEXT_LIMIT = 64 * 1024
/**
 * At most this much JSON (UTF-8) in a page or a bundle of events; less where the server takes smaller
 * messages (`budget` of `pageOf`, from the server's `limits`).
 */
export const REMOTE_BATCH_BYTES = 400 * 1024
const PAGE_ITEMS = 300

const utf8 = new TextEncoder()
const utf8Decoder = new TextDecoder()

/**
 * `text` cut to `limit` UTF-8 bytes, its start or (`fromEnd`) its end: by bytes, since a text of umlauts
 * or CJK takes two or three times its characters. A character cut in two goes.
 */
function cut(text: string, limit: number, fromEnd: boolean): string | null {
  // Fast ways out: no character takes more than three bytes, none less than one.
  if (text.length * 3 <= limit) return null
  const bytes = utf8.encode(text)
  if (bytes.length <= limit) return null
  const part = fromEnd ? bytes.subarray(bytes.length - limit) : bytes.subarray(0, limit)
  return utf8Decoder.decode(part).replace(/^�+|�+$/g, '')
}

function head(text: string | undefined, limit = REMOTE_TEXT_LIMIT): string | undefined {
  const start = text === undefined ? null : cut(text, limit, false)
  return start === null ? text : `${start}\n… (gekürzt)`
}

function tail(text: string | undefined, limit = REMOTE_TEXT_LIMIT): string | undefined {
  const end = text === undefined ? null : cut(text, limit, true)
  return end === null ? text : `… (gekürzt)\n${end}`
}

/** What `value` takes as JSON on the wire: UTF-8 bytes, so text with umlauts or CJK counts in full. */
export function jsonBytes(value: unknown): number {
  try {
    return value === undefined ? 0 : utf8.encode(JSON.stringify(value)).length
  } catch {
    return Infinity
  }
}

/** The longest text of one field for pages and bundles of `budget` bytes: an item has a few of them. */
export function textLimitFor(budget: number): number {
  return Math.max(1024, Math.min(REMOTE_TEXT_LIMIT, Math.floor(budget / 8)))
}

/**
 * An item as it goes to another device: texts over `limit` cut (prompts and answers at four times
 * that), what only works on the host left out. Images are paths on the host; the pages of MCP Apps
 * load from the host's MCP servers.
 */
export function slimItem(item: ChatItem, limit = REMOTE_TEXT_LIMIT): ChatItem {
  switch (item.kind) {
    case 'user':
      return item.images?.length ? { ...item, images: undefined, text: head(item.text, 4 * limit)! } : { ...item, text: head(item.text, 4 * limit)! }
    case 'assistant':
    case 'thinking':
      return { ...item, text: head(item.text, 4 * limit)! }
    case 'tool': {
      const slim = { ...item, output: tail(item.output, limit), app: undefined, appResult: undefined }
      if (jsonBytes(item.input) > limit) slim.input = undefined
      if (jsonBytes(item.render) > limit) slim.render = undefined
      if (item.changes) {
        slim.changes = item.changes.map((c) => ({ ...c, diff: head(c.diff, limit), oldText: head(c.oldText, limit), newText: head(c.newText, limit) }))
        // Many files changed at once: their whole texts give way first, then the changes themselves.
        if (jsonBytes(slim) > 6 * limit) slim.changes = slim.changes.map((c) => ({ ...c, oldText: undefined, newText: undefined }))
        if (jsonBytes(slim) > 6 * limit) slim.changes = undefined
      }
      return slim
    }
    case 'agent':
      return { ...item, prompt: head(item.prompt, limit), result: head(item.result, limit) }
    default:
      return item
  }
}

/**
 * The items before `before` (the end without it) that fit into one page of `budget` bytes, newest last,
 * slimmed; at least one, so a page always gets on.
 */
export function pageOf(items: readonly ChatItem[], before = items.length, budget = REMOTE_BATCH_BYTES): { items: ChatItem[]; start: number } {
  const end = Math.min(Math.max(0, before), items.length)
  const page: ChatItem[] = []
  let bytes = 0
  let start = end
  const limit = textLimitFor(budget)
  while (start > 0 && page.length < PAGE_ITEMS) {
    const slim = slimItem(items[start - 1], limit)
    const size = jsonBytes(slim)
    if (page.length > 0 && bytes + size > budget) break
    page.push(slim)
    bytes += size
    start--
  }
  return { items: page.reverse(), start }
}

/**
 * The list of chats within `budget` bytes: without previews if need be, then the newest that fit (the
 * pinned ones first). A namespace's chats are mostly far below; a server with small messages isn't.
 */
export function fitChats(chats: RemoteChats, budget: number): RemoteChats {
  if (jsonBytes(chats) <= budget) return chats
  const bare = chats.sessions.map(({ preview: _preview, ...s }) => s)
  const order = [...bare.filter((s) => s.pinned), ...bare.filter((s) => !s.pinned)]
  let bytes = jsonBytes({ ...chats, sessions: [] })
  const kept = new Set<string>()
  for (const s of order) {
    const size = jsonBytes(s) + 1
    if (bytes + size > budget) break
    bytes += size
    kept.add(s.id)
  }
  return { ...chats, sessions: bare.filter((s) => kept.has(s.id)) }
}

export function remoteSession(meta: SessionMeta): RemoteSession {
  const { id, projectId, title, provider, model, createdAt, updatedAt, pinned, cwd, preview } = meta
  return { id, projectId, title, provider, model, createdAt, updatedAt, pinned, cwd, preview }
}

/** The id a chat of another device has in this window's session store; its events and actions go there. */
export function remoteChatId(instance: string, sessionId: string): string {
  return `remote:${instance}:${sessionId}`
}

export function isRemoteChatId(id: string): boolean {
  return id.startsWith('remote:')
}

export function parseRemoteChatId(id: string): { instance: string; sessionId: string } | null {
  const match = /^remote:([^:]+):(.+)$/.exec(id)
  return match ? { instance: match[1], sessionId: match[2] } : null
}
