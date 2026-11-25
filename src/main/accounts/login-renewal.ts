import { nexaRenewsLogin, type Account, type LoginRenewResult } from '@shared/accounts'
import { PROVIDERS } from '@shared/providers'
import type { AccountService } from './account-service'
import { renewClaudeLogin } from './claude-renewal'

export interface LoginRenewalDeps {
  accounts: Pick<AccountService, 'get' | 'claudePaths' | 'refresh'>
  /** `chat.keepLoginsFresh`: renew expired tokens by itself (by hand it always goes). */
  enabled: () => boolean
  /** The renewal itself; a fake in tests. */
  renew?: typeof renewClaudeLogin
}

/**
 * Keeps the browser logins of Claude accounts fresh, as the Claude Manager does. Claude Code renews an
 * expired access token only when it next starts with the account: until then the limits of a resting
 * account can't be read, and a chat that switches to it waits for the renewal first. Nexa renews it
 * before it asks for the limits, under Claude Code's lock (claude-renewal.ts), so the two never send
 * the same refresh token. Codex renews its own login when its server starts; Nexa leaves it alone.
 */
export class LoginRenewal {
  /** By account id: one renewal at a time, a second caller gets the first one's result. */
  private readonly running = new Map<string, Promise<LoginRenewResult>>()
  private readonly renew: typeof renewClaudeLogin

  constructor(private readonly deps: LoginRenewalDeps) {
    this.renew = deps.renew ?? renewClaudeLogin
  }

  /**
   * Renews the access token of `account` if it ran out, before its limits are asked for. What failed
   * is tried again with the next round of limits; a refresh token Anthropic refused makes the login
   * `dead` (cli-files.ts) and isn't sent again.
   */
  async renewExpired(account: Account): Promise<void> {
    if (!this.deps.enabled() || !nexaRenewsLogin(account) || account.authState !== 'expired') return
    try {
      await this.run(account.id, false)
    } catch (error) {
      console.warn('[login-renewal] renewal failed', error)
    }
  }

  /** „Jetzt erneuern“: a new access token right away, also while the old one still works. */
  async renewNow(accountId: string): Promise<LoginRenewResult> {
    const account = this.deps.accounts.get(accountId)
    if (!nexaRenewsLogin(account)) {
      throw new Error(account.provider === 'claude' ? 'Nur Browser-Logins lassen sich erneuern.' : `${PROVIDERS[account.provider].name} erneuert seinen Login selbst.`)
    }
    if (account.authState === 'missing') throw new Error('Der Account ist nicht angemeldet.')
    return this.run(accountId, true)
  }

  private run(accountId: string, force: boolean): Promise<LoginRenewResult> {
    let pending = this.running.get(accountId)
    if (!pending) {
      pending = this.renew(this.deps.accounts.claudePaths(accountId), { force })
        .then((result) => {
          // Renewed: the account shows its new expiry. Rejected: its login as dead.
          if (result === 'renewed' || result === 'rejected') this.deps.accounts.refresh()
          return result
        })
        .finally(() => this.running.delete(accountId))
      this.running.set(accountId, pending)
    }
    return pending
  }
}
