import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@shared/defaults'
import { PUSH_KIND, type PushNotice } from '@shared/push'
import type { AppSettings, NotificationSettings, ProviderUsage, SessionMeta } from '@shared/types'
import { TypedEmitter } from '../lib/typed-emitter'
import type { Attention } from '../services/session-service'
import { PushNotifier } from './push-notifier'

class FakeSessions extends TypedEmitter<{ attention: [string, Attention] }> {
  metas: SessionMeta[] = [{ id: 's1', title: 'Server-Umbau' } as SessionMeta]
  list = () => this.metas
  fire(id: string, attention: Attention): void {
    this.emit('attention', id, attention)
  }
}

const done = (busyMs = 60_000, answer: string | null = 'Alles erledigt.'): Attention => ({ kind: 'done', provider: 'claude', accountId: 'a', busyMs, answer })
const question: Attention = {
  kind: 'input',
  provider: 'claude',
  request: { type: 'question', questions: [{ question: 'Welcher Weg?', options: [], multiSelect: false }] },
} as unknown as Attention

describe('PushNotifier', () => {
  let settings: AppSettings
  let sessions: FakeSessions
  let away: boolean
  let targets: string[]
  let push: ReturnType<typeof vi.fn<(to: string, kind: string, data: unknown, options: { urgency: string; ttl: number }) => Promise<boolean>>>
  let log: ReturnType<typeof vi.fn<(message: string) => void>>
  let notifier: PushNotifier

  const notify = (patch: Partial<NotificationSettings>) => (settings.notifications = { ...settings.notifications, ...patch })

  beforeEach(() => {
    settings = defaultSettings()
    sessions = new FakeSessions()
    away = true
    targets = ['phone1', 'phone2']
    push = vi.fn(async () => true)
    log = vi.fn()
    notifier = new PushNotifier({
      sessions,
      providers: { usage: (): ProviderUsage[] => [] },
      settings: { get: () => settings },
      link: { push, pushTargets: () => targets },
      away: () => away,
      log,
    })
  })

  it('pushes a chat’s notification to every phone, sealed per phone by the link', async () => {
    await notifier.attention('s1', done())
    expect(push).toHaveBeenCalledTimes(2)
    const [to, kind, notice, options] = push.mock.calls[0]!
    expect(to).toBe('phone1')
    expect(kind).toBe(PUSH_KIND)
    expect(notice).toEqual<PushNotice>({ v: 1, reason: 'done', chat: 's1', title: 'Claude ist fertig', body: 'Server-Umbau\nAlles erledigt.' })
    expect(options).toEqual({ urgency: 'normal', ttl: 3600 })
    expect(push.mock.calls[1]![0]).toBe('phone2')
  })

  it('pushes a question urgently, and keeps it longer for a phone that is offline', async () => {
    await notifier.attention('s1', question)
    expect(push.mock.calls[0]![2]).toMatchObject({ reason: 'input', title: 'Claude hat eine Frage', body: 'Server-Umbau\nWelcher Weg?' })
    expect(push.mock.calls[0]![3]).toEqual({ urgency: 'high', ttl: 86_400 })
  })

  it('follows the setting: only while away, always, or never', async () => {
    away = false
    await notifier.attention('s1', done())
    expect(push).not.toHaveBeenCalled()
    notify({ push: 'always' })
    await notifier.attention('s1', done())
    expect(push).toHaveBeenCalledTimes(2)
    notify({ push: 'off' })
    away = true
    await notifier.attention('s1', done())
    expect(push).toHaveBeenCalledTimes(2)
  })

  it('pushes only what this computer would notify about, with its preview setting', async () => {
    notify({ enabled: false })
    await notifier.attention('s1', done())
    notify({ enabled: true, onDone: false })
    await notifier.attention('s1', done())
    notify({ onDone: true })
    // Quicker than `minBusySeconds`: one was likely watching anyway.
    await notifier.attention('s1', done(1_000))
    expect(push).not.toHaveBeenCalled()
    notify({ preview: false })
    await notifier.attention('s1', done())
    expect(push.mock.calls[0]![2]).toMatchObject({ body: 'Server-Umbau' })
  })

  it('pushes nothing without phones or for a chat it doesn’t know', async () => {
    targets = []
    await notifier.attention('s1', done())
    targets = ['phone1']
    await notifier.attention('gone', done())
    expect(push).not.toHaveBeenCalled()
  })

  it('logs a failed push and still pushes to the other phones', async () => {
    push.mockImplementationOnce(async () => {
      throw new Error('push: unreachable')
    })
    await notifier.attention('s1', done())
    expect(push).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith('push to phone1 failed: push: unreachable')
  })

  it('listens to the chats’ attention once started, and no longer once disposed', async () => {
    notifier.init()
    sessions.fire('s1', done())
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(2))
    notifier.dispose()
    sessions.fire('s1', done())
    await Promise.resolve()
    expect(push).toHaveBeenCalledTimes(2)
  })
})
