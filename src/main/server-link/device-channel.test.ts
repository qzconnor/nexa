import { describe, expect, it } from 'vitest'
import type { Member } from '@shared/nexa-server/members'
import type { RelayedMessage } from '@shared/nexa-server/protocol'
import { DeviceChannel, MessageTooLargeError, payloadLimit, sealedLimit } from './device-channel'
import { generateIdentity, type Identity } from './link-store'

interface Device {
  id: string
  identity: Identity
}

async function device(id: string): Promise<Device> {
  return { id, identity: (await generateIdentity()).identity }
}

const member = (d: Device): Member => ({ id: d.id, signKey: d.identity.signKey, dhKey: d.identity.dhKey, since: 0 })

/** Two devices that know each other; what `a` sends lands in `wire`, as the server would relay it. */
async function pair(maxMessageBytes = 1024 * 1024) {
  const [a, b] = await Promise.all([device('aaaaaaaaaaaaaaaaaaaaaa'), device('bbbbbbbbbbbbbbbbbbbbbb')])
  const wire: RelayedMessage[] = []
  const channel = (self: Device, other: Device) =>
    new DeviceChannel({
      instance: self.id,
      identity: self.identity,
      member: (id) => (id === other.id ? member(other) : undefined),
      send: (to, kind, id, body) => {
        wire.push({ t: 'msg', id, from: self.id, to, kind, body })
        return true
      },
      maxMessageBytes: () => maxMessageBytes,
    })
  return { a, b, wire, from: channel(a, b), to: channel(b, a) }
}

/** The whole `send` as the server gets it. */
const sendBytes = (msg: RelayedMessage) => new TextEncoder().encode(JSON.stringify({ t: 'send', id: msg.id, to: msg.to, kind: msg.kind, body: msg.body })).length

describe('DeviceChannel', () => {
  it('seals what the payload limit allows below the server’s limit, umlauts and CJK included', async () => {
    for (const max of [16 * 1024, 64 * 1024, 1024 * 1024]) {
      const { b, wire, from } = await pair(max)
      const budget = payloadLimit(max)
      for (const char of ['a', 'ä', '漢']) {
        const bytes = new TextEncoder().encode(char).length
        // JSON of `{"t":"…"}` with as many characters as fit into the budget in UTF-8.
        const data = { t: char.repeat(Math.floor((budget - 10) / bytes)) }
        expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThanOrEqual(budget)
        await from.send(b.id, 'rc.events', data)
        expect(sendBytes(wire.at(-1)!)).toBeLessThanOrEqual(max)
      }
      // And it uses most of the room: base64 takes a quarter, the rest is little.
      expect(payloadLimit(max)).toBeGreaterThan(max * 0.65)
    }
  })

  it('refuses a message over the server’s limit instead of sending it', async () => {
    const { b, wire, from } = await pair(16 * 1024)
    await expect(from.send(b.id, 'rc.events', { t: 'x'.repeat(sealedLimit(16 * 1024)) })).rejects.toBeInstanceOf(MessageTooLargeError)
    expect(wire).toEqual([])
    // The next one still goes.
    expect(await from.send(b.id, 'rc.events', { t: 'klein' })).toEqual(expect.any(String))
  })

  it('keeps the order of what it sends and of what it opens', async () => {
    const { b, a, wire, from, to } = await pair()
    // A large one first: it takes longer to seal than the small ones after it.
    await Promise.all([from.send(b.id, 'rc.events', { n: 0, pad: 'x'.repeat(300_000) }), ...[1, 2, 3, 4].map((n) => from.send(b.id, 'rc.events', { n }))])
    const opened = await Promise.all(wire.map((msg) => to.receive(msg)))
    expect(opened.map((o) => (o?.data as { n: number }).n)).toEqual([0, 1, 2, 3, 4])
    expect(wire.every((msg) => msg.from === a.id)).toBe(true)
  })
})
