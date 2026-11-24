import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UNKNOWN_RESET_MS } from '@shared/account-choice'
import type { Account } from '@shared/accounts'
import type { ProviderId, SessionEvent, SessionResume } from '@shared/chat'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, ProviderUsage, SessionMeta } from '@shared/types'
import { TypedEmitter } from '../lib/typed-emitter'
import { AutoSwitch, RESET_GRACE_MS } from './auto-switch'
import type { Attention } from './session-service'

const HOUR = 60 * 60_000
const START = new Date('2026-11-24T12:00:00').getTime()

class Fake<E extends Record<string, unknown[]>> extends TypedEmitter<E> {
  fire<K extends keyof E & string>(event: K, ...args: E[K]): void {
    this.emit(event, ...args)
  }
}

type SessionEvents = { attention: [string, Attention]; event: [SessionEvent]; changed: [SessionMeta[]] }

/** The chats as AutoSwitch sees them: which stand at a limit, with which account. */
class FakeSessions extends Fake<SessionEvents> {
  readonly atLimit = new Map<string, { provider: ProviderId; accountId: string }>()
  readonly resume = new Map<string, SessionResume>()
  readonly sent: { id: string; text: string; accountId: string }[] = []
  readonly notices: string[] = []
  failSend: Error | null = null

  async limitState(id: string) {
    return this.atLimit.get(id) ?? null
  }
  setResume(id: string, resume: SessionResume | null): void {
    if (resume) this.resume.set(id, resume)
    else this.resume.delete(id)
  }
  async update(id: string, patch: { account?: string }): Promise<SessionMeta> {
    const state = this.atLimit.get(id)
    if (state && patch.account) state.accountId = patch.account
    return {} as SessionMeta
  }
  async send(id: string, input: { text: string }): Promise<void> {
    if (this.failSend) throw this.failSend
    const state = this.atLimit.get(id)!
    this.sent.push({ id, text: input.text, accountId: state.accountId })
    this.atLimit.delete(id)
    this.resume.delete(id)
    this.fire('event', { type: 'runtime', sessionId: id, runtime: { status: 'running', connected: true } })
  }
  notice(_id: string, text: string, detail?: string): void {
    this.notices.push(`${text}: ${detail}`)
  }
  /** The chat's turn on `accountId` stopped at its limit. */
  limit(id: string, accountId: string): void {
    this.atLimit.set(id, { provider: 'claude', accountId })
    this.fire('attention', id, { kind: 'limit', provider: 'claude', accountId, message: 'limit' })
  }
}

function account(id: string): Account {
  return {
    id,
    name: id,
    provider: 'claude',
    kind: 'oauth',
    authState: 'ok',
    identity: { email: `${id}@example.com`, displayName: null, organizationName: null, organizationType: null, subscriptionType: null },
  } as Account
}

function full(accountId: string, resetsAt: number): ProviderUsage {
  return {
    provider: 'claude',
    accountId,
    windows: [{ key: 'five_hour', label: '5 Stunden', usedPercent: 100, resetsAt }],
    limited: true,
    updatedAt: Date.now(),
    source: 'session',
  }
}

describe('AutoSwitch', () => {
  let dir: string
  let settings: AppSettings
  let sessions: FakeSessions
  let providers: Fake<{ usage: [ProviderUsage[]] }> & { usage: () => ProviderUsage[] }
  let accounts: Fake<{ changed: [Account[]] }> & { list: () => Account[] }
  let settingsService: Fake<{ changed: [AppSettings] }> & { get: () => AppSettings }
  let usage: ProviderUsage[]
  let services: AutoSwitch[]

  async function start(): Promise<AutoSwitch> {
    const service = new AutoSwitch({
      sessions: sessions as never,
      providers: providers as never,
      accounts: accounts as never,
      settings: settingsService as never,
      userDataDir: dir,
    })
    services.push(service)
    await service.init()
    return service
  }

  /** Lets the deferred reaction to a limit run. */
  const settle = () => vi.advanceTimersByTimeAsync(0)

  beforeEach(async () => {
    vi.useFakeTimers({ now: START, toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    dir = await mkdtemp(join(tmpdir(), 'nexa-switch-'))
    settings = defaultSettings()
    sessions = new FakeSessions()
    usage = []
    const list = [account('a'), account('b'), account('c')]
    providers = Object.assign(new Fake<{ usage: [ProviderUsage[]] }>(), { usage: () => usage })
    accounts = Object.assign(new Fake<{ changed: [Account[]] }>(), { list: () => list })
    settingsService = Object.assign(new Fake<{ changed: [AppSettings] }>(), { get: () => settings })
    services = []
  })

  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all(services.map((service) => service.dispose()))
    await rm(dir, { recursive: true, force: true })
  })

  it('goes on with the next free account and leaves the full one until its reset', async () => {
    settings.chat.autoSwitch = true
    usage = [full('a', START + 2 * HOUR)]
    const service = await start()
    sessions.limit('s1', 'a')
    await settle()
    expect(sessions.sent).toEqual([{ id: 's1', text: 'Mach weiter', accountId: 'b' }])
    expect(service.blockedAccounts()).toEqual([{ accountId: 'a', until: START + 2 * HOUR }])

    // b at its limit too: on to c, not back to a.
    sessions.limit('s1', 'b')
    await settle()
    expect(sessions.sent.at(-1)).toMatchObject({ accountId: 'c' })
  })

  it('waits for the first reset when no account is free, then goes on with that one', async () => {
    settings.chat.autoSwitch = true
    settings.chat.continuePrompt = 'Weiter geht’s'
    usage = [full('a', START + 3 * HOUR), full('b', START + HOUR), full('c', START + 2 * HOUR)]
    await start()
    sessions.limit('s1', 'a')
    await settle()
    expect(sessions.sent).toEqual([])
    expect(sessions.resume.get('s1')).toEqual({ at: START + HOUR + RESET_GRACE_MS, accountId: 'b', byUser: false })

    await vi.advanceTimersByTimeAsync(HOUR)
    expect(sessions.sent).toEqual([])
    await vi.advanceTimersByTimeAsync(RESET_GRACE_MS)
    expect(sessions.sent).toEqual([{ id: 's1', text: 'Weiter geht’s', accountId: 'b' }])
    expect(sessions.resume.has('s1')).toBe(false)
  })

  it('does nothing by itself when switched off, but goes on at the reset when asked', async () => {
    usage = [full('a', START + HOUR)]
    const service = await start()
    sessions.limit('s1', 'a')
    await settle()
    expect(sessions.resume.has('s1')).toBe(false)

    await service.resumeAtReset('s1', true)
    expect(sessions.resume.get('s1')).toEqual({ at: START + HOUR + RESET_GRACE_MS, accountId: 'a', byUser: true })
    await vi.advanceTimersByTimeAsync(HOUR + RESET_GRACE_MS)
    // Its own account: no switch.
    expect(sessions.sent).toEqual([{ id: 's1', text: 'Mach weiter', accountId: 'a' }])
  })

  it('waits again when the limit is still there after going on at the user’s request', async () => {
    usage = [full('a', START + HOUR)]
    const service = await start()
    sessions.limit('s1', 'a')
    await settle()
    await service.resumeAtReset('s1', true)
    await vi.advanceTimersByTimeAsync(HOUR + RESET_GRACE_MS)
    usage = [full('a', START + 6 * HOUR)]
    sessions.limit('s1', 'a')
    await settle()
    expect(sessions.resume.get('s1')).toMatchObject({ at: START + 6 * HOUR + RESET_GRACE_MS, byUser: true })
  })

  it('stops waiting when the user says so or writes on', async () => {
    usage = [full('a', START + HOUR)]
    const service = await start()
    sessions.limit('s1', 'a')
    sessions.limit('s2', 'a')
    await settle()
    await service.resumeAtReset('s1', true)
    await service.resumeAtReset('s2', true)

    await service.resumeAtReset('s1', false)
    expect(sessions.resume.has('s1')).toBe(false)
    // A prompt of the user ends the wait: the runtime goes on without it.
    sessions.atLimit.delete('s2')
    sessions.fire('event', { type: 'runtime', sessionId: 's2', runtime: { status: 'running', connected: true } })

    await vi.advanceTimersByTimeAsync(2 * HOUR)
    expect(sessions.sent).toEqual([])
  })

  it('refuses to wait for a chat that isn’t at a limit', async () => {
    const service = await start()
    await expect(service.resumeAtReset('s1', true)).rejects.toThrow('nicht an einem Limit')
  })

  it('guesses an unknown reset and takes the one a CLI names later', async () => {
    const service = await start()
    sessions.limit('s1', 'a')
    await settle()
    expect(service.blockedAccounts()).toEqual([{ accountId: 'a', until: START + UNKNOWN_RESET_MS, estimated: true }])
    await service.resumeAtReset('s1', true)
    expect(sessions.resume.get('s1')).toMatchObject({ estimated: true })

    usage = [full('a', START + HOUR)]
    providers.fire('usage', usage)
    expect(service.blockedAccounts()).toEqual([{ accountId: 'a', until: START + HOUR }])
    expect(sessions.resume.get('s1')).toEqual({ at: START + HOUR + RESET_GRACE_MS, accountId: 'a', byUser: true })
  })

  it('frees an account once a turn went through with it', async () => {
    const service = await start()
    sessions.limit('s1', 'a')
    await settle()
    sessions.fire('attention', 's2', { kind: 'done', provider: 'claude', accountId: 'a', busyMs: 1, answer: null })
    expect(service.blockedAccounts()).toEqual([])
  })

  it('keeps blocks and waiting chats across a restart', async () => {
    usage = [full('a', START + HOUR)]
    const first = await start()
    sessions.limit('s1', 'a')
    await settle()
    await first.resumeAtReset('s1', true)
    await first.dispose()
    sessions.resume.clear()
    expect(JSON.parse(await readFile(join(dir, 'auto-switch.json'), 'utf8')).waiting.s1).toBeTruthy()

    const second = await start()
    expect(second.blockedAccounts()).toEqual([{ accountId: 'a', until: START + HOUR }])
    expect(sessions.resume.get('s1')).toMatchObject({ accountId: 'a', byUser: true })
    await vi.advanceTimersByTimeAsync(HOUR + RESET_GRACE_MS)
    expect(sessions.sent).toEqual([{ id: 's1', text: 'Mach weiter', accountId: 'a' }])
  })

  it('notes in the chat when going on fails', async () => {
    settings.chat.autoSwitch = true
    sessions.failSend = new Error('„b“ ist nicht angemeldet.')
    await start()
    sessions.limit('s1', 'a')
    await settle()
    expect(sessions.notices).toEqual(['Nach dem Limit nicht weitergemacht: „b“ ist nicht angemeldet.'])
    expect(sessions.resume.has('s1')).toBe(false)
  })
})
