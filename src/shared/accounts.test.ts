import { describe, expect, it } from 'vitest'
import {
  duplicateOf,
  identityLabel,
  isSystemAccountId,
  maskSecret,
  pickAccount,
  planLabel,
  reorderAccounts,
  sameLogin,
  systemAccountId,
  visibleAccounts,
  type AccountIdentity,
} from './accounts'

describe('reorderAccounts', () => {
  const list = [{ id: 'system' }, { id: 'system-codex' }, { id: 'c1' }, { id: 'x1' }, { id: 'c2' }, { id: 'c3' }, { id: 'x2' }]
  const ids = (sorted: { id: string }[]) => sorted.map((a) => a.id)

  it('sorts one CLI’s accounts in their places, the other’s stay', () => {
    expect(ids(reorderAccounts(list, ['c3', 'c1', 'c2']))).toEqual(['system', 'system-codex', 'c3', 'x1', 'c1', 'c2', 'x2'])
  })

  it('leaves accounts that aren’t named where they are', () => {
    expect(ids(reorderAccounts(list, ['x2', 'x1']))).toEqual(['system', 'system-codex', 'c1', 'x2', 'c2', 'c3', 'x1'])
  })

  it('ignores unknown and repeated ids', () => {
    expect(ids(reorderAccounts(list, ['c2', 'gone', 'c2', 'c1']))).toEqual(['system', 'system-codex', 'c2', 'x1', 'c1', 'c3', 'x2'])
  })
})

describe('accounts', () => {
  it('gives each CLI a fixed standard account', () => {
    expect(systemAccountId('claude')).toBe('system')
    expect(systemAccountId('codex')).toBe('system-codex')
    expect(isSystemAccountId('system-codex')).toBe(true)
    expect(isSystemAccountId('3f2a')).toBe(false)
  })

  it('hides the standard account of a CLI once the user added one of their own', () => {
    const system = { id: 'system', provider: 'claude', kind: 'system' } as const
    const codex = { id: 'system-codex', provider: 'codex', kind: 'system' } as const
    const work = { id: 'work', provider: 'claude', kind: 'oauth' } as const
    expect(visibleAccounts([system, codex], 'claude')).toEqual([system])
    expect(visibleAccounts([system, codex, work], 'claude')).toEqual([work])
    expect(visibleAccounts([system, codex, work], 'codex')).toEqual([codex])
    // The standard one is never run with then, also when a chat or the settings still name it.
    expect(pickAccount([system, work], 'claude', ['system', undefined])).toBe('work')
    expect(pickAccount([system], 'claude', ['gone'])).toBe('system')
    expect(pickAccount([system, codex, work], 'codex', ['work'])).toBe('system-codex')
  })

  it('names plans as people know them', () => {
    expect(planLabel('max')).toBe('Max')
    expect(planLabel('chatgpt_plus')).toBe('Plus')
    expect(planLabel('claude_team')).toBe('Team')
    expect(planLabel(null)).toBeNull()
  })

  it('leaves out the personal organization Claude names after the person', () => {
    const identity = { email: 'a@b.de', displayName: null, organizationName: "a@b.de's Organization", organizationType: null, subscriptionType: null }
    expect(identityLabel(identity)).toBe('a@b.de')
    expect(identityLabel({ ...identity, organizationName: 'Firma' })).toBe('a@b.de · Firma')
    expect(identityLabel({ ...identity, email: null, organizationName: null })).toBeNull()
  })

  it('masks a secret', () => {
    expect(maskSecret('sk-ant-oat01-abcdefghijklmnop')).toBe('sk-ant-oat01…mnop')
  })
})

describe('sameLogin and duplicateOf', () => {
  const who = (email: string | null, organizationName: string | null = 'Team GmbH'): AccountIdentity => ({
    email,
    displayName: null,
    organizationName,
    organizationType: null,
    subscriptionType: null,
  })
  const account = (id: string, createdAt: number, identity: AccountIdentity, kind: 'oauth' | 'system' = 'oauth', provider: 'claude' | 'codex' = 'claude') => ({
    id,
    kind,
    provider,
    createdAt,
    identity,
  })

  it('matches the same person in the same organisation', () => {
    expect(sameLogin(account('a', 1, who('A@x.de')), account('b', 2, who('a@x.de')))).toBe(true)
    expect(sameLogin(account('a', 1, who('a@x.de', 'Privat')), account('b', 2, who('a@x.de')))).toBe(false)
    expect(sameLogin(account('a', 1, who('a@x.de')), account('b', 2, who('a@x.de'), 'oauth', 'codex'))).toBe(false)
    expect(sameLogin(account('a', 1, who(null)), account('b', 2, who(null)))).toBe(false)
  })

  it('names the oldest earlier twin, never the standard account', () => {
    const system = account('system', 0, who('a@x.de'), 'system')
    const first = account('first', 5, who('a@x.de'))
    const second = account('second', 3, who('a@x.de'))
    const third = account('third', 9, who('a@x.de'))
    const other = account('other', 1, who('b@x.de'))
    const list = [system, first, second, third, other]
    expect(duplicateOf(list, third)?.id).toBe('second')
    expect(duplicateOf(list, first)?.id).toBe('second')
    expect(duplicateOf(list, second)).toBeNull()
    expect(duplicateOf(list, other)).toBeNull()
    expect(duplicateOf(list, system)).toBeNull()
  })
})
