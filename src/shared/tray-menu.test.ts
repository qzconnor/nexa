import { describe, expect, it } from 'vitest'
import type { Account } from './accounts'
import type { SessionStatus } from './chat'
import { parseTrayMenuAction, trayChats, trayLimits } from './tray-menu'
import type { ProviderUsage } from './types'

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

describe('trayLimits', () => {
  const NOW = 1_000_000_000
  const HOUR = 3600_000
  const account = (id: string, patch: Partial<Account> = {}) =>
    ({ id, name: id, provider: 'claude', kind: 'oauth', color: '#123456', authState: 'ok', identity: { email: `${id}@example.com` }, ...patch }) as Account
  const usage = (accountId: string, usedPercent: number, more: Partial<ProviderUsage> = {}): ProviderUsage => ({
    provider: 'claude',
    accountId,
    windows: [{ key: 'five_hour', label: '5 Stunden', usedPercent, resetsAt: NOW + HOUR }],
    updatedAt: NOW,
    source: 'api',
    ...more,
  })

  it('names the accounts of a CLI with several, the CLI where it has one', () => {
    const accounts = [account('Arbeit'), account('Privat'), account('Codex', { provider: 'codex' })]
    const limits = trayLimits({ accounts, usage: [usage('Arbeit', 40), usage('Privat', 10), usage('Codex', 5)], blocked: [], now: NOW }, ['claude', 'codex'], {
      claude: 'opus',
    })
    expect(limits.map((l) => [l.name, l.color, l.model])).toEqual([
      ['Arbeit', '#123456', 'opus'],
      ['Privat', '#123456', 'opus'],
      ['Codex', undefined, ''],
    ])
  })

  it('leaves out CLIs that are off, API keys, signed-out accounts and those without readings', () => {
    const accounts = [
      account('ok'),
      account('key', { kind: 'apiKey' }),
      account('gone', { authState: 'missing' }),
      account('new'),
      account('codex', { provider: 'codex' }),
    ]
    const limits = trayLimits({ accounts, usage: [usage('ok', 1), usage('key', 1), usage('gone', 1), usage('codex', 1)], blocked: [], now: NOW }, ['claude'], {})
    expect(limits.map((l) => l.accountId)).toEqual(['ok'])
  })

  it('says when an account at its limit is free again', () => {
    const accounts = [account('full'), account('held'), account('free')]
    const limits = trayLimits(
      { accounts, usage: [usage('full', 100), usage('held', 20), usage('free', 99)], blocked: [{ accountId: 'held', until: NOW + 2 * HOUR, estimated: true }], now: NOW },
      ['claude'],
      {},
    )
    expect(limits.map((l) => [l.accountId, l.freeAt, l.estimated])).toEqual([
      ['full', NOW + HOUR, undefined],
      ['held', NOW + 2 * HOUR, true],
      ['free', undefined, undefined],
    ])
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
