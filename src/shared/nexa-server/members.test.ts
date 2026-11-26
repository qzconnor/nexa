import { describe, expect, it } from 'vitest'
import { randomNamespaceKey } from './envelope'
import { compareKeys, helloMatches, keepNewest, parseHello, parseKeyShare, ReplayGuard, REPLAY_WINDOW_MS, rotationLeader, type KeyRecord } from './members'
import type { InstanceInfo } from './protocol'

const KEY_A = 'A'.repeat(87)
const KEY_B = 'B'.repeat(87)
const key = (gen: number, id: string): KeyRecord => ({ gen, id, raw: randomNamespaceKey(), createdAt: 0 })

describe('keys', () => {
  it('orders by generation, then by id, so devices that changed at once agree', () => {
    const keys = [key(1, 'aaaaaaaaaaaaaaaa'), key(2, 'zzzzzzzzzzzzzzzz'), key(2, 'bbbbbbbbbbbbbbbb')]
    expect([...keys].sort(compareKeys).map((k) => `${k.gen}${k.id[0]}`)).toEqual(['2b', '2z', '1a'])
  })

  it('keeps the newest few without duplicates', () => {
    const a = key(1, 'aaaaaaaaaaaaaaaa')
    const kept = keepNewest([a, key(2, 'bbbbbbbbbbbbbbbb'), a, key(3, 'cccccccccccccccc')], 2)
    expect(kept.map((k) => k.gen)).toEqual([3, 2])
  })
})

describe('hello', () => {
  const info: InstanceInfo = { id: 'dev1', name: 'Desktop', role: 'host', signKey: KEY_A, dhKey: KEY_B, createdAt: 0, lastSeen: null, online: true }

  it('matches only what the server lists for the sender', () => {
    const hello = { instance: 'dev1', signKey: KEY_A, dhKey: KEY_B }
    expect(helloMatches(hello, 'dev1', info)).toBe(true)
    expect(helloMatches(hello, 'dev2', info)).toBe(false)
    expect(helloMatches(hello, 'dev1', undefined)).toBe(false)
    expect(helloMatches({ ...hello, dhKey: KEY_A }, 'dev1', info)).toBe(false)
    expect(helloMatches({ ...hello, instance: 'dev2' }, 'dev1', info)).toBe(false)
  })

  it('reads `reply` only when it is true', () => {
    const hello = { instance: 'dev1', signKey: KEY_A, dhKey: KEY_B }
    expect(parseHello(hello)?.reply).toBe(false)
    expect(parseHello({ ...hello, reply: 'yes' })?.reply).toBe(false)
    expect(parseHello({ ...hello, reply: true })?.reply).toBe(true)
  })
})

describe('key share', () => {
  it('needs a full key and well-formed members', () => {
    const record = { gen: 2, id: 'a'.repeat(16), raw: randomNamespaceKey(), createdAt: 5 }
    const member = { id: 'dev1', signKey: KEY_A, dhKey: KEY_B, since: 1 }
    expect(parseKeyShare({ key: record, members: [member] })).toEqual({ key: record, members: [member] })
    expect(parseKeyShare({ key: { ...record, raw: 'kurz' }, members: [] })).toBeNull()
    expect(parseKeyShare({ key: record, members: [{ ...member, signKey: 'x' }] })).toBeNull()
    expect(parseKeyShare({ key: record })).toBeNull()
  })
})

describe('rotationLeader', () => {
  const members = [{ id: 'c' }, { id: 'a' }, { id: 'b' }]

  it('is the lowest id among the members online and this device', () => {
    expect(rotationLeader(members, new Set(['a', 'b']), 'c')).toBe('a')
    expect(rotationLeader(members, new Set(['b']), 'c')).toBe('b')
    expect(rotationLeader(members, new Set(), 'c')).toBe('c')
  })
})

describe('ReplayGuard', () => {
  it('takes a message once', () => {
    const guard = new ReplayGuard()
    expect(guard.accept('a', 'm1', 1000, 1000)).toBe(true)
    expect(guard.accept('a', 'm1', 1000, 1001)).toBe(false)
    expect(guard.accept('b', 'm1', 1000, 1001)).toBe(true)
  })

  it('refuses messages far from its clock', () => {
    const guard = new ReplayGuard()
    const now = 10 * REPLAY_WINDOW_MS
    expect(guard.accept('a', 'old', now - REPLAY_WINDOW_MS - 1, now)).toBe(false)
    expect(guard.accept('a', 'ahead', now + REPLAY_WINDOW_MS + 1, now)).toBe(false)
    expect(guard.accept('a', 'edge', now - REPLAY_WINDOW_MS, now)).toBe(true)
  })

  it('forgets ids only once their message is out of the window', () => {
    const guard = new ReplayGuard(100)
    expect(guard.accept('a', 'm1', 1100, 1000)).toBe(true)
    // Still inside the window of its time: remembered.
    expect(guard.accept('a', 'm1', 1100, 1190)).toBe(false)
    // Past the window: refused by its time, whether remembered or not.
    expect(guard.accept('a', 'm1', 1100, 1300)).toBe(false)
  })
})
