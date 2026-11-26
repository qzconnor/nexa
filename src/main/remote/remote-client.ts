import {
  parseRemoteEvents,
  parseRemoteResponse,
  remoteErrorText,
  RemoteKind,
  WATCH_RENEW_MS,
  type RemoteErrorBody,
  type RemoteErrorCode,
  type RemoteEvent,
  type RemoteMethod,
  type RemoteMethods,
} from '@shared/remote'
import type { RemoteWatch } from '@shared/remote-ipc'
import { TypedEmitter } from '../lib/typed-emitter'
import { MessageTooLargeError } from '../server-link/device-channel'

/** How long an answer may take: the host may first read a long chat from disk (`open`). */
const REQUEST_TIMEOUT_MS = 20_000
/** Refusals of the server kept for requests that don't wait yet; they come right after the send. */
const EARLY_KEPT = 64

/** What the server's refusal (`busy`, `unknown-instance`, else `unreachable`) means for a request. */
function sendFailure(code: string): RemoteErrorCode {
  return code === 'busy' ? 'busy' : code === 'unknown-instance' ? 'gone' : 'unreachable'
}

export class RemoteError extends Error {
  constructor(readonly body: RemoteErrorBody) {
    super(remoteErrorText(body))
  }

  static of(code: RemoteErrorCode, message = code): RemoteError {
    return new RemoteError({ code, message })
  }
}

export interface RemoteClientDeps {
  link: {
    sendToDevice(to: string, kind: string, data: unknown): Promise<string | null>
    /** This device is connected to its server. */
    online(): boolean
  }
  log?: (message: string) => void
  timeoutMs?: number
}

interface Pending {
  instance: string
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * This device as a controller: asks other devices for their chats (`shared/remote.ts`) and keeps up
 * the watch of what the windows show of them, so their events come. The host decides what is allowed;
 * this side only passes on what it says.
 */
export class RemoteClient extends TypedEmitter<{ events: [instance: string, events: RemoteEvent[]]; resync: [instance: string] }> {
  private readonly pending = new Map<string, Pending>()
  /** Per device the chats watched there, as all windows together ask. */
  private watching = new Map<string, string[]>()
  /**
   * Devices whose watch the windows just started: they read the chats right after, so a host that knew
   * no watch yet is no news. Any later renewal it doesn't know means it lost the watch (or never got it).
   */
  private readonly fresh = new Set<string>()
  private renewTimer: ReturnType<typeof setInterval> | null = null
  /** What the server refused to pass on before its request was waiting for an answer, by message id. */
  private readonly early = new Map<string, string>()

  constructor(private readonly deps: RemoteClientDeps) {
    super()
  }

  async request<M extends RemoteMethod>(instance: string, m: M, p: RemoteMethods[M]['params']): Promise<RemoteMethods[M]['result']> {
    if (!this.deps.link.online()) throw RemoteError.of('offline')
    let id: string | null
    try {
      id = await this.deps.link.sendToDevice(instance, RemoteKind.request, { m, p })
    } catch (error) {
      if (error instanceof MessageTooLargeError) throw RemoteError.of('too-large')
      throw error
    }
    if (!id) throw RemoteError.of(this.deps.link.online() ? 'unreachable' : 'offline')
    const failed = this.early.get(id)
    if (failed !== undefined) {
      this.early.delete(id)
      throw RemoteError.of(sendFailure(failed))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(RemoteError.of('timeout'))
      }, this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS)
      this.pending.set(id, { instance, resolve: resolve as (value: unknown) => void, reject, timer })
    })
  }

  /** An `rc.response` or `rc.events` of another device. */
  onDeviceMessage(from: string, kind: string, data: unknown): void {
    if (kind === RemoteKind.response) {
      const response = parseRemoteResponse(data)
      const pending = response && this.pending.get(response.re)
      // Only the device asked answers: another member can't settle a request it never got.
      if (!response || !pending || pending.instance !== from) return
      this.settle(response.re, pending)
      if ('e' in response) pending.reject(new RemoteError(response.e))
      else pending.resolve(response.r)
    } else if (kind === RemoteKind.events && this.watching.has(from)) {
      const events = parseRemoteEvents(data)
      if (events?.length) this.emit('events', from, events)
    }
  }

  /**
   * The server couldn't pass a request on: `code` as it said (`busy`: the device doesn't keep up,
   * `unknown-instance`: it was removed, else it isn't connected).
   */
  onSendFailed(id: string, code: string): void {
    const pending = this.pending.get(id)
    if (!pending) {
      // Before the request knew its id (`request` still on its way back from sending): it looks here.
      this.early.set(id, code)
      if (this.early.size > EARLY_KEPT) this.early.delete(this.early.keys().next().value!)
      return
    }
    this.settle(id, pending)
    pending.reject(RemoteError.of(sendFailure(code)))
  }

  /**
   * What all windows together watch of other devices. A changed list goes to the device at once; the
   * order of requests holds, so a chat opened after its watch misses none of its events.
   */
  setWatch(list: readonly RemoteWatch[]): void {
    const next = new Map<string, string[]>()
    for (const { instance, ids } of list) next.set(instance, [...new Set([...(next.get(instance) ?? []), ...ids])].sort())
    for (const instance of this.watching.keys()) {
      if (next.has(instance)) continue
      this.fresh.delete(instance)
      void this.request(instance, 'unwatch', {}).catch(() => undefined)
    }
    const previous = this.watching
    this.watching = next
    for (const [instance, ids] of next) {
      if (!previous.has(instance)) this.fresh.add(instance)
      if (previous.get(instance)?.join() !== ids.join()) this.renew(instance)
    }
    if (next.size && !this.renewTimer) this.renewTimer = setInterval(() => this.renewAll(), WATCH_RENEW_MS)
    if (!next.size && this.renewTimer) {
      clearInterval(this.renewTimer)
      this.renewTimer = null
    }
  }

  /** This device logged in again: the watches may have run out meanwhile. */
  onConnected(): void {
    this.renewAll()
  }

  /** A device came back: it lost what this one watched there when it went. */
  onDeviceStatus(instance: string, online: boolean): void {
    if (online && this.watching.has(instance)) this.renew(instance)
  }

  dispose(): void {
    if (this.renewTimer) clearInterval(this.renewTimer)
    this.renewTimer = null
    for (const instance of this.watching.keys()) void this.request(instance, 'unwatch', {}).catch(() => undefined)
    this.watching.clear()
    this.fresh.clear()
    for (const [id, pending] of this.pending) {
      this.settle(id, pending)
      pending.reject(RemoteError.of('offline'))
    }
  }

  private renewAll(): void {
    for (const instance of this.watching.keys()) this.renew(instance)
  }

  private renew(instance: string): void {
    const ids = this.watching.get(instance)
    if (!ids || !this.deps.link.online()) return
    this.request(instance, 'watch', { ids }).then(
      ({ renewed }) => {
        const fresh = this.fresh.delete(instance)
        if (!renewed && !fresh && this.watching.has(instance)) this.emit('resync', instance)
      },
      (error: unknown) => {
        this.fresh.delete(instance)
        this.deps.log?.(`remote: watch at ${instance} failed: ${error instanceof Error ? error.message : String(error)}`)
      },
    )
  }

  private settle(id: string, pending: Pending): void {
    clearTimeout(pending.timer)
    this.pending.delete(id)
  }
}
