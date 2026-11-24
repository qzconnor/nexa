import { describe, expect, it, vi } from 'vitest'
import type { Account, AuthState, LoginRenewResult } from '@shared/accounts'
import type { ClaudePaths } from './cli-files'

// The real renewal is never reached: every test hands in a fake.
vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, net: { fetch: vi.fn() } }))

const { LoginRenewal } = await import('./login-renewal')

function account(id: string, patch: Partial<Account> = {}): Account {
  return { id, name: id, provider: 'claude', kind: 'oauth', authState: 'expired', renewable: true, ...patch } as Account
}

function setup(list: Account[], { enabled = true, result = 'renewed' as LoginRenewResult } = {}) {
  const renew = vi.fn(async (_paths: Pick<ClaudePaths, 'configDir' | 'credentialsFile'>, _options?: { force?: boolean }) => result)
  const accounts = {
    get: (id: string) => {
      const found = list.find((a) => a.id === id)
      if (!found) throw new Error('Den Account gibt es nicht mehr.')
      return found
    },
    claudePaths: (id: string) => ({ configDir: `C:/profiles/${id}`, credentialsFile: `C:/profiles/${id}/.credentials.json` }) as ClaudePaths,
    refresh: vi.fn(() => list),
  }
  let on = enabled
  const renewal = new LoginRenewal({ accounts, enabled: () => on, renew })
  return { renewal, renew, accounts, switchTo: (value: boolean) => (on = value) }
}

describe('LoginRenewal.renewExpired', () => {
  it('renews the expired token of a Claude browser login, without force, and shows the account anew', async () => {
    const { renewal, renew, accounts } = setup([])
    await renewal.renewExpired(account('a'))
    await renewal.renewExpired(account('system', { kind: 'system' }))

    expect(renew.mock.calls).toEqual([
      [{ configDir: 'C:/profiles/a', credentialsFile: 'C:/profiles/a/.credentials.json' }, { force: false }],
      [{ configDir: 'C:/profiles/system', credentialsFile: 'C:/profiles/system/.credentials.json' }, { force: false }],
    ])
    expect(accounts.refresh).toHaveBeenCalledTimes(2)
  })

  it.each<{ what: string; patch: Partial<Account> }>([
    { what: 'a token that still holds', patch: { authState: 'ok' } },
    { what: 'a dead login', patch: { authState: 'dead', renewable: false } },
    { what: 'an account nobody signed in to', patch: { authState: 'missing' } },
    { what: 'a setup token', patch: { kind: 'token' } },
    { what: 'an API key', patch: { kind: 'apiKey' } },
    // Codex renews its own login when its server starts.
    { what: 'a Codex login', patch: { provider: 'codex' } },
  ])('leaves $what alone', async ({ patch }) => {
    const { renewal, renew } = setup([])
    await renewal.renewExpired(account('a', patch))
    expect(renew).not.toHaveBeenCalled()
  })

  it('does nothing by itself while „Logins frisch halten“ is off', async () => {
    const { renewal, renew, switchTo } = setup([], { enabled: false })
    await renewal.renewExpired(account('a'))
    expect(renew).not.toHaveBeenCalled()

    switchTo(true)
    await renewal.renewExpired(account('a'))
    expect(renew).toHaveBeenCalledOnce()
  })

  it.each<{ result: LoginRenewResult; refreshed: boolean }>([
    // The login is dead now: the account says so.
    { result: 'rejected', refreshed: true },
    // Claude Code renews it, or the network failed: the next round of limits looks again.
    { result: 'busy', refreshed: false },
    { result: 'failed', refreshed: false },
  ])('shows the account anew after $result: $refreshed', async ({ result, refreshed }) => {
    const { renewal, accounts } = setup([], { result })
    await renewal.renewExpired(account('a'))
    expect(accounts.refresh).toHaveBeenCalledTimes(refreshed ? 1 : 0)
  })

  it('keeps an error of the renewal to itself', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { renewal, renew } = setup([])
    renew.mockRejectedValueOnce(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }))

    await expect(renewal.renewExpired(account('a'))).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('LoginRenewal.renewNow', () => {
  it('renews with force, also a token that still holds', async () => {
    const { renewal, renew, accounts } = setup([account('a', { authState: 'ok' })])
    expect(await renewal.renewNow('a')).toBe('renewed')
    expect(renew).toHaveBeenCalledWith(expect.objectContaining({ configDir: 'C:/profiles/a' }), { force: true })
    expect(accounts.refresh).toHaveBeenCalledOnce()
  })

  it('works while „Logins frisch halten“ is off', async () => {
    const { renewal, renew } = setup([account('a')], { enabled: false })
    expect(await renewal.renewNow('a')).toBe('renewed')
    expect(renew).toHaveBeenCalledOnce()
  })

  it('sends one renewal of an account at a time: a second caller gets the first one’s answer', async () => {
    const { renewal, renew } = setup([account('a')])
    let answer: (result: LoginRenewResult) => void = () => undefined
    renew.mockImplementationOnce(() => new Promise<LoginRenewResult>((resolve) => (answer = resolve)))

    const background = renewal.renewExpired(account('a'))
    const byHand = renewal.renewNow('a')
    answer('renewed')

    await background
    expect(await byHand).toBe('renewed')
    expect(renew).toHaveBeenCalledOnce()

    // Done: the next one asks again.
    await renewal.renewNow('a')
    expect(renew).toHaveBeenCalledTimes(2)
  })

  it.each<{ what: string; patch: Partial<Account>; message: string }>([
    { what: 'a setup token', patch: { kind: 'token' }, message: 'Nur Browser-Logins' },
    { what: 'an API key', patch: { kind: 'apiKey' }, message: 'Nur Browser-Logins' },
    { what: 'a Codex login', patch: { provider: 'codex' }, message: 'Codex erneuert seinen Login selbst' },
    { what: 'an account nobody signed in to', patch: { authState: 'missing' as AuthState }, message: 'nicht angemeldet' },
  ])('refuses $what', async ({ patch, message }) => {
    const { renewal, renew } = setup([account('a', patch)])
    await expect(renewal.renewNow('a')).rejects.toThrow(message)
    expect(renew).not.toHaveBeenCalled()
  })

  it('tells when the renewal failed to write the new tokens', async () => {
    const { renewal, renew } = setup([account('a')])
    renew.mockRejectedValueOnce(new Error('EBUSY: resource busy or locked'))
    await expect(renewal.renewNow('a')).rejects.toThrow('EBUSY')
  })
})
