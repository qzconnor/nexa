import { join } from 'node:path'
import { availability, firstFree, nextAccount, UNKNOWN_RESET_MS, type BlockedAccount, type ChoiceContext } from '@shared/account-choice'
import type { Account } from '@shared/accounts'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { DEFAULT_CONTINUE_PROMPT } from '@shared/defaults'
import { isPlainObject } from '@shared/utils'
import type { AccountService } from '../accounts/account-service'
import { readJson, writeJsonAtomic } from '../lib/json-file'
import type { ProviderService } from './provider-service'
import type { SessionService } from './session-service'
import type { SettingsService } from './settings-service'

/** An account counts as free this long after its reset: the CLIs' servers don't go by the second. */
export const RESET_GRACE_MS = 60_000
/** Looked at again this often while chats wait: a sleeping computer holds a timer's clock. */
const RECHECK_MS = 5 * 60_000

/** A chat at its limit that goes on by itself once an account it may use is free. */
interface Waiting {
  provider: ProviderId
  /** The chat's account. */
  accountId: string
  /** The user asked for it („Am Reset fortsetzen“); else it waits for the automatic switch. */
  byUser: boolean
}

interface StoredFile {
  version: 1
  blocked: BlockedAccount[]
  waiting: Record<string, Waiting>
}

export interface AutoSwitchDeps {
  sessions: Pick<SessionService, 'on' | 'limitState' | 'setResume' | 'update' | 'send' | 'notice'>
  providers: Pick<ProviderService, 'on' | 'usage'>
  accounts: Pick<AccountService, 'on' | 'list'>
  settings: Pick<SettingsService, 'on' | 'get'>
  userDataDir: string
}

/**
 * What happens when a chat stops at its account's plan limit (as „Account wechseln“ in the Claude
 * Manager). The account is left alone until its reset. With `chat.autoSwitch` the chat goes on with
 * the next free account of the same CLI, in the order of the accounts list; with none free it waits
 * for the first reset. „Am Reset fortsetzen“ waits for the reset of the chat's own account without
 * switching. Going on, the chat says `chat.continuePrompt`. Blocks and waits outlast a restart.
 */
export class AutoSwitch {
  private readonly file: string
  private blocked: BlockedAccount[] = []
  private readonly waiting = new Map<string, Waiting>()
  /** Chats that went on at the user's request: a limit right after waits for the next reset again. */
  private readonly resumed = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private waking = false
  private saving: Promise<void> = Promise.resolve()
  private readonly offs: (() => void)[] = []

  constructor(private readonly deps: AutoSwitchDeps) {
    this.file = join(deps.userDataDir, 'auto-switch.json')
  }

  async init(): Promise<void> {
    const stored = await readJson<StoredFile>(this.file).catch(() => null)
    if (stored?.version === 1) {
      if (Array.isArray(stored.blocked)) {
        this.blocked = stored.blocked.filter((b) => isPlainObject(b) && typeof b.accountId === 'string' && typeof b.until === 'number')
      }
      for (const [id, entry] of Object.entries(isPlainObject(stored.waiting) ? stored.waiting : {})) {
        if (isPlainObject(entry) && PROVIDER_IDS.includes(entry.provider) && typeof entry.accountId === 'string') {
          this.waiting.set(id, { provider: entry.provider, accountId: entry.accountId, byUser: !!entry.byUser })
        }
      }
    }
    const { sessions, providers, accounts, settings } = this.deps
    let autoSwitch = settings.get().chat.autoSwitch
    this.offs.push(
      sessions.on('attention', (id, attention) => {
        if (attention.kind === 'limit') {
          // After the turn's own reports: the run is at rest by then.
          setTimeout(() => void this.limitReached(id, attention.accountId).catch((error) => console.warn('[auto-switch] limit', error)), 0)
        } else if (attention.kind === 'done') {
          this.resumed.delete(id)
          // A turn went through: whatever held the account back is over.
          if (!attention.error) this.unblock(attention.accountId)
        }
      }),
      // A prompt of the user (or another CLI, a `/clear` …) ends the wait.
      sessions.on('event', (event) => {
        if (event.type === 'runtime' && !event.runtime.resume && this.waiting.delete(event.sessionId)) this.save()
      }),
      sessions.on('changed', (list) => {
        let gone = false
        for (const id of [...this.waiting.keys()]) if (!list.some((s) => s.id === id)) gone = this.waiting.delete(id) || gone
        if (gone) this.save()
      }),
      providers.on('usage', () => this.usageChanged()),
      // An account signed in again or added may be free.
      accounts.on('changed', () => this.reschedule()),
      settings.on('changed', (next) => {
        if (next.chat.autoSwitch === autoSwitch) return
        autoSwitch = next.chat.autoSwitch
        // Switched off: what waited for the switch stops; what the user asked for waits on, for its own account.
        if (!autoSwitch) for (const [id, entry] of [...this.waiting]) if (!entry.byUser) this.stopWaiting(id)
        this.reschedule()
      }),
    )
    // Chats that waited when Nexa quit wait on, unless something happened to them meanwhile.
    for (const id of [...this.waiting.keys()]) {
      const state = await sessions.limitState(id).catch(() => null)
      if (state) Object.assign(this.waiting.get(id)!, state)
      else this.waiting.delete(id)
    }
    this.prune()
    this.save()
    this.reschedule()
  }

  /** „Am Reset fortsetzen“ for a chat at its limit; `on` false: it doesn't go on by itself (any more). */
  async resumeAtReset(id: string, on: boolean): Promise<void> {
    if (!on) {
      this.resumed.delete(id)
      this.stopWaiting(id)
      this.reschedule()
      return
    }
    const state = await this.deps.sessions.limitState(id)
    if (!state) throw new Error('Der Chat steht nicht an einem Limit.')
    this.waiting.set(id, { ...state, byUser: true })
    this.save()
    // An account free already (its reset passed while the chat stood) wakes the timer at once.
    this.reschedule()
  }

  /** The accounts left at their limit, until when. */
  blockedAccounts(): BlockedAccount[] {
    return this.blocked.map((b) => ({ ...b }))
  }

  /** Stops reacting and waking; resolves once what is pending is written. */
  dispose(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const off of this.offs.splice(0)) off()
    return this.saving
  }

  // ------------------------------------------------------------------------------------------

  private context(now: number): ChoiceContext {
    return { accounts: this.deps.accounts.list(), usage: this.deps.providers.usage(), blocked: this.blocked, now }
  }

  private account(id: string): Account | undefined {
    return this.deps.accounts.list().find((a) => a.id === id)
  }

  private async limitReached(id: string, accountId: string): Promise<void> {
    this.block(accountId)
    const asked = this.resumed.delete(id)
    const state = await this.deps.sessions.limitState(id).catch(() => null)
    // Something happened in the chat meanwhile (the user wrote, chose another CLI).
    if (!state) return
    const autoSwitch = this.deps.settings.get().chat.autoSwitch
    if (autoSwitch) {
      const next = nextAccount(this.context(Date.now()), state.provider, accountId)
      if (next) return this.goOn(id, next.id, false)
    }
    if (!autoSwitch && !asked) return
    this.waiting.set(id, { ...state, byUser: asked })
    this.save()
    this.reschedule()
  }

  /** Leaves an account alone until its limit resets: as the CLI said, else a guess. */
  private block(accountId: string): void {
    const now = Date.now()
    const account = this.account(accountId)
    const known = account ? availability(account, { ...this.context(now), blocked: [] }) : null
    const entry: BlockedAccount =
      known && known.at > now && !known.estimated ? { accountId, until: known.at } : { accountId, until: now + UNKNOWN_RESET_MS, estimated: true }
    this.blocked = [...this.blocked.filter((b) => b.accountId !== accountId), entry]
    this.save()
  }

  private unblock(accountId: string): void {
    const before = this.blocked.length
    this.blocked = this.blocked.filter((b) => b.accountId !== accountId)
    if (this.blocked.length === before) return
    this.save()
    this.reschedule()
  }

  /** Blocks long over go; they would hold nothing back anyway. */
  private prune(): void {
    const now = Date.now()
    this.blocked = this.blocked.filter((b) => b.until + RESET_GRACE_MS > now && this.account(b.accountId))
  }

  private usageChanged(): void {
    // A reset a CLI names now replaces the guess.
    const now = Date.now()
    const ctx = { ...this.context(now), blocked: [] }
    let changed = false
    for (const block of this.blocked) {
      if (!block.estimated) continue
      const account = this.account(block.accountId)
      const known = account ? availability(account, ctx) : null
      if (known && known.at > now && !known.estimated) {
        block.until = known.at
        delete block.estimated
        changed = true
      }
    }
    if (changed) this.save()
    this.reschedule()
  }

  /** When a waiting chat goes on and with which account; null: no account it may use ever frees up. */
  private plan(entry: Waiting): { account: Account; at: number; estimated: boolean } | null {
    // Counted a moment back: an account is free once its reset is RESET_GRACE_MS past.
    const free = firstFree(this.context(Date.now() - RESET_GRACE_MS), entry.provider, entry.accountId, this.deps.settings.get().chat.autoSwitch)
    return free && { ...free, at: free.at + RESET_GRACE_MS }
  }

  /** Tells every waiting chat when it goes on, and wakes for the first. */
  private reschedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    let soonest = Infinity
    for (const [id, entry] of this.waiting) {
      const free = this.plan(entry)
      this.deps.sessions.setResume(id, {
        at: free?.at ?? null,
        ...(free?.estimated ? { estimated: true } : {}),
        accountId: free?.account.id ?? null,
        byUser: entry.byUser,
      })
      if (free) soonest = Math.min(soonest, free.at)
    }
    if (soonest === Infinity) return
    this.timer = setTimeout(() => void this.wake(), Math.min(Math.max(0, soonest - Date.now()), RECHECK_MS))
  }

  private async wake(): Promise<void> {
    this.timer = null
    if (this.waking) return
    this.waking = true
    try {
      this.prune()
      for (const [id, entry] of [...this.waiting]) {
        const state = await this.deps.sessions.limitState(id).catch(() => null)
        if (!state) {
          this.stopWaiting(id)
          continue
        }
        // The user may have picked another account at the composer meanwhile.
        Object.assign(entry, state)
        const free = this.plan(entry)
        if (free && free.at <= Date.now()) await this.goOn(id, free.account.id, entry.byUser)
      }
    } finally {
      this.waking = false
      this.reschedule()
    }
  }

  /** Goes on with a chat at its limit: with `accountId` (copying the conversation there) and the continue prompt. */
  private async goOn(id: string, accountId: string, byUser: boolean): Promise<void> {
    this.waiting.delete(id)
    this.save()
    if (byUser) this.resumed.add(id)
    try {
      const state = await this.deps.sessions.limitState(id)
      if (!state) return
      if (state.accountId !== accountId) await this.deps.sessions.update(id, { account: accountId })
      const text = this.deps.settings.get().chat.continuePrompt.trim() || DEFAULT_CONTINUE_PROMPT
      await this.deps.sessions.send(id, { text })
    } catch (error) {
      this.resumed.delete(id)
      this.deps.sessions.setResume(id, null)
      const message = error instanceof Error ? error.message : String(error)
      this.deps.sessions.notice(id, 'Nach dem Limit nicht weitergemacht', message, 'warning')
    }
  }

  private stopWaiting(id: string): void {
    this.waiting.delete(id)
    this.deps.sessions.setResume(id, null)
    this.save()
  }

  private save(): void {
    const data: StoredFile = { version: 1, blocked: this.blocked, waiting: Object.fromEntries(this.waiting) }
    const snapshot = JSON.parse(JSON.stringify(data)) as StoredFile
    this.saving = this.saving
      .then(() => writeJsonAtomic(this.file, snapshot))
      .catch((error) => console.warn('[auto-switch] could not save', error))
  }
}
