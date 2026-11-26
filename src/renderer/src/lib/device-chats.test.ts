import { describe, expect, it } from 'vitest'
import type { RemoteLevel } from '@shared/remote'
import { searchText } from '@shared/search'
import type { SessionMeta, SessionSearchHit } from '@shared/types'
import { chatRefs, chatSources, matchChats, newChatTarget, recentChats, searchedDevices, startsChats, withHits } from './device-chats'
import { chatKey } from './session-tree'

const meta = (id: string, updatedAt: number, extra: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  projectId: 'p',
  title: id,
  titleSource: 'auto',
  provider: 'claude',
  model: '',
  effort: '',
  permissionMode: 'ask',
  createdAt: 0,
  updatedAt,
  cli: {},
  ...extra,
})

const hit = (sessionId: string, snippet = 'im Verlauf'): SessionSearchHit => ({ sessionId, role: 'assistant', provider: 'claude', snippet })

const device = (id: string, state: string, level: RemoteLevel, online = true) => ({ id, name: id.toUpperCase(), online, state, level })

describe('chatSources', () => {
  it('puts this device first, then the other devices whose chats are loaded', () => {
    const sources = chatSources([
      device('laptop', 'ready', 'prompt'),
      device('server', 'loading', 'full'),
      device('alt', 'offline', 'read', false),
      device('tablet', 'ready', 'read'),
      device('locked', 'ready', 'off'),
      device('gone', 'ready', 'full', false),
    ])
    expect(sources).toEqual([
      { id: null, level: 'full', online: true },
      { id: 'laptop', name: 'LAPTOP', level: 'prompt', online: true },
      { id: 'tablet', name: 'TABLET', level: 'read', online: true },
      { id: 'gone', name: 'GONE', level: 'full', online: false },
    ])
    // One gone offline keeps its chats in the list, but isn't asked to search them.
    expect(searchedDevices(sources)).toEqual(['laptop', 'tablet'])
    expect(sources.map(startsChats)).toEqual([true, true, false, true])
  })
})

describe('matchChats', () => {
  const entry = (device: string | null, m: SessionMeta, place = '') => ({ key: chatKey(device, m.id), device, meta: m, text: searchText(m.title, place) })

  it('finds chats of every device by name or conversation, named first, archived after, newest first', () => {
    const entries = [
      entry(null, meta('Server-Umbau', 10)),
      entry('laptop', meta('Server-Umbau Laptop', 30)),
      entry('laptop', meta('alt', 50, { archived: true }), 'Server'),
      entry(null, meta('Notizen', 40)),
      entry('laptop', meta('Notizen', 20)),
    ]
    // The same session id on two devices are two chats: the hit belongs to the laptop's.
    const hits = new Map([[chatKey('laptop', 'Notizen'), hit('Notizen')]])
    const rows = matchChats(entries, ['server'], hits)
    expect(rows.map((r) => [r.key, r.named, r.hit?.snippet ?? null])).toEqual([
      ['laptop:Server-Umbau Laptop', true, null],
      [':Server-Umbau', true, null],
      ['laptop:alt', true, null],
      ['laptop:Notizen', false, 'im Verlauf'],
    ])
    expect(rows[0]!.device).toBe('laptop')
  })

  it('finds nothing without terms', () => {
    expect(matchChats([entry(null, meta('a', 1))], [], new Map())).toEqual([])
  })
})

describe('recentChats', () => {
  it('takes the latest chats of all devices, without the archived', () => {
    const entries = [
      { key: ':a', meta: meta('a', 1) },
      { key: 'laptop:b', meta: meta('b', 5) },
      { key: 'laptop:c', meta: meta('c', 9, { archived: true }) },
      { key: ':d', meta: meta('d', 3) },
    ]
    expect(recentChats(entries, 2).map((e) => e.key)).toEqual(['laptop:b', ':d'])
  })
})

describe('withHits', () => {
  it('adds one device’s hits by chat key and leaves those found before', () => {
    const local = withHits(new Map(), null, [hit('a')])
    const both = withHits(local, 'laptop', [hit('a', 'dort'), hit('b')])
    expect([...both.keys()]).toEqual([':a', 'laptop:a', 'laptop:b'])
    expect(both.get('laptop:a')?.snippet).toBe('dort')
    expect(local.size).toBe(1)
  })
})

describe('chatRefs', () => {
  it('lists this device’s chats first, then each other device’s, without the archived', () => {
    const refs = chatRefs([
      { device: null, metas: [meta('a', 2), meta('b', 1, { archived: true })] },
      { device: 'laptop', metas: [meta('c', 3)] },
    ])
    expect(refs).toEqual([
      { key: ':a', device: null, id: 'a' },
      { key: 'laptop:c', device: 'laptop', id: 'c' },
    ])
  })
})

describe('newChatTarget', () => {
  const levels: Record<string, RemoteLevel> = { laptop: 'prompt', tablet: 'read' }
  const level = (id: string) => levels[id] ?? 'off'

  it('starts in the open chat’s project on its device', () => {
    expect(newChatTarget({ device: null, projectId: 'p' }, level)).toEqual({ device: null, projectId: 'p' })
    expect(newChatTarget({ device: 'laptop', projectId: 'q' }, level)).toEqual({ device: 'laptop', projectId: 'q' })
  })

  it('without an open chat, on this device in the project used last', () => {
    expect(newChatTarget(null, level)).toEqual({ device: null, projectId: null })
  })

  it('is denied on a device that lets this one only read', () => {
    expect(newChatTarget({ device: 'tablet', projectId: 'p' }, level)).toBe('denied')
    expect(newChatTarget({ device: 'gone', projectId: 'p' }, level)).toBe('denied')
  })
})
