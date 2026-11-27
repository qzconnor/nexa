import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@shared/accounts'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, NotificationSettings, ProviderUsage, SessionMeta } from '@shared/types'
import { TypedEmitter } from '../lib/typed-emitter'
import type { Attention } from './session-service'

const fakes = vi.hoisted(() => {
  class FakeNotification {
    static supported = true
    static created: FakeNotification[] = []
    static isSupported(): boolean {
      return FakeNotification.supported
    }

    readonly handlers = new Map<string, () => void>()
    shown = false
    closed = false

    constructor(readonly options: { title: string; body: string; silent?: boolean }) {
      FakeNotification.created.push(this)
    }

    on(event: string, handler: () => void): this {
      this.handlers.set(event, handler)
      return this
    }

    show(): void {
      this.shown = true
    }

    close(): void {
      this.closed = true
    }
  }
  return { FakeNotification }
})

vi.mock('electron', () => ({ app: { isPackaged: false }, Notification: fakes.FakeNotification }))

const { NotificationService } = await import('./notification-service')

/** An emitter whose events the test fires. */
class Fake<E extends Record<string, unknown[]>> extends TypedEmitter<E> {
  fire<K extends keyof E & string>(event: K, ...args: E[K]): void {
    this.emit(event, ...args)
  }
}

class FakeWindow {
  constructor(readonly id = 1) {}
  focused = false
  visible = true
  minimized = false
  flashed = false
  isDestroyed = () => false
  isVisible = () => this.visible
  isMinimized = () => this.minimized
  isFocused = () => this.focused
  flashFrame = (on: boolean) => (this.flashed = on)
}

const meta = (id: string, title: string) => ({ id, title }) as SessionMeta
const account = (id: string, patch: Partial<Account> = {}) =>
  ({ id, name: `Konto ${id}`, provider: 'claude', authState: 'ok', tokenExpiresAt: null, ...patch }) as Account
const done = (busyMs: number, answer: string | null = 'Alles erledigt.'): Attention => ({ kind: 'done', provider: 'claude', accountId: 'a', busyMs, answer })

describe('NotificationService', () => {
  let dir: string
  let settings: AppSettings
  let sessions: Fake<{ attention: [string, Attention]; changed: [SessionMeta[]] }> & { list: () => SessionMeta[] }
  let providers: Fake<{ usage: [ProviderUsage[]] }> & { usage: () => ProviderUsage[] }
  let accounts: Fake<{ changed: [Account[]] }> & { list: () => Account[] }
  let settingsService: Fake<{ changed: [AppSettings] }> & { get: () => AppSettings }
  let win: FakeWindow
  /** Chats in windows of their own, after the main window. */
  let chatWindows: FakeWindow[]
  let usage: ProviderUsage[]
  let accountList: Account[]
  const open = { chat: vi.fn<(id: string) => void>(), settings: vi.fn<(section: 'usage' | 'accounts') => void>() }
  /** The agents' notifications shown as toasts, and those taken back. */
  let toasts: { window: number; id: string; actions: string[] }[]
  let toastsDone: string[]

  async function start(patch: Partial<NotificationSettings> = {}) {
    settings.notifications = { ...settings.notifications, ...patch }
    const service = new NotificationService({
      sessions: sessions as never,
      providers: providers as never,
      accounts: accounts as never,
      settings: settingsService as never,
      userDataDir: dir,
      windows: () => [win, ...chatWindows] as never,
      open,
      toasts: {
        show: (target, notification) => toasts.push({ window: (target as unknown as FakeWindow).id, id: notification.id, actions: notification.actions }),
        done: (id) => toastsDone.push(id),
      },
    })
    await service.init()
    return service
  }

  const created = () => fakes.FakeNotification.created
  const texts = () => created().map((n) => `${n.options.title} | ${n.options.body}`)

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-notify-'))
    fakes.FakeNotification.created = []
    fakes.FakeNotification.supported = true
    settings = defaultSettings()
    win = new FakeWindow()
    chatWindows = []
    usage = []
    accountList = [account('a')]
    sessions = Object.assign(new Fake<{ attention: [string, Attention]; changed: [SessionMeta[]] }>(), {
      list: () => [meta('s1', 'Refactoring'), meta('s2', '')],
    })
    providers = Object.assign(new Fake<{ usage: [ProviderUsage[]] }>(), { usage: () => usage })
    accounts = Object.assign(new Fake<{ changed: [Account[]] }>(), { list: () => accountList })
    settingsService = Object.assign(new Fake<{ changed: [AppSettings] }>(), { get: () => settings })
    open.chat.mockReset()
    open.settings.mockReset()
    toasts = []
    toastsDone = []
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('tells a finished chat while the window is in the background, and a click opens it', async () => {
    await start()
    sessions.fire('attention', 's1', done(60_000))
    expect(texts()).toEqual(['Claude ist fertig | Refactoring\nAlles erledigt.'])
    expect(win.flashed).toBe(true)
    created()[0]!.handlers.get('click')!()
    expect(open.chat).toHaveBeenCalledWith('s1')
  })

  it('stays quiet for short answers, switched off events and while the window is in front', async () => {
    await start({ onInput: false })
    sessions.fire('attention', 's1', done(5_000))
    sessions.fire('attention', 's1', { kind: 'input', provider: 'claude', request: { type: 'plan', plan: 'x' }, itemId: 'q1' })
    win.focused = true
    sessions.fire('attention', 's1', done(60_000))
    expect(created()).toHaveLength(0)
  })

  it('with "hidden" also tells chats the window in front does not show', async () => {
    const service = await start({ when: 'hidden', preview: false, flashTaskbar: true })
    win.focused = true
    service.setViewing(1, 's1')
    sessions.fire('attention', 's1', done(60_000))
    sessions.fire('attention', 's2', done(60_000))
    expect(texts()).toEqual(['Claude ist fertig | Chat'])
    // The window is in front: nothing to flash.
    expect(win.flashed).toBe(false)
  })

  it('takes a notification back once its chat is seen, and keeps one per chat', async () => {
    const service = await start()
    sessions.fire('attention', 's1', done(60_000))
    sessions.fire('attention', 's1', done(60_000, 'Zweite'))
    expect(created()[0]!.closed).toBe(true)
    service.setViewing(1, 's1')
    expect(created()[1]!.closed).toBe(false)
    win.focused = true
    service.windowFocused(1)
    expect(created()[1]!.closed).toBe(true)
  })

  it('knows a chat in a window of its own: quiet while that window is in front, which flashes for it', async () => {
    const own = new FakeWindow(2)
    chatWindows = [own]
    const service = await start({ when: 'hidden', flashTaskbar: true })
    service.setViewing(2, 's1')
    own.focused = true
    sessions.fire('attention', 's1', done(60_000))
    expect(created()).toHaveLength(0)
    // The main window in front shows another chat: the one in its own window is told.
    own.focused = false
    win.focused = true
    sessions.fire('attention', 's1', done(60_000))
    expect(created()).toHaveLength(1)
    // Nothing in front: the chat's own window flashes, not the main window.
    win.focused = false
    sessions.fire('attention', 's1', done(60_000))
    expect(own.flashed).toBe(true)
    expect(win.flashed).toBe(false)
    service.windowClosed(2)
    sessions.fire('attention', 's1', done(60_000))
    expect(win.flashed).toBe(true)
  })

  it('is silent without sound and does nothing when switched off', async () => {
    await start({ sound: false })
    sessions.fire('attention', 's1', done(60_000))
    expect(created()[0]!.options.silent).toBe(true)
    settings.notifications.enabled = false
    sessions.fire('attention', 's1', done(60_000))
    expect(created()).toHaveLength(1)
  })

  it('tells a limit with its reset from the account usage', async () => {
    const reset = new Date(2030, 0, 1, 19, 40).getTime()
    usage = [{ provider: 'claude', accountId: 'a', windows: [{ key: 'five_hour', label: '5 Stunden', usedPercent: 100, resetsAt: reset }], updatedAt: 0, source: 'session' }]
    await start({ onNearLimit: false })
    sessions.fire('attention', 's1', { kind: 'limit', provider: 'claude', accountId: 'a', message: 'limit' })
    expect(created()[0]!.options.title).toBe('Limit erreicht')
    expect(created()[0]!.options.body).toMatch(/^Refactoring\nReset (um|Di\.) 19:40$/)
  })

  it('warns once when an account nears its limit, and a click shows the usage', async () => {
    await start()
    usage = [{ provider: 'claude', accountId: 'a', windows: [{ key: 'five_hour', label: '5 Stunden', usedPercent: 85 }], updatedAt: 0, source: 'api' }]
    providers.fire('usage', usage)
    providers.fire('usage', usage)
    expect(texts()).toEqual(['Limit fast erreicht | Konto a\n5 Stunden: 85 %'])
    created()[0]!.handlers.get('click')!()
    expect(open.settings).toHaveBeenCalledWith('usage')
    await vi.waitFor(async () => {
      const stored = JSON.parse(await readFile(join(dir, 'notifications.json'), 'utf8')) as { warned: Record<string, unknown> }
      expect(stored.warned).toEqual({ 'a\nfive_hour': null })
    })
  })

  it('leaves the limits of a CLI that is switched off alone', async () => {
    settings.claude.enabled = false
    usage = [{ provider: 'claude', accountId: 'a', windows: [{ key: 'five_hour', label: '5 Stunden', usedPercent: 95 }], updatedAt: 0, source: 'api' }]
    await start()
    expect(created()).toHaveLength(0)
  })

  it('tells a dead login once, also after a restart', async () => {
    accountList = [account('a', { authState: 'dead', tokenExpiresAt: '2026-11-01T00:00:00Z' })]
    await start()
    accounts.fire('changed', accountList)
    expect(texts()).toEqual(['Login abgelaufen | Konto a\nClaude Code kann den Login nicht mehr erneuern. Melde dich neu an.'])
    created()[0]!.handlers.get('click')!()
    expect(open.settings).toHaveBeenCalledWith('accounts')
    await vi.waitFor(async () => expect(await readFile(join(dir, 'notifications.json'), 'utf8')).toContain('2026-11-01'))
    await start()
    expect(created()).toHaveLength(1)
  })

  it('tells a scheduled run that is done however short it was', async () => {
    sessions.list = () => [{ ...meta('s1', 'Briefing · 25.11. 7:00'), scheduledTask: { id: 't1', name: 'Briefing' } }]
    await start()
    sessions.fire('attention', 's1', done(3_000))
    expect(texts()).toEqual(['Claude ist fertig | Briefing · 25.11. 7:00\nAlles erledigt.'])
  })

  describe('notifications of agents', () => {
    const request = (actions: string[] = []) => ({ title: 'Briefing fertig', message: 'Zwei Issues sind dringend.', actions, waitMs: 60_000 })
    const action = (index: number) => (created().at(-1)!.handlers.get('action') as unknown as (details: { actionIndex: number }) => void)({ actionIndex: index })
    const closed = (reason: string) => (created().at(-1)!.handlers.get('close') as unknown as (details: { reason: string }) => void)({ reason })

    it('shows one in the background as a system notification whose click opens the chat', async () => {
      const service = await start()
      await expect(service.fromAgent('s1', request())).resolves.toEqual({ kind: 'shown' })
      expect(texts()).toEqual(['Briefing fertig | Refactoring\nZwei Issues sind dringend.'])
      created()[0]!.handlers.get('click')!()
      expect(open.chat).toHaveBeenCalledWith('s1')
    })

    it('waits for the button the user picks, also when the window comes to the front', async () => {
      const service = await start()
      const picked = service.fromAgent('s1', request(['Freigeben', 'Später']))
      expect((created()[0]!.options as { actions?: unknown }).actions).toEqual([
        { type: 'button', text: 'Freigeben' },
        { type: 'button', text: 'Später' },
      ])
      // Back in Nexa: the buttons come as a toast there too.
      win.focused = true
      service.windowFocused(1)
      expect(toasts).toMatchObject([{ window: 1, actions: ['Freigeben', 'Später'] }])
      action(1)
      await expect(picked).resolves.toEqual({ kind: 'action', action: 'Später' })
      expect(toastsDone).toEqual([toasts[0]!.id])
    })

    it('shows a toast while Nexa is in front and takes the answer from it', async () => {
      const service = await start()
      win.focused = true
      const picked = service.fromAgent('s1', request(['Ja']))
      expect(created()).toHaveLength(0)
      service.answerAgent(toasts[0]!.id, { kind: 'action', action: 'Nein' })
      service.answerAgent(toasts[0]!.id, { kind: 'dismissed' })
      await expect(picked).resolves.toEqual({ kind: 'dismissed' })
    })

    it('ends the wait when dismissed, replaced, stopped or out of time', async () => {
      vi.useFakeTimers()
      try {
        const service = await start()
        const dismissed = service.fromAgent('s1', request(['Ja']))
        closed('timedOut')
        closed('userCanceled')
        await expect(dismissed).resolves.toEqual({ kind: 'dismissed' })

        const replaced = service.fromAgent('s1', request(['Ja']))
        const newer = service.fromAgent('s1', request(['Ja']))
        await expect(replaced).resolves.toEqual({ kind: 'replaced' })

        const stop = new AbortController()
        const stopped = service.fromAgent('s2', request(['Ja']), stop.signal)
        stop.abort()
        await expect(stopped).resolves.toEqual({ kind: 'cancelled' })

        vi.advanceTimersByTime(60_000)
        await expect(newer).resolves.toEqual({ kind: 'timeout', minutes: 1 })
      } finally {
        vi.useRealTimers()
      }
    })

    it('shows nothing while notifications from agents are off', async () => {
      const service = await start({ fromAgents: false })
      await expect(service.fromAgent('s1', request(['Ja']))).resolves.toEqual({ kind: 'off' })
      expect(created()).toHaveLength(0)
    })
  })
})
