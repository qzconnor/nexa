import type { Key } from '@shared/nexa-server/auth'
import { openSealed, pairwiseKey, PAIRWISE, parseSealed, randomMessageId, seal, verifyOpened } from '@shared/nexa-server/envelope'
import { ReplayGuard, type Member } from '@shared/nexa-server/members'
import type { RelayedMessage } from '@shared/nexa-server/protocol'
import type { Identity } from './link-store'

/**
 * The largest sealed body this device sends. nexa-server closes the connection on a message over its
 * limit (1 MB unless its admin set another), which would cut off everything else too; this stays well
 * below it, the JSON around the body included.
 */
export const MAX_SEALED_BYTES = 900 * 1024

export class MessageTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`message too large for the relay: ${bytes} bytes`)
  }
}

export interface DeviceChannelDeps {
  instance: string
  identity: Identity
  /** A member of the namespace in this device's own eyes (`Membership`); others get and give nothing. */
  member(id: string): Member | undefined
  /** Relays a sealed body; false when not connected. */
  send(to: string, kind: string, id: string, body: unknown): boolean
  now?: () => number
}

/**
 * Messages between two members other than the membership's own (Remote Control): sealed with the key
 * only these two share (ECDH of their keys, `PAIRWISE`), signed by the sender, each taken once. The
 * server sees who talks to whom and how much, nothing else; other members can't read along either.
 */
export class DeviceChannel {
  private readonly guard = new ReplayGuard()
  private readonly pairKeys = new Map<string, Promise<Key | null>>()
  private sending: Promise<unknown> = Promise.resolve()
  private receiving: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: DeviceChannelDeps) {}

  /**
   * Seals `data` for the member `to` and relays it; the message's id (an answer names it), or null when
   * `to` isn't a member or the connection is down. Throws `MessageTooLargeError` rather than sending
   * what the server would cut the connection for. Messages leave in the order of the calls, however
   * long each one's sealing takes: streamed text has to arrive in its order.
   */
  send(to: string, kind: string, data: unknown): Promise<string | null> {
    const sealed = this.sealFor(to, kind, data)
    // Awaited in turn below; until then a failure (too large) mustn't count as unhandled.
    sealed.catch(() => undefined)
    const sent = this.sending.then(async () => {
      const message = await sealed
      if (!message) return null
      return this.deps.send(to, kind, message.id, message.body) ? message.id : null
    })
    this.sending = sent.catch(() => undefined)
    return sent
  }

  private async sealFor(to: string, kind: string, data: unknown): Promise<{ id: string; body: unknown } | null> {
    const member = this.deps.member(to)
    const key = member && (await this.pairKey(member))
    if (!key) return null
    const id = randomMessageId()
    const body = await seal({
      header: { from: this.deps.instance, to, kind, id },
      keyRef: PAIRWISE,
      key,
      data,
      signKey: this.deps.identity.signPrivate,
      now: this.now(),
    })
    const bytes = JSON.stringify(body).length
    if (bytes > MAX_SEALED_BYTES) throw new MessageTooLargeError(bytes)
    return { id, body }
  }

  /** What a member sealed for this device alone, checked; null for anything else. In the order they came. */
  receive(msg: RelayedMessage): Promise<{ data: unknown } | null> {
    const opened = this.open(msg)
    opened.catch(() => undefined)
    const result = this.receiving.then(() => opened)
    this.receiving = result.catch(() => undefined)
    return result
  }

  private async open(msg: RelayedMessage): Promise<{ data: unknown } | null> {
    if (msg.to !== this.deps.instance) return null
    const member = this.deps.member(msg.from)
    const sealed = parseSealed(msg.body)
    if (!member || sealed?.k !== PAIRWISE) return null
    const key = await this.pairKey(member)
    const opened = key && (await openSealed({ from: msg.from, to: msg.to, kind: msg.kind, id: msg.id }, sealed, key))
    if (!opened || !(await verifyOpened(opened, member.signKey))) return null
    if (!this.guard.accept(msg.from, msg.id, opened.at, this.now())) return null
    return { data: opened.data }
  }

  private pairKey(member: Member): Promise<Key | null> {
    // By id and key: a member taken in anew under the same id (after a key share) has other keys.
    const cacheKey = `${member.id} ${member.dhKey}`
    let key = this.pairKeys.get(cacheKey)
    if (!key) {
      key = pairwiseKey({ id: this.deps.instance, dhPrivate: this.deps.identity.dhPrivate }, { id: member.id, dhKey: member.dhKey }).catch(() => null)
      this.pairKeys.set(cacheKey, key)
    }
    return key
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }
}
