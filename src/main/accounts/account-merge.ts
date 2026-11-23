import { isSystemAccountId, sameLogin } from '@shared/accounts'
import type { SessionService } from '../services/session-service'
import type { SettingsService } from '../services/settings-service'
import type { AccountService } from './account-service'

/**
 * Folds an account into another with the same login (one person, two config folders): its chats go
 * on with `into`, it stops being the default, and it goes. Its folder stays on disk: conversations
 * saved there are copied over when their chat goes on, and the Claude Manager may still use it.
 */
export async function mergeAccounts(accounts: AccountService, sessions: SessionService, settings: SettingsService, from: string, into: string): Promise<void> {
  if (from === into) return
  if (isSystemAccountId(from)) throw new Error('Den Standard-Account einer CLI gibt es immer.')
  const source = accounts.get(from)
  const target = accounts.get(into)
  if (!sameLogin(source, target)) throw new Error('Die beiden Accounts sind nicht mit demselben Login angemeldet.')
  sessions.reassignAccount(source.provider, from, into)
  if (settings.get().defaults.accounts?.[source.provider] === from) {
    await settings.update({ defaults: { accounts: { [source.provider]: into } } })
  }
  await accounts.remove(from, false)
}
