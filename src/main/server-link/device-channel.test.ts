import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Member } from '@shared/nexa-server/members'
import type { RelayedMessage } from '@shared/nexa-server/protocol'
import { DeviceChannel, MessageTooLargeError, PART_KIND, payloadLimit, sealedLimit, splitForJson, utf8Length } from './device-channel'
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
  const link = { up: true }
  const channel = (self: Device, other: Device) =>
    new DeviceChannel({
      instance: self.id,
      identity: self.identity,
      member: (id) => (id === other.id ? member(other) : undefined),
      send: (to, kind, id, body) => {
        if (!link.up) return false
        wire.push({ t: 'msg', id, from: self.id, to, kind, body })
        return true
      },
      maxMessageBytes: () => maxMessageBytes,
    })
  return { a, b, wire, link, from: channel(a, b), to: channel(b, a) }
}

/** The whole `send` as the server gets it. */
const sendBytes = (msg: RelayedMessage) => new TextEncoder().encode(JSON.stringify({ t: 'send', id: msg.id, to: msg.to, kind: msg.kind, body: msg.body })).length

/** What a piece of text takes inside a JSON string, in UTF-8 bytes. */
const jsonStringBytes = (text: string) => new TextEncoder().encode(JSON.stringify(text)).length - 2

/** A small server: 4 KiB a message, so a few KB of JSON go in pieces. */
const SMALL = 4 * 1024

/** JSON of every kind of character the pieces have to get right: escapes, umlauts, CJK, emoji. */
const mixed = (length: number) => ({ text: 'Größe "zitiert" C:\\pfad 漢字 😀🎉 '.repeat(length) })

afterEach(() => {
  vi.useRealTimers()
})

describe('splitForJson', () => {
  it('counts quotes and backslashes double, as JSON escapes them', () => {
    expect(splitForJson('""""', 4)).toEqual(['""', '""'])
    expect(splitForJson('\\\\\\', 2)).toEqual(['\\', '\\', '\\'])
    expect(splitForJson('a"b', 3)).toEqual(['a"', 'b'])
  })

  it('counts umlauts, CJK and emoji by their UTF-8 bytes', () => {
    expect(splitForJson('ääää', 4)).toEqual(['ää', 'ää'])
    expect(splitForJson('漢字漢', 6)).toEqual(['漢字', '漢'])
    expect(splitForJson('😀😀😀', 8)).toEqual(['😀😀', '😀'])
  })

  it('never cuts between the two halves of a character', () => {
    const text = 'a😀b🎉🎉c'.repeat(50) + '😀'
    for (let max = 1; max <= 20; max++) {
      const pieces = splitForJson(text, max)
      expect(pieces.join('')).toBe(text)
      for (const piece of pieces) {
        expect(piece.length).toBeGreaterThan(0)
        // No lone half at either end: high surrogates D800–DBFF, low ones DC00–DFFF.
        expect(piece.charCodeAt(piece.length - 1) >= 0xd800 && piece.charCodeAt(piece.length - 1) <= 0xdbff).toBe(false)
        expect(piece.charCodeAt(0) >= 0xdc00 && piece.charCodeAt(0) <= 0xdfff).toBe(false)
      }
    }
  })

  it('keeps each piece within the budget, and fills it', () => {
    // Without emoji: see the case below for those.
    const text = 'Größe "zitiert" C:\\pfad 漢字 '.repeat(200)
    for (const max of [3, 7, 64, 1000]) {
      const pieces = splitForJson(text, max)
      expect(pieces.join('')).toBe(text)
      for (const piece of pieces) expect(jsonStringBytes(piece)).toBeLessThanOrEqual(max)
      // Only the last one may be short by more than a character's width.
      for (const piece of pieces.slice(0, -1)) expect(jsonStringBytes(piece)).toBeGreaterThan(max - 3)
    }
  })

  // A pair that doesn't fit whole starts the next piece: half of it let in took the piece over the budget.
  it('keeps a piece within the budget when an emoji comes at its end', () => {
    expect(splitForJson('abc😀d', 5)).toEqual(['abc', '😀d'])
    const text = 'a😀b🎉🎉c'.repeat(50)
    for (let max = 4; max <= 20; max++) for (const piece of splitForJson(text, max)) expect(jsonStringBytes(piece)).toBeLessThanOrEqual(max)
  })

  // JSON writes these longer than UTF-8 does: \n as two bytes, other control characters and a lone
  // surrogate as \uXXXX. Counted as UTF-8, a piece full of them went far over the budget.
  it('counts what JSON escapes at its escaped length', () => {
    const text = 'a\nb\u0001c\ud800d\t"e\\'.repeat(40)
    for (let max = 6; max <= 30; max++) {
      const pieces = splitForJson(text, max)
      expect(pieces.join('')).toBe(text)
      for (const piece of pieces) expect(jsonStringBytes(piece)).toBeLessThanOrEqual(max)
    }
  })

  it('gives one piece of an empty text, and of a character larger than the budget', () => {
    expect(splitForJson('', 10)).toEqual([''])
    expect(splitForJson('漢', 1)).toEqual(['漢'])
    expect(splitForJson('😀', 1)).toEqual(['😀'])
  })

  it('counts bytes as UTF-8 does', () => {
    for (const text of ['', 'abc', 'Größe', '漢字', '😀🎉', '"\\']) expect(utf8Length(text)).toBe(new TextEncoder().encode(text).length)
  })
})

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
        expect(wire.at(-1)!.kind).toBe('rc.events')
        expect(sendBytes(wire.at(-1)!)).toBeLessThanOrEqual(max)
      }
      // And it uses most of the room: base64 takes a quarter, the rest is little.
      expect(payloadLimit(max)).toBeGreaterThan(max * 0.65)
    }
  })

  it('sends nothing to a device that isn’t a member, or while not connected', async () => {
    const { wire, from, link, b } = await pair()
    expect(await from.send('cccccccccccccccccccccc', 'rc.events', { n: 1 })).toBeNull()
    expect(wire).toEqual([])
    link.up = false
    expect(await from.send(b.id, 'rc.events', { n: 1 })).toBeNull()
    expect(await from.send(b.id, 'rc.events', mixed(2_000))).toBeNull()
    expect(wire).toEqual([])
  })

  it('sends a message over the server’s limit in pieces, each within it, and opens it whole', async () => {
    const { a, b, wire, from, to } = await pair(SMALL)
    const data = mixed(400)
    expect(utf8Length(JSON.stringify(data))).toBeGreaterThan(5 * payloadLimit(SMALL))
    const id = await from.send(b.id, 'rc.response', data)
    expect(id).toEqual(expect.any(String))
    expect(wire.length).toBeGreaterThan(5)
    expect(wire.every((msg) => msg.kind === PART_KIND && msg.from === a.id && msg.id !== id)).toBe(true)
    for (const msg of wire) expect(sendBytes(msg)).toBeLessThanOrEqual(SMALL)

    const opened = await Promise.all(wire.map((msg) => to.receive(msg)))
    // Nothing until the last piece; then the whole message, with its own kind and id.
    expect(opened.slice(0, -1).every((o) => o === null)).toBe(true)
    expect(opened.at(-1)).toEqual({ kind: 'rc.response', id, data })
  })

  it('sends in pieces what the server once refused whole', async () => {
    const { b, wire, from, to } = await pair(16 * 1024)
    const data = { t: 'x'.repeat(sealedLimit(16 * 1024)) }
    const id = await from.send(b.id, 'rc.events', data)
    expect(wire.map((msg) => msg.kind)).toEqual([PART_KIND, PART_KIND])
    const opened = await Promise.all(wire.map((msg) => to.receive(msg)))
    expect(opened[1]).toEqual({ kind: 'rc.events', id, data })
  })

  it('puts the pieces together in whatever order they come', async () => {
    const { b, wire, from, to } = await pair(SMALL)
    const data = mixed(200)
    const id = await from.send(b.id, 'rc.events', data)
    expect(wire.length).toBeGreaterThan(3)
    // Last first, then the rest from the front.
    const shuffled = [wire.at(-1)!, ...wire.slice(0, -1)]
    const opened = []
    for (const msg of shuffled) opened.push(await to.receive(msg))
    expect(opened.slice(0, -1).every((o) => o === null)).toBe(true)
    expect(opened.at(-1)).toEqual({ kind: 'rc.events', id, data })
  })

  it('names the message a piece belongs to, so a refused piece fails its message', async () => {
    const { b, wire, from } = await pair(SMALL)
    const whole = await from.send(b.id, 'rc.request', { m: 'hello', p: {} })
    expect(wire.map((msg) => msg.id)).toEqual([whole])
    expect(from.messageOf(whole!)).toBe(whole)

    const id = await from.send(b.id, 'rc.response', mixed(200))
    const parts = wire.slice(1)
    expect(parts.length).toBeGreaterThan(1)
    expect(new Set(parts.map((msg) => msg.id)).size).toBe(parts.length)
    for (const msg of parts) expect(from.messageOf(msg.id)).toBe(id)
    expect(from.messageOf('unknown-id')).toBe('unknown-id')
  })

  it('drops the pieces of a message whose last one didn’t come in time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { b, wire, from, to } = await pair(SMALL)
    const data = { t: 'x'.repeat(4_000) }
    await from.send(b.id, 'rc.events', data)
    expect(wire).toHaveLength(3)
    expect(await to.receive(wire[0])).toBeNull()
    expect(await to.receive(wire[1])).toBeNull()
    vi.advanceTimersByTime(61_000)
    // The first two are gone: the last one alone makes nothing.
    expect(await to.receive(wire[2])).toBeNull()

    // Within the time the same makes the message.
    const id = await from.send(b.id, 'rc.events', data)
    const again = wire.slice(3)
    expect(await to.receive(again[0])).toBeNull()
    expect(await to.receive(again[1])).toBeNull()
    vi.advanceTimersByTime(59_000)
    expect(await to.receive(again[2])).toEqual({ kind: 'rc.events', id, data })
  })

  it('refuses a message that would take too many pieces instead of sending it', async () => {
    const { b, wire, from } = await pair(16 * 1024)
    // At 16 KiB a piece holds about 11 KB: 64 of them don’t hold 800 KB.
    await expect(from.send(b.id, 'rc.events', { t: 'x'.repeat(800_000) })).rejects.toBeInstanceOf(MessageTooLargeError)
    expect(wire).toEqual([])
    // The next one still goes.
    expect(await from.send(b.id, 'rc.events', { t: 'klein' })).toEqual(expect.any(String))
  })

  it('opens only pieces that make sense: not too many, not pieces of pieces', async () => {
    const { b, wire, from, to } = await pair()
    // A member could send such pieces itself; each is checked on its own.
    const piece = (data: Record<string, unknown>) => ({ m: 'message01', k: 'rc.events', i: 0, n: 2, s: '', ...data })
    const forged = [
      piece({ n: 65 }),
      piece({ n: 1 }),
      piece({ i: 2 }),
      piece({ i: -1 }),
      piece({ i: 0.5 }),
      piece({ k: PART_KIND }),
      piece({ k: 'bad kind' }),
      piece({ m: 'short' }),
      piece({ s: 7 }),
    ]
    for (const data of forged) await from.send(b.id, PART_KIND, data)
    for (const msg of wire) expect(await to.receive(msg)).toBeNull()

    // Pieces of the right shape still make their message; pieces that aren't JSON together make none.
    wire.length = 0
    await from.send(b.id, PART_KIND, piece({ m: 'message02', i: 1, s: '1}' }))
    await from.send(b.id, PART_KIND, piece({ m: 'message02', i: 0, s: '{"a":' }))
    await from.send(b.id, PART_KIND, piece({ m: 'message03', i: 0, s: '{"a":' }))
    await from.send(b.id, PART_KIND, piece({ m: 'message03', i: 1, s: '' }))
    const opened = []
    for (const msg of wire) opened.push(await to.receive(msg))
    expect(opened).toEqual([null, { kind: 'rc.events', id: 'message02', data: { a: 1 } }, null, null])
  })

  it('drops a message whose pieces disagree about how many there are', async () => {
    const { b, wire, from, to } = await pair()
    await from.send(b.id, PART_KIND, { m: 'message01', k: 'rc.events', i: 0, n: 3, s: '{"a":' })
    await from.send(b.id, PART_KIND, { m: 'message01', k: 'rc.events', i: 1, n: 2, s: '1}' })
    await from.send(b.id, PART_KIND, { m: 'message01', k: 'rc.events', i: 2, n: 3, s: '' })
    const opened = []
    for (const msg of wire) opened.push(await to.receive(msg))
    expect(opened).toEqual([null, null, null])
  })

  it('keeps only so many unfinished messages of one member', async () => {
    const { b, wire, from, to } = await pair()
    const id = (n: number) => `message${String(n).padStart(2, '0')}`
    // The first pieces of 17 messages: the oldest one gives way.
    for (let n = 0; n < 17; n++) await from.send(b.id, PART_KIND, { m: id(n), k: 'rc.events', i: 0, n: 2, s: '{"n":' })
    // The second one first: the last piece of the first would begin a message anew and push it out.
    await from.send(b.id, PART_KIND, { m: id(1), k: 'rc.events', i: 1, n: 2, s: '1}' })
    await from.send(b.id, PART_KIND, { m: id(0), k: 'rc.events', i: 1, n: 2, s: '0}' })
    const opened = []
    for (const msg of wire) opened.push(await to.receive(msg))
    expect(opened.slice(0, 17).every((o) => o === null)).toBe(true)
    expect(opened.slice(17)).toEqual([{ kind: 'rc.events', id: id(1), data: { n: 1 } }, null])
  })

  it('keeps the order of what it sends and of what it opens', async () => {
    const { b, a, wire, from, to } = await pair()
    // A large one first: it takes longer to seal than the small ones after it.
    await Promise.all([from.send(b.id, 'rc.events', { n: 0, pad: 'x'.repeat(300_000) }), ...[1, 2, 3, 4].map((n) => from.send(b.id, 'rc.events', { n }))])
    const opened = await Promise.all(wire.map((msg) => to.receive(msg)))
    expect(opened.map((o) => (o?.data as { n: number }).n)).toEqual([0, 1, 2, 3, 4])
    expect(wire.every((msg) => msg.from === a.id)).toBe(true)
  })

  it('keeps the order with a message in pieces among whole ones', async () => {
    const { b, wire, from, to } = await pair(SMALL)
    await Promise.all([from.send(b.id, 'rc.events', { n: 0 }), from.send(b.id, 'rc.events', { n: 1, ...mixed(100) }), from.send(b.id, 'rc.events', { n: 2 })])
    expect(wire[0].kind).toBe('rc.events')
    expect(wire.at(-1)!.kind).toBe('rc.events')
    const opened = await Promise.all(wire.map((msg) => to.receive(msg)))
    expect(opened.filter((o) => o !== null).map((o) => (o!.data as { n: number }).n)).toEqual([0, 1, 2])
  })
})
