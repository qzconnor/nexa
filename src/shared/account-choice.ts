import { sameLogin, visibleAccounts, type Account } from './accounts'
import type { ProviderId } from './chat'
import type { ProviderUsage } from './types'

/**
 * Which account a chat goes on with once its account hit a plan limit, and when one is free again
 * (as „Account wechseln“ in the Claude Manager). The order of the accounts list is the order they
 * are tried in; the user sorts it under Settings › Accounts.
 */

/** A limit whose reset no CLI reported is tried again after this long (Claude's shortest window). */
export const UNKNOWN_RESET_MS = 5 * 60 * 60_000

/** An account Nexa left at its limit, and until when it leaves it alone. */
export interface BlockedAccount {
  accountId: string
  until: number
  /** `until` is a guess (UNKNOWN_RESET_MS): no CLI said when the limit resets. */
  estimated?: boolean
}

export interface ChoiceContext {
  /** All accounts, in the user's order. */
  accounts: readonly Account[]
  usage: readonly ProviderUsage[]
  blocked: readonly BlockedAccount[]
  now: number
}

/** When an account can take a prompt again: `now` when nothing holds it back. */
export interface Availability {
  at: number
  estimated: boolean
}

/**
 * Accounts a chat may go on with by itself: signed in and on a plan. An API key bills every token,
 * so a limit never moves a chat onto one; the user picks it by hand if they want to.
 */
export function switchable(account: Account): boolean {
  if (account.kind === 'apiKey') return false
  return account.kind === 'system' || (account.authState !== 'missing' && account.authState !== 'dead')
}

/**
 * When `account` is free again: after Nexa's block of it (or of the same login in another folder) and
 * after its full windows. Null: it can't go on by itself at all (signed out, an API key).
 */
export function availability(account: Account, ctx: ChoiceContext): Availability | null {
  if (!switchable(account)) return null
  let at = ctx.now
  let estimated = false
  const later = (time: number, guessed: boolean) => {
    if (time > at) {
      at = time
      estimated = guessed
    }
  }
  for (const block of ctx.blocked) {
    const holder = ctx.accounts.find((a) => a.id === block.accountId)
    // One login in two config folders shares its limits.
    if (block.accountId === account.id || (holder && sameLogin(holder, account))) later(block.until, !!block.estimated)
  }
  const usage = ctx.usage.find((u) => u.accountId === account.id)
  if (usage) {
    // A window whose reset has passed is empty again, whatever the last reading said.
    const live = usage.windows.filter((w) => !w.resetsAt || w.resetsAt > ctx.now)
    const full = live.filter((w) => w.usedPercent >= 100)
    // `limited` without a full window (Claude's refusal names none): until the windows it knows reset.
    const holding = full.length ? full : usage.limited ? live : []
    for (const window of holding) later(window.resetsAt ?? ctx.now + UNKNOWN_RESET_MS, !window.resetsAt)
  }
  return { at, estimated }
}

/** The accounts of a CLI a chat may go on with, in the user's order. */
function candidates(ctx: ChoiceContext, provider: ProviderId): Account[] {
  return visibleAccounts(ctx.accounts, provider).filter(switchable)
}

/**
 * The account a chat at its limit with `current` goes on with right now: the first free one of the
 * same CLI in the user's order, never `current` itself or another folder of its login. Null: none is free.
 */
export function nextAccount(ctx: ChoiceContext, provider: ProviderId, current: string): Account | null {
  const left = ctx.accounts.find((a) => a.id === current)
  for (const account of candidates(ctx, provider)) {
    if (account.id === current || (left && sameLogin(left, account))) continue
    const free = availability(account, ctx)
    if (free && free.at <= ctx.now) return account
  }
  return null
}

/**
 * Which account frees up first and when: of all accounts of the CLI (`anyAccount`), else of `current`
 * alone. Ties go to the user's order, and to `current` before others. Null: none ever will (signed out).
 */
export function firstFree(
  ctx: ChoiceContext,
  provider: ProviderId,
  current: string,
  anyAccount: boolean,
): { account: Account; at: number; estimated: boolean } | null {
  const own = ctx.accounts.find((a) => a.id === current)
  const pool = anyAccount ? candidates(ctx, provider) : own ? [own] : []
  // The chat's own account first: on a tie it goes on without a copy of the conversation.
  pool.sort((a, b) => Number(b.id === current) - Number(a.id === current))
  let best: { account: Account; at: number; estimated: boolean } | null = null
  for (const account of pool) {
    const free = availability(account, ctx)
    if (free && (!best || free.at < best.at)) best = { account, ...free }
  }
  return best
}
