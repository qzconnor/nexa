import { describe, expect, it } from 'vitest'
import type { Account } from '@shared/accounts'
import { loginAction, loginEndHint, loginEndText, loginStatus, savedHint, tokenText } from './logins'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const HOUR = 3_600_000
const iso = (ms: number) => new Date(ms).toISOString()

function account(patch: Partial<Account> = {}): Account {
  return {
    id: 'a',
    name: 'Arbeit',
    provider: 'claude',
    kind: 'oauth',
    authState: 'ok',
    tokenExpiresAt: iso(NOW + 3 * HOUR),
    loginEndsAt: iso(NOW + 20 * 24 * HOUR),
    tokenSavedAt: iso(NOW - 5 * HOUR),
    renewable: true,
    ...patch,
  } as Account
}

describe('loginStatus', () => {
  it('names the state of browser logins and stored secrets', () => {
    expect(loginStatus(account())).toEqual({ text: 'Angemeldet', tone: 'ok' })
    expect(loginStatus(account({ authState: 'expired' }))).toEqual({ text: 'Token abgelaufen', tone: 'warning' })
    expect(loginStatus(account({ authState: 'dead' }))).toEqual({ text: 'Login abgelaufen', tone: 'error' })
    expect(loginStatus(account({ authState: 'missing' }))).toEqual({ text: 'Nicht angemeldet', tone: 'error' })
    expect(loginStatus(account({ kind: 'token' }))).toEqual({ text: 'Secret hinterlegt', tone: 'ok' })
    expect(loginStatus(account({ kind: 'apiKey', authState: 'missing' }))).toEqual({ text: 'Kein Secret', tone: 'error' })
  })
})

describe('tokenText', () => {
  it('says when the access token runs out or ran out', () => {
    expect(tokenText(account(), NOW)).toBe('läuft ab in 3 Stunden')
    expect(tokenText(account({ tokenExpiresAt: iso(NOW - 2 * HOUR) }), NOW)).toBe('abgelaufen vor 2 Stunden')
    expect(tokenText(account({ tokenExpiresAt: iso(NOW + 10_000) }), NOW)).toBe('läuft gleich ab')
    expect(tokenText(account({ tokenExpiresAt: iso(NOW - 10_000) }), NOW)).toBe('gerade abgelaufen')
  })

  it('knows a setup token holds long and an API key has none', () => {
    expect(tokenText(account({ kind: 'token', tokenExpiresAt: null }), NOW)).toBe('langlebig')
    expect(tokenText(account({ kind: 'apiKey', tokenExpiresAt: null }), NOW)).toBe('–')
    expect(tokenText(account({ tokenExpiresAt: null }), NOW)).toBe('–')
  })
})

describe('loginEndText and loginEndHint', () => {
  it('tells when a Claude login ends and who renews it until then', () => {
    expect(loginEndText(account(), NOW)).toBe('in 20 Tagen')
    expect(loginEndHint(account(), true)).toMatch(/^Bis .+ erneuern Claude Code und Nexa den Access-Token selbst, danach hilft nur neu anmelden\.$/)
    expect(loginEndHint(account(), false)).toContain('erneuert Claude Code den Access-Token')
  })

  it('knows a login without a working refresh token ends with its access token', () => {
    expect(loginEndText(account({ renewable: false }), NOW)).toBe('mit dem Token')
    expect(loginEndText(account({ renewable: false, authState: 'dead' }), NOW)).toBe('beendet')
    expect(loginEndHint(account({ renewable: false }), true)).toContain('hilft nur neu anmelden')
  })

  it('says it doesn’t know when Claude Code saved no end, and leaves Codex to itself', () => {
    expect(loginEndText(account({ loginEndsAt: null }), NOW)).toBe('unbekannt')
    expect(loginEndHint(account({ loginEndsAt: null }), true)).toBe('Claude Code hat kein Ende des Logins gespeichert.')
    expect(loginEndHint(account({ provider: 'codex', loginEndsAt: null }), true)).toBe(
      'Codex erneuert den Access-Token selbst, sobald eine Session startet.',
    )
  })

  it('has nothing to say without a browser login', () => {
    expect(loginEndText(account({ kind: 'token' }), NOW)).toBe('–')
    expect(loginEndText(account({ authState: 'missing' }), NOW)).toBe('–')
    expect(loginEndHint(account({ kind: 'apiKey' }), true)).toBeNull()
  })
})

describe('savedHint', () => {
  it('names who saves the tokens', () => {
    expect(savedHint(account())).toMatch(/^Tokens gespeichert .+, von Claude Code oder Nexa$/)
    expect(savedHint(account({ provider: 'codex' }))).toMatch(/, von Codex$/)
    expect(savedHint(account({ tokenSavedAt: null }))).toBeNull()
  })
})

describe('loginAction', () => {
  it('offers to sign in, to sign in again, or to renew a Claude login now', () => {
    expect(loginAction(account({ authState: 'missing' }))).toBe('login')
    expect(loginAction(account({ authState: 'dead', renewable: false }))).toBe('relogin')
    expect(loginAction(account())).toBe('renew')
    expect(loginAction(account({ kind: 'system', authState: 'expired' }))).toBe('renew')
  })

  it('offers nothing Nexa can’t do', () => {
    expect(loginAction(account({ renewable: false }))).toBeNull()
    expect(loginAction(account({ provider: 'codex' }))).toBeNull()
    expect(loginAction(account({ kind: 'token' }))).toBeNull()
    expect(loginAction(account({ kind: 'apiKey', authState: 'missing' }))).toBeNull()
  })
})
