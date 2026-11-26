import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importNamespaceKey, keyIdOf, randomMessageId, randomNamespaceKey, seal } from '@shared/nexa-server/envelope'
import { MessageKind, type KeyRecord } from '@shared/nexa-server/members'
import { BROADCAST, type InstanceInfo, type RelayedMessage } from '@shared/nexa-server/protocol'
import { generateIdentity, type Identity } from './link-store'
import { HELLO_RETRY_MS, Membership, ROTATION_FALLBACK_MS } from './membership'

vi.mock('electron', () => ({ safeStorage: {} }))

interface Device {
  id: string
  identity: Identity
  membership: Membership
  online: boolean
}

/** nexa-server's relay in small: hands each message to the devices online, one after the other. */
class Relay {
  readonly devices = new Map<string, Device>()
  readonly sent: RelayedMessage[] = []
  private queue: RelayedMessage[] = []

  async add(id: string, keys: KeyRecord[], online = true, now?: () => number): Promise<Device> {
    const { identity } = await generateIdentity()
    const device: Device = {
      id,
      identity,
      online,
      membership: new Membership({
        instance: id,
        identity,
        keys,
        members: [],
        now,
        send: (to, kind, msgId, body) => {
          if (!device.online) return false
          const msg = { t: 'msg' as const, id: msgId, from: id, to, kind, body }
          this.sent.push(msg)
          this.queue.push(msg)
          return true
        },
        persist: () => undefined,
        changed: () => undefined,
      }),
    }
    this.devices.set(id, device)
    return device
  }

  infos(view?: (d: Device) => boolean): InstanceInfo[] {
    return [...this.devices.values()].map((d) => ({
      id: d.id,
      name: d.id,
      role: 'host' as const,
      signKey: d.identity.signKey,
      dhKey: d.identity.dhKey,
      createdAt: 0,
      lastSeen: null,
      online: view ? view(d) : d.online,
    }))
  }

  inject(msg: RelayedMessage): void {
    this.queue.push(msg)
  }

  /** Delivers until nothing is left, letting due timers (a leader's rotation) run in between. */
  async settle(): Promise<void> {
    for (let round = 0; round < 200; round++) {
      // Timers that are due, then whatever they and the last message started (WebCrypto runs off the thread).
      await vi.advanceTimersByTimeAsync(1)
      await Promise.all([...this.devices.values()].map((d) => d.membership.idle()))
      const msg = this.queue.shift()
      if (!msg) return
      for (const device of this.devices.values()) {
        if (!device.online || device.id === msg.from) continue
        if (msg.to !== BROADCAST && msg.to !== device.id) continue
        await device.membership.receive(msg)
      }
    }
    throw new Error('the relay did not settle')
  }

  dispose(): void {
    for (const device of this.devices.values()) device.membership.dispose()
  }
}

async function namespaceKey(gen = 1): Promise<KeyRecord> {
  const raw = randomNamespaceKey()
  return { gen, id: await keyIdOf(raw), raw, createdAt: 0 }
}

/** Devices `ids`, all with `key`, that met each other: each one's hello reached the others. */
async function namespaceOf(relay: Relay, ids: string[], key: KeyRecord): Promise<Device[]> {
  const devices: Device[] = []
  for (const id of ids) devices.push(await relay.add(id, [key]))
  for (const device of devices) await device.membership.ready(relay.infos())
  await relay.settle()
  return devices
}

let relay: Relay

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  relay = new Relay()
})

afterEach(() => {
  relay.dispose()
  vi.useRealTimers()
})

describe('Membership', () => {
  it('takes in devices that hold the namespace key, each in the eyes of the other', async () => {
    const key = await namespaceKey()
    const [a, b, c] = await namespaceOf(relay, ['a', 'b', 'c'], key)
    for (const device of [a, b, c]) {
      expect(device.membership.allMembers.map((m) => m.id).sort()).toEqual(['a', 'b', 'c'])
    }
  })

  it('does not take in a device the server made up, nor one that copies a member’s hello', async () => {
    const key = await namespaceKey()
    const [a] = await namespaceOf(relay, ['a', 'b'], key)
    // The server lists `x` with keys of its own, but `x` doesn't hold the namespace key.
    const x = await relay.add('x', [await namespaceKey()])
    await a.membership.ready(relay.infos())
    await x.membership.ready(relay.infos())
    await relay.settle()
    expect(a.membership.isMember('x')).toBe(false)

    // A hello of `b`, relayed as if `x` had sent it, doesn't open: the sender is Associated Data.
    const hello = relay.sent.find((m) => m.from === 'b' && m.kind === MessageKind.hello && m.to === BROADCAST)!
    relay.inject({ ...hello, from: 'x', id: randomMessageId() })
    await relay.settle()
    expect(a.membership.isMember('x')).toBe(false)
  })

  it('does not take in a device that holds the key but whose keys differ from the server’s list', async () => {
    const key = await namespaceKey()
    const [a] = await namespaceOf(relay, ['a'], key)
    const b = await relay.add('b', [key])
    // The server lists other keys for `b` than `b` itself has.
    const other = (await generateIdentity()).identity
    const infos = relay.infos().map((i) => (i.id === 'b' ? { ...i, signKey: other.signKey } : i))
    await a.membership.ready(infos)
    await b.membership.ready(infos)
    await relay.settle()
    expect(a.membership.isMember('b')).toBe(false)
  })

  it('answers a hello once: a replayed one goes unanswered', async () => {
    const key = await namespaceKey()
    await namespaceOf(relay, ['a', 'b'], key)
    const hello = relay.sent.find((m) => m.from === 'b' && m.to === BROADCAST)!
    const before = relay.sent.length
    relay.inject(hello)
    await relay.settle()
    expect(relay.sent.length).toBe(before)
  })

  it('changes the key after a removal and gives it to the remaining members only', async () => {
    const key = await namespaceKey()
    const [a, b, c] = await namespaceOf(relay, ['a', 'b', 'c'], key)
    relay.devices.delete('c')
    await Promise.all([a.membership.removed('c'), b.membership.removed('c')])
    await relay.settle()

    expect(a.membership.currentKey.gen).toBe(2)
    expect(b.membership.currentKey.id).toBe(a.membership.currentKey.id)
    expect(c.membership.currentKey.gen).toBe(1)
    expect(relay.sent.filter((m) => m.kind === MessageKind.keyShare).map((m) => m.to)).toEqual(['b'])
    expect(a.membership.isMember('c')).toBe(false)
  })

  it('takes nobody new under the old key once a member is gone', async () => {
    const key = await namespaceKey()
    const [a, , c] = await namespaceOf(relay, ['a', 'b', 'c'], key)
    relay.devices.delete('c')
    await a.membership.removed('c')
    await relay.settle()

    // `c` still knows the old key; a device it prepared says hello with it.
    const intruder = await relay.add('x', [c.membership.currentKey])
    await a.membership.ready(relay.infos())
    await intruder.membership.ready(relay.infos())
    await relay.settle()
    expect(a.membership.isMember('x')).toBe(false)
  })

  it('brings a device that was away up to date: new key and the removal it missed', async () => {
    const key = await namespaceKey()
    const [a, b, c] = await namespaceOf(relay, ['a', 'b', 'c'], key)
    b.online = false
    relay.devices.delete('c')
    await a.membership.removed('c')
    await relay.settle()
    expect(a.membership.currentKey.gen).toBe(2)

    // `b` comes back: the server's list has no `c`, and `a` hands it the new key after its hello.
    b.online = true
    await b.membership.ready(relay.infos())
    await relay.settle()
    expect(b.membership.currentKey.id).toBe(a.membership.currentKey.id)
    expect(b.membership.isMember('c')).toBe(false)

    // Its own change of key, planned for want of one, doesn't come: it has the new one already.
    await vi.advanceTimersByTimeAsync(ROTATION_FALLBACK_MS + 10_000)
    await relay.settle()
    expect(b.membership.currentKey.id).toBe(a.membership.currentKey.id)
    expect(c.membership.currentKey.gen).toBe(1)
  })

  it('settles on one key when two devices change it at the same moment', async () => {
    const key = await namespaceKey()
    const [a, b] = await namespaceOf(relay, ['a', 'b', 'c'], key)
    // Each believes the other offline, so each leads.
    await a.membership.ready(relay.infos((d) => d.id !== 'b'))
    await b.membership.ready(relay.infos((d) => d.id !== 'a'))
    await relay.settle()
    relay.devices.delete('c')
    const sharesBefore = relay.sent.filter((m) => m.kind === MessageKind.keyShare).length
    await Promise.all([a.membership.removed('c'), b.membership.removed('c')])
    await relay.settle()

    const shares = relay.sent.filter((m) => m.kind === MessageKind.keyShare).slice(sharesBefore)
    expect(shares.map((m) => m.from).sort()).toEqual(['a', 'b'])
    expect(a.membership.currentKey.gen).toBe(2)
    expect(a.membership.currentKey.id).toBe(b.membership.currentKey.id)
  })

  it('makes the new key itself when the leader stays silent', async () => {
    const key = await namespaceKey()
    const [a, b] = await namespaceOf(relay, ['a', 'b', 'c'], key)
    relay.devices.delete('c')
    // `a` leads (lowest id, online), but the server swallows what it sends.
    a.online = false
    await b.membership.removed('c')
    await relay.settle()
    expect(b.membership.currentKey.gen).toBe(1)
    await vi.advanceTimersByTimeAsync(ROTATION_FALLBACK_MS + 10_000)
    await relay.settle()
    expect(b.membership.currentKey.gen).toBe(2)
  })

  it('drops the hello of a device whose clock is off, says why, and takes it in once the clock is right', async () => {
    const key = await namespaceKey()
    const hour = 60 * 60_000
    let behind = hour
    const a = await relay.add('a', [key])
    const b = await relay.add('b', [key], true, () => Date.now() - behind)
    await a.membership.ready(relay.infos())
    await b.membership.ready(relay.infos())
    await relay.settle()
    expect(a.membership.isMember('b')).toBe(false)
    expect(b.membership.isMember('a')).toBe(false)
    const issue = a.membership.issueOf('b')
    expect(issue?.kind).toBe('clock')
    expect(issue?.kind === 'clock' && Math.round(issue.skew / 60_000)).toBe(-60)

    // The user sets the clock: `b` says hello again, `a` takes it in and answers, and `b` takes `a` in.
    behind = 0
    b.membership.askAgain()
    await relay.settle()
    expect(a.membership.isMember('b')).toBe(true)
    expect(b.membership.isMember('a')).toBe(true)
    expect(a.membership.issueOf('b')).toBeNull()
    expect(b.membership.issueOf('a')).toBeNull()
  })

  it('says hello again to a device that is no member yet, ever less often', async () => {
    const key = await namespaceKey()
    const a = await relay.add('a', [key])
    // Paired with the server's invite instead of a pairing code: a key of its own.
    const x = await relay.add('x', [await namespaceKey()])
    await a.membership.ready(relay.infos())
    await x.membership.ready(relay.infos())
    await relay.settle()
    expect(a.membership.issueOf('x')).toEqual({ kind: 'key' })
    expect(x.membership.issueOf('a')).toEqual({ kind: 'key' })

    const asked = () => relay.sent.filter((m) => m.from === 'a' && m.to === 'x').length
    expect(asked()).toBe(0)
    // Asks at 30 s, 90 s, 210 s; looked at a second after the first and well between the others.
    for (const [wait, count] of [
      [HELLO_RETRY_MS + 1_000, 1],
      [HELLO_RETRY_MS, 1],
      [HELLO_RETRY_MS, 2],
      [2 * HELLO_RETRY_MS, 2],
      [2 * HELLO_RETRY_MS, 3],
    ]) {
      await vi.advanceTimersByTimeAsync(wait)
      // Neither answers a hello it can't read, so nothing goes back and forth.
      await relay.settle()
      expect(asked()).toBe(count)
    }
  })

  it('answers a hello sent to it alone, but not an answer', async () => {
    const key = await namespaceKey()
    const a = await relay.add('a', [key])
    const b = await relay.add('b', [key])
    // `a` logged in while `b` was away, so its hello to all never reached `b`.
    b.online = false
    await a.membership.ready(relay.infos((d) => d.id === 'a'))
    await relay.settle()
    b.online = true
    // `b` knows `a`'s keys from the server's list, but not yet that it is online, so only `a` asks.
    b.membership.instanceChanged({ ...relay.infos().find((i) => i.id === 'a')!, online: false })
    // The server's word that `b` is online now; `a` asks it after a while.
    a.membership.instanceChanged(relay.infos().find((i) => i.id === 'b')!)
    await vi.advanceTimersByTimeAsync(HELLO_RETRY_MS)
    await relay.settle()

    expect(a.membership.isMember('b')).toBe(true)
    expect(b.membership.isMember('a')).toBe(true)
    // The ask and its answer, nothing more.
    expect(relay.sent.filter((m) => m.to !== BROADCAST).map((m) => `${m.from}>${m.to}`)).toEqual(['a>b', 'b>a'])
  })

  it('ignores a key share that is not from a member or not sealed for the pair', async () => {
    const key = await namespaceKey()
    const [a] = await namespaceOf(relay, ['a', 'b'], key)
    const fresh = await namespaceKey(9)
    const b = relay.devices.get('b')!
    // Sealed with the namespace key instead of the pairwise one: everyone could have made it.
    const id = randomMessageId()
    const body = await seal({
      header: { from: 'b', to: 'a', kind: MessageKind.keyShare, id },
      keyRef: key.id,
      key: await importNamespaceKey(key.raw),
      data: { key: fresh, members: a.membership.allMembers },
      signKey: b.identity.signPrivate,
    })
    relay.inject({ t: 'msg', id, from: 'b', to: 'a', kind: MessageKind.keyShare, body })
    await relay.settle()
    expect(a.membership.currentKey.gen).toBe(1)
  })
})
