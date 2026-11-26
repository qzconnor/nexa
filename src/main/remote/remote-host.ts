import type { InteractionResponse, SessionEvent, SessionRuntime } from '@shared/chat'
import {
  levelAllows,
  METHOD_LEVEL,
  pageOf,
  parseRemoteRequest,
  remoteSession,
  RemoteKind,
  REMOTE_BATCH_BYTES,
  slimItem,
  WATCH_TTL_MS,
  type RemoteChats,
  type RemoteErrorBody,
  type RemoteEvent,
  type RemoteLevel,
  type RemoteRequest,
  type RemoteResponse,
} from '@shared/remote'
import type { RemoteController } from '@shared/remote-ipc'
import type { Project, ProjectSection, SessionDetail, SessionMeta } from '@shared/types'
import { TypedEmitter } from '../lib/typed-emitter'
import { MessageTooLargeError } from '../server-link/device-channel'

/** Events of a chat are bundled this long before they go, so streamed text costs a message per bundle. */
const BATCH_MS = 100
/** The list of chats changes with every turn; a controller reads it anew at most this often. */
const CHATS_DEBOUNCE_MS = 2_000

export interface RemoteHostDeps {
  link: {
    sendToDevice(to: string, kind: string, data: unknown): Promise<string | null>
    selfName(): string
    deviceName(id: string): string | null
    /** What this device lets `id` do; `off` while Remote Control is off. */
    level(id: string): RemoteLevel
    enabled(): boolean
    /** „Trennen“: the device may do nothing here until the user lets it again. */
    revoke(id: string): Promise<void>
  }
  sessions: {
    list(): SessionMeta[]
    open(id: string): Promise<SessionDetail>
    send(id: string, text: string): Promise<void>
    interrupt(id: string): Promise<void>
    respond(id: string, itemId: string, response: InteractionResponse): Promise<void>
    runtimes(): Record<string, SessionRuntime>
  }
  projects(): { projects: Project[]; sections: ProjectSection[] }
  version: string
  log?: (message: string) => void
}

interface Watcher {
  ids: Set<string>
  since: number
  expiry: ReturnType<typeof setTimeout>
  queue: RemoteEvent[]
  flush: ReturnType<typeof setTimeout> | null
}

class NotFound extends Error {}

/**
 * This device as a host of Remote Control: answers the requests of the other devices of the namespace
 * as far as each one's level goes (`shared/remote.ts`), and sends the devices that watch chats their
 * events, bundled. Off until the user turns it on (Einstellungen › Geräte); every request is checked
 * against the level here, whatever the other side believes.
 */
export class RemoteHost extends TypedEmitter<{ changed: [controllers: RemoteController[]] }> {
  private readonly watchers = new Map<string, Watcher>()
  private chatsTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: RemoteHostDeps) {
    super()
  }

  /** The devices that watch chats here now, for the bar „wird gesteuert“. */
  controllers(): RemoteController[] {
    return [...this.watchers.entries()].map(([id, w]) => ({ id, name: this.deps.link.deviceName(id) ?? id, since: w.since, level: this.deps.link.level(id) }))
  }

  /** „Trennen“ in the bar: the device loses its level here and stops getting events. */
  async disconnect(id: string): Promise<void> {
    await this.deps.link.revoke(id)
    this.unwatch(id)
  }

  async onDeviceMessage(from: string, kind: string, id: string, data: unknown): Promise<void> {
    if (kind !== RemoteKind.request) return
    const request = parseRemoteRequest(data)
    if (!request) return this.reply(from, { re: id, e: { code: 'bad-request', message: 'not a request this host knows' } })
    const needed = METHOD_LEVEL[request.m]
    if (needed && !this.deps.link.enabled()) return this.reply(from, { re: id, e: { code: 'disabled', message: 'remote control is off' } })
    if (needed && !levelAllows(this.deps.link.level(from), needed)) {
      return this.reply(from, { re: id, e: { code: 'forbidden', message: `needs level ${needed}` } })
    }
    let response: RemoteResponse
    try {
      response = { re: id, r: await this.handle(from, request) }
    } catch (error) {
      const body: RemoteErrorBody =
        error instanceof NotFound
          ? { code: 'not-found', message: 'no such chat' }
          : { code: 'failed', message: error instanceof Error ? error.message : String(error) }
      response = { re: id, e: body }
    }
    await this.reply(from, response)
  }

  /** A chat's event at this host: to every device that watches it (the state of chats to all that watch). */
  onSessionEvent(event: SessionEvent): void {
    for (const watcher of this.watchers.values()) {
      if (event.type === 'runtime' || watcher.ids.has(event.sessionId)) this.queue(watcher, event)
    }
    for (const [id, watcher] of this.watchers) if (watcher.queue.length && !watcher.flush) watcher.flush = setTimeout(() => void this.flush(id), BATCH_MS)
  }

  /** The list of chats changed (a title, a new chat, the order): the watching devices read it anew. */
  onSessionsChanged(): void {
    if (this.chatsTimer || !this.watchers.size) return
    this.chatsTimer = setTimeout(() => {
      this.chatsTimer = null
      for (const watcher of this.watchers.values()) this.queue(watcher, { type: 'chats' })
      for (const id of this.watchers.keys()) void this.flush(id)
    }, CHATS_DEBOUNCE_MS)
  }

  /** A device went offline or was removed: its watch ends with it. */
  onDeviceStatus(id: string, online: boolean): void {
    if (!online) this.unwatch(id)
  }

  /** Remote Control turned off, or a level lowered: who may no longer read stops getting events. */
  onRemoteChanged(): void {
    for (const id of [...this.watchers.keys()]) if (!levelAllows(this.deps.link.level(id), 'read')) this.unwatch(id)
    this.emit('changed', this.controllers())
  }

  dispose(): void {
    for (const id of [...this.watchers.keys()]) this.unwatch(id, false)
    if (this.chatsTimer) clearTimeout(this.chatsTimer)
    this.chatsTimer = null
  }

  private async handle(from: string, request: RemoteRequest): Promise<unknown> {
    const { sessions } = this.deps
    switch (request.m) {
      case 'hello': {
        const level = this.deps.link.level(from)
        return { name: this.deps.link.selfName(), enabled: this.deps.link.enabled(), level, version: this.deps.version }
      }
      case 'chats':
        return this.chats()
      case 'open': {
        this.known(request.p.id)
        const detail = await sessions.open(request.p.id)
        const page = pageOf(detail.items, request.p.before)
        // The page holds what still waited to go; the answer leaves before the next bundle, and a chat
        // that is still loading on the other side ignores what came before it (as a window does).
        const watcher = this.watchers.get(from)
        if (watcher && request.p.before === undefined) {
          const id = request.p.id
          watcher.queue = watcher.queue.filter((e) => e.type === 'chats' || e.type === 'runtime' || e.sessionId !== id)
        }
        return { session: remoteSession(detail.meta), items: page.items, start: page.start, total: detail.items.length, runtime: detail.runtime }
      }
      case 'watch':
        return { renewed: this.watch(from, request.p.ids) }
      case 'unwatch':
        this.unwatch(from)
        return null
      case 'send':
        this.known(request.p.id)
        await sessions.send(request.p.id, request.p.text)
        return null
      case 'interrupt':
        this.known(request.p.id)
        await sessions.interrupt(request.p.id)
        return null
      case 'respond':
        this.known(request.p.id)
        await sessions.respond(request.p.id, request.p.itemId, request.p.response)
        return null
    }
  }

  private chats(): RemoteChats {
    const { projects, sections } = this.deps.projects()
    const sectionNames = new Map(sections.map((s) => [s.id, s.name]))
    return {
      projects: projects.map((p) => {
        const section = p.sectionId ? sectionNames.get(p.sectionId) : undefined
        return { id: p.id, name: p.name, path: p.path, ...(section ? { section } : {}) }
      }),
      sessions: this.deps.sessions
        .list()
        .filter((m) => !m.archived)
        .map(remoteSession),
      runtimes: this.deps.sessions.runtimes(),
    }
  }

  /** Archived chats count as gone: the list on the other side doesn't show them either. */
  private known(id: string): void {
    if (!this.deps.sessions.list().some((m) => m.id === id && !m.archived)) throw new NotFound()
  }

  /** Sets what `from` watches; whether it watched before (else it may have missed events). */
  private watch(from: string, ids: string[]): boolean {
    const existing = this.watchers.get(from)
    if (existing) clearTimeout(existing.expiry)
    const watcher: Watcher = existing ?? { ids: new Set(), since: Date.now(), expiry: undefined as never, queue: [], flush: null }
    watcher.ids = new Set(ids)
    watcher.expiry = setTimeout(() => this.unwatch(from), WATCH_TTL_MS)
    this.watchers.set(from, watcher)
    if (!existing) {
      this.deps.log?.(`remote: ${this.deps.link.deviceName(from) ?? from} watches`)
      this.emit('changed', this.controllers())
    }
    return !!existing
  }

  private unwatch(id: string, announce = true): void {
    const watcher = this.watchers.get(id)
    if (!watcher) return
    clearTimeout(watcher.expiry)
    if (watcher.flush) clearTimeout(watcher.flush)
    this.watchers.delete(id)
    if (announce) this.emit('changed', this.controllers())
  }

  /**
   * Into the device's next bundle: text streamed into the same item joins the last piece, and a newer
   * state of an item or a chat's runtime replaces what was still waiting for it.
   */
  private queue(watcher: Watcher, event: RemoteEvent): void {
    const q = watcher.queue
    switch (event.type) {
      case 'delta': {
        const last = q[q.length - 1]
        if (last?.type === 'delta' && last.sessionId === event.sessionId && last.itemId === event.itemId && last.field === event.field) {
          q[q.length - 1] = { ...last, text: last.text + event.text }
          return
        }
        q.push(event)
        return
      }
      case 'item': {
        const item = slimItem(event.item)
        watcher.queue = q.filter(
          (e) => !((e.type === 'item' && e.sessionId === event.sessionId && e.item.id === item.id) || (e.type === 'delta' && e.sessionId === event.sessionId && e.itemId === item.id)),
        )
        watcher.queue.push({ ...event, item })
        return
      }
      case 'runtime':
        watcher.queue = q.filter((e) => !(e.type === 'runtime' && e.sessionId === event.sessionId))
        watcher.queue.push(event)
        return
      case 'chats':
        if (!q.some((e) => e.type === 'chats')) q.push(event)
        return
      default:
        q.push(event)
    }
  }

  /** Sends what waits for the device, in bundles the relay passes on. */
  private async flush(id: string): Promise<void> {
    const watcher = this.watchers.get(id)
    if (!watcher) return
    if (watcher.flush) clearTimeout(watcher.flush)
    watcher.flush = null
    const events = watcher.queue
    watcher.queue = []
    for (const bundle of bundles(events)) {
      try {
        await this.deps.link.sendToDevice(id, RemoteKind.events, { events: bundle })
      } catch (error) {
        // One event too large on its own (an item the slimming couldn't bring down) is left out; the
        // device reads the chat anew when it opens it.
        const why = error instanceof MessageTooLargeError ? `${error.bytes} bytes` : error instanceof Error ? error.message : String(error)
        this.deps.log?.(`remote: events not sent: ${why}`)
      }
    }
  }

  private async reply(to: string, response: RemoteResponse): Promise<void> {
    try {
      await this.deps.link.sendToDevice(to, RemoteKind.response, response)
    } catch (error) {
      if (!(error instanceof MessageTooLargeError)) throw error
      await this.deps.link.sendToDevice(to, RemoteKind.response, { re: response.re, e: { code: 'too-large', message: `${error.bytes} bytes` } })
    }
  }
}

/** Events in bundles of about `REMOTE_BATCH_BYTES` of JSON each, in their order. */
function bundles(events: readonly RemoteEvent[]): RemoteEvent[][] {
  const result: RemoteEvent[][] = []
  let current: RemoteEvent[] = []
  let bytes = 0
  for (const event of events) {
    const size = JSON.stringify(event).length
    if (current.length && bytes + size > REMOTE_BATCH_BYTES) {
      result.push(current)
      current = []
      bytes = 0
    }
    current.push(event)
    bytes += size
  }
  if (current.length) result.push(current)
  return result
}
