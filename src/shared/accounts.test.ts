import { describe, expect, it } from 'vitest'
import { identityLabel, isSystemAccountId, maskSecret, planLabel, systemAccountId } from './accounts'

describe('accounts', () => {
  it('gives each CLI a fixed standard account', () => {
    expect(systemAccountId('claude')).toBe('system')
    expect(systemAccountId('codex')).toBe('system-codex')
    expect(isSystemAccountId('system-codex')).toBe(true)
    expect(isSystemAccountId('3f2a')).toBe(false)
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
