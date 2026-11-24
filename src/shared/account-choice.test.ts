import { describe, expect, it } from 'vitest'
import { availability, firstFree, nextAccount, UNKNOWN_RESET_MS, type ChoiceContext } from './account-choice'
import type { Account } from './accounts'
import type { ProviderUsage, UsageWindow } from './types'

const NOW = 1_000_000_000
const HOUR = 60 * 60_000

function account(id: string, patch: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    provider: 'claude',
    kind: 'oauth',
    authState: 'ok',
    identity: { email: `${id}@example.com`, displayName: null, organizationName: null, organizationType: null, subscriptionType: null },
    ...patch,
  } as Account
}

function usage(accountId: string, windows: Partial<UsageWindow>[], limited = false): ProviderUsage {
  return {
    provider: 'claude',
    accountId,
    windows: windows.map((w) => ({ key: 'five_hour', label: '5 Stunden', usedPercent: 0, ...w })),
    limited,
    updatedAt: NOW,
    source: 'session',
  }
}

function ctx(patch: Partial<ChoiceContext> = {}): ChoiceContext {
  return { accounts: [account('a'), account('b'), account('c')], usage: [], blocked: [], now: NOW, ...patch }
}

describe('availability', () => {
  it('is now for an account nothing holds back', () => {
    expect(availability(account('a'), ctx())).toEqual({ at: NOW, estimated: false })
  })

  it('waits for the latest reset of the full windows', () => {
    const at = availability(
      account('a'),
      ctx({ usage: [usage('a', [{ usedPercent: 100, resetsAt: NOW + HOUR }, { key: 'seven_day', usedPercent: 100, resetsAt: NOW + 3 * HOUR }, { key: 'x', usedPercent: 50, resetsAt: NOW + 9 * HOUR }])] }),
    )
    expect(at).toEqual({ at: NOW + 3 * HOUR, estimated: false })
  })

  it('takes a window whose reset has passed as empty', () => {
    expect(availability(account('a'), ctx({ usage: [usage('a', [{ usedPercent: 100, resetsAt: NOW - 1 }], true)] }))?.at).toBe(NOW)
  })

  it('holds a refused account without a full window until its windows reset', () => {
    expect(availability(account('a'), ctx({ usage: [usage('a', [{ usedPercent: 80, resetsAt: NOW + 2 * HOUR }], true)] }))?.at).toBe(NOW + 2 * HOUR)
  })

  it('guesses a reset no CLI named', () => {
    expect(availability(account('a'), ctx({ usage: [usage('a', [{ usedPercent: 100 }])] }))).toEqual({ at: NOW + UNKNOWN_RESET_MS, estimated: true })
  })

  it('keeps a blocked account and the same login in another folder back', () => {
    const accounts = [account('a'), account('a2', { identity: account('a').identity }), account('b')]
    const blocked = [{ accountId: 'a', until: NOW + HOUR }]
    expect(availability(accounts[1]!, ctx({ accounts, blocked }))?.at).toBe(NOW + HOUR)
    expect(availability(accounts[2]!, ctx({ accounts, blocked }))?.at).toBe(NOW)
  })

  it('leaves out API keys and signed out accounts', () => {
    expect(availability(account('k', { kind: 'apiKey' }), ctx())).toBeNull()
    expect(availability(account('m', { authState: 'missing' }), ctx())).toBeNull()
    expect(availability(account('s', { kind: 'system', authState: 'missing' }), ctx())).not.toBeNull()
  })
})

describe('nextAccount', () => {
  it('takes the first free account in the user’s order, never the one at its limit', () => {
    expect(nextAccount(ctx(), 'claude', 'a')?.id).toBe('b')
    expect(nextAccount(ctx(), 'claude', 'b')?.id).toBe('a')
  })

  it('skips accounts at their limit, blocked or of the same login', () => {
    const accounts = [account('a'), account('a2', { identity: account('a').identity }), account('b'), account('c')]
    const choice = nextAccount(
      ctx({ accounts, blocked: [{ accountId: 'b', until: NOW + HOUR }], usage: [usage('c', [{ usedPercent: 40 }])] }),
      'claude',
      'a',
    )
    expect(choice?.id).toBe('c')
  })

  it('finds none when all are held back', () => {
    const blocked = ['b', 'c'].map((accountId) => ({ accountId, until: NOW + HOUR }))
    expect(nextAccount(ctx({ blocked }), 'claude', 'a')).toBeNull()
  })

  it('stays with the CLI and its visible accounts', () => {
    const accounts = [account('a'), account('x', { provider: 'codex' }), account('system', { kind: 'system' })]
    expect(nextAccount(ctx({ accounts }), 'claude', 'a')).toBeNull()
  })
})

describe('firstFree', () => {
  const blocked = [
    { accountId: 'a', until: NOW + 3 * HOUR },
    { accountId: 'b', until: NOW + HOUR, estimated: true },
    { accountId: 'c', until: NOW + 2 * HOUR },
  ]

  it('finds the account that frees up first', () => {
    expect(firstFree(ctx({ blocked }), 'claude', 'a', true)).toMatchObject({ account: { id: 'b' }, at: NOW + HOUR, estimated: true })
  })

  it('looks at the chat’s own account alone without switching', () => {
    expect(firstFree(ctx({ blocked }), 'claude', 'a', false)).toMatchObject({ account: { id: 'a' }, at: NOW + 3 * HOUR })
  })

  it('prefers the chat’s own account on a tie', () => {
    const tie = blocked.map((b) => ({ ...b, until: NOW + HOUR }))
    expect(firstFree(ctx({ blocked: tie }), 'claude', 'c', true)?.account.id).toBe('c')
  })
})
