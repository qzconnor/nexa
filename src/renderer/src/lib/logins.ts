import { canLogin, nexaRenewsLogin, usesSecret, type Account } from '@shared/accounts'
import { formatDateTime, formatRelative } from './format'

/** What the table of logins (LoginTable.vue) says about an account: how long its tokens hold. */

export type LoginTone = 'ok' | 'warning' | 'error'

/** „Angemeldet“, „Token abgelaufen“ …, shorter than AccountAuthStatus for a table cell. */
export function loginStatus(account: Account): { text: string; tone: LoginTone } {
  const secret = usesSecret(account.kind)
  switch (account.authState) {
    case 'ok':
      return { text: secret ? 'Secret hinterlegt' : 'Angemeldet', tone: 'ok' }
    case 'expired':
      return { text: 'Token abgelaufen', tone: 'warning' }
    case 'dead':
      return { text: 'Login abgelaufen', tone: 'error' }
    default:
      return { text: secret ? 'Kein Secret' : 'Nicht angemeldet', tone: 'error' }
  }
}

/** „läuft ab in 3 Stunden“, „abgelaufen vor 2 Stunden“; a setup token holds a year. */
export function tokenText(account: Account, now: number): string {
  if (!canLogin(account.kind)) return account.kind === 'token' ? 'langlebig' : '–'
  const at = account.tokenExpiresAt ? Date.parse(account.tokenExpiresAt) : NaN
  if (Number.isNaN(at)) return '–'
  if (Math.abs(at - now) < 45_000) return at > now ? 'läuft gleich ab' : 'gerade abgelaufen'
  return `${at > now ? 'läuft ab' : 'abgelaufen'} ${formatRelative(at, now)}`
}

/** When the browser login itself ends: after that only signing in again helps. */
export function loginEndText(account: Account, now: number): string {
  if (!canLogin(account.kind) || account.authState === 'missing') return '–'
  if (!account.renewable) return account.authState === 'dead' ? 'beendet' : 'mit dem Token'
  const at = account.loginEndsAt ? Date.parse(account.loginEndsAt) : NaN
  return Number.isNaN(at) ? 'unbekannt' : formatRelative(at, now)
}

/** The tooltip of „Login endet“. `keepFresh`: `chat.keepLoginsFresh`, Nexa renews too. */
export function loginEndHint(account: Account, keepFresh: boolean): string | null {
  if (!canLogin(account.kind) || account.authState === 'missing') return null
  if (!account.renewable) return 'Kein Refresh-Token, der noch geht: Läuft der Access-Token ab, hilft nur neu anmelden.'
  if (account.provider === 'codex') return 'Codex erneuert den Access-Token selbst, sobald eine Session startet.'
  if (!account.loginEndsAt) return 'Claude Code hat kein Ende des Logins gespeichert.'
  const who = keepFresh ? 'erneuern Claude Code und Nexa' : 'erneuert Claude Code'
  return `Bis ${formatDateTime(Date.parse(account.loginEndsAt))} ${who} den Access-Token selbst, danach hilft nur neu anmelden.`
}

/** The tooltip of „Zuletzt erneuert“. */
export function savedHint(account: Account): string | null {
  if (!account.tokenSavedAt) return null
  const by = account.provider === 'codex' ? 'von Codex' : 'von Claude Code oder Nexa'
  return `Tokens gespeichert ${formatDateTime(Date.parse(account.tokenSavedAt))}, ${by}`
}

/** What the row offers: signing in (again), a new access token right away, or nothing. */
export function loginAction(account: Account): 'login' | 'relogin' | 'renew' | null {
  if (canLogin(account.kind) && account.authState === 'missing') return 'login'
  if (canLogin(account.kind) && account.authState === 'dead') return 'relogin'
  if (nexaRenewsLogin(account) && account.renewable) return 'renew'
  return null
}
