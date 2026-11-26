import type { SessionEvent } from '@shared/chat'
import { IpcEvent, IpcInvoke } from '@shared/ipc'
import type { ServerLimits } from '@shared/nexa-server/protocol'
import {
  channelLevel,
  diffList,
  levelAllows,
  LIST_EVENTS,
  MAX_WATCHED_CHATS,
  METHOD_LEVEL,
  parseRemoteRequest,
  RemoteKind,
  REMOTE_EVENTS,
  remoteWindow,
  SESSIONS_OLDER,
  slimItem,
  WATCH_TTL_MS,
  type RemoteErrorBody,
  type RemoteEvent,
  type RemoteHostInfo,
  type RemoteLevel,
  type RemoteRequest,
  type RemoteResponse,
} from '@shared/remote'
import type { RemoteChatRequest } from '@shared/remote-chats'
import type { RemoteController } from '@shared/remote-ipc'
import type { SessionDetail } from '@shared/types'
import { TypedEmitter } from '../lib/typed-emitter'
import { MessageTooLargeError } from '../server-link/device-channel'
import { FILES_EVENTS, isFilesEventFor, NO_FILES_WATCH, queueFilesEvent, watchedBy, type FilesWatch } from './remote-files'

/** Events are bundled this long before they go, so streamed text costs a message per bundle. */
const BATCH_MS = 100
/** Bundles of events take at most this share of the messages a second the server allows (`rateLimit`). */
const EVENTS_RATE_SHARE = 0.25
/** How many sent bundles are remembered, to know whose watch a failed one belongs to. */
const SENT_KEPT = 256
/** A picture for a prompt, as base64 (the host takes at most 20 MB of it). */
const MAX_IMAGE_BASE64 = 28 * 1024 * 1024

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
    /** What the server takes, as it said at login. */
    limits(): ServerLimits
  }
  /** A call of the window API by `from`, answered by the handlers the windows use (`invokeHandler`). */
  invoke(channel: string, args: unknown[], from: string): Promise<unknown>
  /** A request of another device's chat tools (`chats.*`, remote-chats.ts), past the level; none: refused. */
  chats?: (from: string, request: RemoteChatRequest) => Promise<unknown>
  version: string
  log?: (message: string) => void
}

interface Watcher {
  /** The chats whose items and streamed text the device gets. */
  ids: Set<string>
  since: number
  expiry: ReturnType<typeof setTimeout>
  queue: RemoteEvent[]
  flush: ReturnType<typeof setTimeout> | null
  /** What the device has of each list event (`LIST_EVENTS`): its entries by id, as JSON. */
  lists: Map<string, Map<string, string>>
  /** The folders whose changes and branch the device gets (its file panel). */
  files: FilesWatch
}

/** A refusal with its code for the asking device (else a thrown error goes as `failed`). */
export class Refused extends Error {
  constructor(readonly body: RemoteErrorBody) {
    super(body.message)
  }
}

/**
 * This device as a host of Remote Control: answers the calls the other devices of the namespace make of
 * its window API as far as each one's level goes (`channelLevel`), with the handlers its windows use,
 * and sends the devices that watch it its windows' events, bundled. Off until the user turns it on
 * (Einstellungen › Geräte); every call is checked here, whatever the other side believes.
 */
export class RemoteHost extends TypedEmitter<{
  changed: [controllers: RemoteController[]]
  /** What the device watched of the files goes: it stopped watching, or starts anew (`fresh`). */
  dropped: [device: string]
}> {
  private readonly watchers = new Map<string, Watcher>()
  /** Message ids of sent bundles, with the device they went to. */
  private readonly sent = new Map<string, string>()
  /** Messages the server refused before their send returned (and so before they were in `sent`). */
  private readonly early = new Set<string>()

  constructor(private readonly deps: RemoteHostDeps) {
    super()
  }

  /** The devices that watch this one now (Einstellungen › Geräte). */
  controllers(): RemoteController[] {
    return [...this.watchers.entries()].map(([id, w]) => ({ id, name: this.deps.link.deviceName(id) ?? id, since: w.since, level: this.deps.link.level(id) }))
  }

  /** „Trennen“: the device loses its level here and stops getting events. */
  async disconnect(id: string): Promise<void> {
    await this.deps.link.revoke(id)
    this.unwatch(id)
  }

  async onDeviceMessage(from: string, kind: string, id: string, data: unknown): Promise<void> {
    if (kind !== RemoteKind.request) return
    const request = parseRemoteRequest(data)
    if (!request) return this.reply(from, { re: id, e: { code: 'bad-request', message: 'not a request this host knows' } })
    let response: RemoteResponse
    try {
      this.check(from, request)
      // Calls without a result (`sessions:send` and the like) answer null: JSON drops an undefined `r`.
      response = { re: id, r: (await this.handle(from, request)) ?? null }
    } catch (error) {
      const body: RemoteErrorBody = error instanceof Refused ? error.body : { code: 'failed', message: error instanceof Error ? error.message : String(error) }
      response = { re: id, e: body }
    }
    await this.reply(from, response)
  }

  /** What `from` may ask, by its level here; throws `Refused`. */
  private check(from: string, request: RemoteRequest): void {
    const needed = request.m === 'invoke' ? channelLevel(request.p.ch, request.p.args) : METHOD_LEVEL[request.m]
    if (request.m === 'invoke' && needed === null) throw new Refused({ code: 'forbidden', message: `${request.p.ch} is not for other devices` })
    if (!needed) return
    if (!this.deps.link.enabled()) throw new Refused({ code: 'disabled', message: 'remote control is off' })
    if (!levelAllows(this.deps.link.level(from), needed)) throw new Refused({ code: 'forbidden', message: `needs level ${needed}` })
  }

  /**
   * A window event of this device, as it goes out (`onBroadcast`): to every device that watches, a
   * chat's items and text only to those that have it open.
   */
  onBroadcast(channel: string, args: unknown[]): void {
    if (!this.watchers.size || !REMOTE_EVENTS.has(channel)) return
    if (channel === IpcEvent.sessionEvent) {
      const event = args[0] as SessionEvent
      for (const watcher of this.watchers.values()) {
        if (event.type === 'runtime' || watcher.ids.has(event.sessionId)) this.queueSession(watcher, event)
      }
    } else if (FILES_EVENTS.has(channel)) {
      for (const watcher of this.watchers.values()) {
        if (isFilesEventFor(channel, args, watcher.files, watcher.ids)) watcher.queue = queueFilesEvent(watcher.queue, channel, args)
      }
    } else {
      // The newest state of a list or the settings is all that counts: it replaces one still waiting.
      for (const watcher of this.watchers.values()) {
        watcher.queue = watcher.queue.filter((e) => e.ch !== channel)
        watcher.queue.push({ ch: channel, args })
      }
    }
    for (const [id, watcher] of this.watchers) if (watcher.queue.length && !watcher.flush) watcher.flush = setTimeout(() => void this.flush(id), this.batchMs())
  }

  /**
   * The server couldn't pass a message on. A bundle of events lost (the device doesn't keep up, or went
   * meanwhile) leaves a gap in what it shows: its watch ends, and with the next renewal it reads anew.
   */
  onSendFailed(id: string): void {
    const device = this.sent.get(id)
    if (device === undefined) {
      // Perhaps a bundle whose send hasn't returned its id yet: `flush` looks here.
      this.early.add(id)
      if (this.early.size > SENT_KEPT) this.early.delete(this.early.values().next().value!)
      return
    }
    this.sent.delete(id)
    this.onLost(device)
  }

  private onLost(device: string): void {
    this.deps.log?.(`remote: events to ${this.deps.link.deviceName(device) ?? device} lost, its watch ends`)
    this.unwatch(device)
  }

  /** A device went offline or was removed: its watch ends with it. */
  onDeviceStatus(id: string, online: boolean): void {
    if (!online) this.unwatch(id)
  }

  /** Remote Control turned off, or a level lowered: who may no longer read stops getting events. */
  onRemoteChanged(): void {
    for (const id of [...this.watchers.keys()]) if (!this.deps.link.enabled() || !levelAllows(this.deps.link.level(id), 'read')) this.unwatch(id)
    this.emit('changed', this.controllers())
  }

  dispose(): void {
    for (const id of [...this.watchers.keys()]) this.unwatch(id, false)
  }

  private info(from: string): RemoteHostInfo {
    return { name: this.deps.link.selfName(), enabled: this.deps.link.enabled(), level: this.deps.link.level(from), version: this.deps.version }
  }

  private async handle(from: string, request: RemoteRequest): Promise<unknown> {
    switch (request.m) {
      case 'hello':
        return this.info(from)
      case 'watch':
        return { ...this.info(from), renewed: this.watch(from, request.p.ids, request.p.fresh === true) }
      case 'unwatch':
        this.unwatch(from)
        return null
      case 'invoke':
        return this.invoke(from, request.p.ch, request.p.args)
      default:
        // `chats.*`: the setting „Nachrichten zwischen Chats“ and the other checks follow there.
        if (!this.deps.chats) throw new Refused({ code: 'forbidden', message: 'messages between chats are not available there.' })
        return this.deps.chats(from, request)
    }
  }

  private async invoke(from: string, channel: string, args: unknown[]): Promise<unknown> {
    if (channel === IpcInvoke.appSaveImage) {
      // Bytes don't go as JSON: the picture comes as base64.
      const [data, mime] = args
      if (typeof data !== 'string' || data.length > MAX_IMAGE_BASE64) throw new Refused({ code: 'bad-request', message: 'no picture' })
      return this.deps.invoke(channel, [Buffer.from(data, 'base64'), mime], from)
    }
    if (channel === SESSIONS_OLDER) return this.older(from, args)
    const watched = watchedBy(channel, args)
    if (watched) {
      // Without a watch of the device its file events wouldn't go to it, and nothing would end its
      // watching of folders: none begins. Once it watches it reads anew (`renewed` false) and asks again.
      const watcher = this.watchers.get(from)
      if (!watcher) return null
      await this.deps.invoke(channel, args, from)
      watcher.files = { ...watcher.files, ...watched }
      return null
    }
    const result = await this.deps.invoke(channel, args, from)
    if (channel !== IpcInvoke.sessionsOpen) return result
    // From now on the chat's events go to the device; what still waited for it is in the answer, which
    // leaves before the next bundle (a chat still loading on the other side ignores what came before).
    const detail = result as SessionDetail
    const watcher = this.watchers.get(from)
    if (watcher) {
      const id = detail.meta.id
      if (watcher.ids.size < MAX_WATCHED_CHATS) watcher.ids.add(id)
      watcher.queue = watcher.queue.filter((e) => e.ch !== IpcEvent.sessionEvent || !('args' in e) || isOther(e.args[0] as SessionEvent, id))
    }
    // A long chat's newest items only: all of them can be tens of megabytes, more than a request gets through in time.
    const { items, older } = remoteWindow(detail.items, detail.items.length)
    return { ...detail, items, older }
  }

  /** The items before one of a chat, about as many as `sessions:open` gave. */
  private async older(from: string, args: unknown[]): Promise<unknown> {
    const [id, before] = args
    if (typeof id !== 'string' || typeof before !== 'string') throw new Refused({ code: 'bad-request', message: 'session and item expected' })
    // The chat as the host has it now (the same call that opened it here, without its watch).
    const detail = (await this.deps.invoke(IpcInvoke.sessionsOpen, [id], from)) as SessionDetail
    const end = detail.items.findIndex((item) => item.id === before)
    if (end === -1) throw new Refused({ code: 'not-found', message: 'no such item in the chat' })
    return remoteWindow(detail.items, end)
  }

  /** Sets what `from` watches; whether it watched before (else it may have missed events). */
  private watch(from: string, ids: string[], fresh: boolean): boolean {
    let watcher = this.watchers.get(from)
    if (watcher && fresh) {
      // The device starts anew: its lists come whole again, nothing waiting from before, and it asks
      // again for the folders it shows.
      watcher.lists.clear()
      watcher.queue = []
      watcher.files = NO_FILES_WATCH
      this.emit('dropped', from)
    }
    const existed = !!watcher
    if (watcher) clearTimeout(watcher.expiry)
    else {
      watcher = { ids: new Set(), since: Date.now(), expiry: undefined as never, queue: [], flush: null, lists: new Map(), files: NO_FILES_WATCH }
      this.watchers.set(from, watcher)
    }
    watcher.ids = new Set(ids)
    watcher.expiry = setTimeout(() => this.unwatch(from), WATCH_TTL_MS)
    if (!existed) {
      this.deps.log?.(`remote: ${this.deps.link.deviceName(from) ?? from} watches`)
      this.emit('changed', this.controllers())
    }
    return existed && !fresh
  }

  private unwatch(id: string, announce = true): void {
    const watcher = this.watchers.get(id)
    if (!watcher) return
    clearTimeout(watcher.expiry)
    if (watcher.flush) clearTimeout(watcher.flush)
    this.watchers.delete(id)
    this.emit('dropped', id)
    if (announce) this.emit('changed', this.controllers())
  }

  /**
   * Into the device's next bundle: text streamed into the same item joins the last piece, and a newer
   * state of an item or a chat's runtime replaces what was still waiting for it.
   */
  private queueSession(watcher: Watcher, event: SessionEvent): void {
    const q = watcher.queue
    const sessionEvent = (e: RemoteEvent): SessionEvent | null => (e.ch === IpcEvent.sessionEvent && 'args' in e ? (e.args[0] as SessionEvent) : null)
    switch (event.type) {
      case 'delta': {
        const last = q.length ? sessionEvent(q[q.length - 1]) : null
        if (last?.type === 'delta' && last.sessionId === event.sessionId && last.itemId === event.itemId && last.field === event.field) {
          q[q.length - 1] = { ch: IpcEvent.sessionEvent, args: [{ ...last, text: last.text + event.text }] }
          return
        }
        break
      }
      case 'item': {
        const item = slimItem(event.item)
        watcher.queue = q.filter((e) => {
          const s = sessionEvent(e)
          return !(s && s.sessionId === event.sessionId && ((s.type === 'item' && s.item.id === item.id) || (s.type === 'delta' && s.itemId === item.id)))
        })
        watcher.queue.push({ ch: IpcEvent.sessionEvent, args: [{ ...event, item }] })
        return
      }
      case 'runtime':
        watcher.queue = q.filter((e) => {
          const s = sessionEvent(e)
          return !(s?.type === 'runtime' && s.sessionId === event.sessionId)
        })
        watcher.queue.push({ ch: IpcEvent.sessionEvent, args: [event] })
        return
    }
    watcher.queue.push({ ch: IpcEvent.sessionEvent, args: [event] })
  }

  /** Sends what waits for the device, lists as what changed since it got them last. */
  private async flush(id: string): Promise<void> {
    const watcher = this.watchers.get(id)
    if (!watcher) return
    if (watcher.flush) clearTimeout(watcher.flush)
    watcher.flush = null
    const events = watcher.queue.map((event): RemoteEvent => {
      if (!LIST_EVENTS.has(event.ch) || !('args' in event)) return event
      const change = diffList(event.args[0], watcher.lists.get(event.ch) ?? new Map())
      if (!change) return event
      watcher.lists.set(event.ch, change.next)
      return { ch: event.ch, diff: change.diff }
    })
    watcher.queue = []
    if (!events.length) return
    try {
      const sent = await this.deps.link.sendToDevice(id, RemoteKind.events, { events })
      if (sent && this.early.delete(sent)) return this.onLost(id)
      if (sent) this.remember(sent, id)
      // Not connected: the device lost these, and the base of its lists with them.
      else this.unwatch(id)
    } catch (error) {
      const why = error instanceof MessageTooLargeError ? `${error.bytes} bytes` : error instanceof Error ? error.message : String(error)
      this.deps.log?.(`remote: events not sent: ${why}`)
      this.unwatch(id)
    }
  }

  /** Bundles go at most this often, so that they leave room for everything else the server allows. */
  private batchMs(): number {
    return Math.max(BATCH_MS, Math.ceil(1000 / (this.deps.link.limits().rateLimit * EVENTS_RATE_SHARE)))
  }

  private remember(messageId: string, device: string): void {
    this.sent.set(messageId, device)
    if (this.sent.size > SENT_KEPT) this.sent.delete(this.sent.keys().next().value!)
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

/** A chat's event that isn't one of the items of `id` (its runtime stays: the answer may be older). */
function isOther(event: SessionEvent, id: string): boolean {
  return event.type === 'runtime' || event.sessionId !== id
}
