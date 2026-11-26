import { describe, expect, it } from 'vitest'
import type { SessionStatus } from './chat'
import { parseTrayMenuAction, trayChats } from './tray-menu'

const chat = (id: string, updatedAt: number) => ({ id, title: `Chat ${id}`, projectId: 'p', provider: 'claude' as const, updatedAt })

describe('trayChats', () => {
  const statuses: Record<string, SessionStatus> = { a: 'running', b: 'waiting', c: 'idle', d: 'starting', e: 'waiting', f: 'error' }
  const statusOf = (id: string) => statuses[id] ?? null
  const sessions = [chat('a', 5), chat('b', 1), chat('c', 9), chat('d', 7), chat('e', 3), chat('f', 8)]

  it('lists the chats that wait first, then those that work, the most recent first', () => {
    const { chats, waiting, working } = trayChats(sessions, statusOf, () => 'Projekt')
    expect(chats.map((c) => [c.id, c.status])).toEqual([
      ['e', 'waiting'],
      ['b', 'waiting'],
      ['d', 'working'],
      ['a', 'working'],
    ])
    expect([waiting, working]).toEqual([2, 2])
    expect(chats[0]).toMatchObject({ title: 'Chat e', project: 'Projekt', provider: 'claude' })
  })

  it('counts all of them beyond the limit', () => {
    const { chats, waiting, working } = trayChats(sessions, statusOf, () => '', 3)
    expect(chats.map((c) => c.id)).toEqual(['e', 'b', 'd'])
    expect([waiting, working]).toEqual([2, 2])
  })
})

describe('parseTrayMenuAction', () => {
  it('takes the known actions', () => {
    expect(parseTrayMenuAction({ kind: 'open', extra: 1 })).toEqual({ kind: 'open' })
    expect(parseTrayMenuAction({ kind: 'chat', sessionId: 'x' })).toEqual({ kind: 'chat', sessionId: 'x' })
    expect(parseTrayMenuAction({ kind: 'notifications', enabled: false })).toEqual({ kind: 'notifications', enabled: false })
  })

  it('refuses anything else', () => {
    expect(() => parseTrayMenuAction(null)).toThrow()
    expect(() => parseTrayMenuAction({ kind: 'chat' })).toThrow()
    expect(() => parseTrayMenuAction({ kind: 'notifications', enabled: 'ja' })).toThrow()
    expect(() => parseTrayMenuAction({ kind: 'delete' })).toThrow()
  })
})
