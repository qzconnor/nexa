import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@shared/accounts'
import type { ScheduledTask, ScheduledTaskInput } from '@shared/scheduled-tasks'
import type { Project, ProviderUsage, SessionCreateInput, SessionMeta } from '@shared/types'
import { ScheduledTasks, type ScheduledSessions, type ScheduledUsage } from './scheduled-tasks'

const at = (text: string) => new Date(text).getTime()

function fakeSessions() {
  let n = 0
  const working = new Set<string>()
  const created: SessionCreateInput[] = []
  const sent: { id: string; text: string }[] = []
  const titles: Record<string, string> = {}
  const sessions: ScheduledSessions = {
    create: async (input) => {
      created.push(input)
      return { id: `chat-${++n}` } as SessionMeta
    },
    update: async (id, patch) => {
      if (patch.title) titles[id] = patch.title
      return { id } as SessionMeta
    },
    send: async (id, input) => {
      sent.push({ id, text: input.text })
    },
    exists: (id) => id.startsWith('chat-'),
    isWorking: (id) => working.has(id),
  }
  return { sessions, working, created, sent, titles }
}

/** The limits of the accounts, as ProviderService keeps them; a reading changes nothing unless `onRefresh` does. */
function fakeUsage() {
  const numbers: Record<string, ProviderUsage> = {}
  const refreshed: string[] = []
  let onRefresh: ((accountId: string) => void) | null = null
  const usage: ScheduledUsage = {
    defaultAccount: () => 'acc-claude',
    get: (id) => numbers[id],
    refresh: async (id) => {
      refreshed.push(id)
      onRefresh?.(id)
    },
  }
  /** Numbers read now: the 5 hours and the week at these percentages. */
  const set = (accountId: string, session: number, week = 10) => {
    numbers[accountId] = {
      provider: 'claude',
      accountId,
      windows: [
        { key: 'five_hour', label: '5 Stunden', usedPercent: session, windowMinutes: 300 },
        { key: 'seven_day', label: 'Woche', usedPercent: week, windowMinutes: 10080 },
      ],
      updatedAt: Date.now(),
      source: 'api',
    }
  }
  return { usage, numbers, refreshed, set, whenRefreshed: (cb: (accountId: string) => void) => (onRefresh = cb) }
}

const input = (patch: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput => ({
  name: 'Briefing',
  prompt: 'Fasse den Tag zusammen.',
  enabled: true,
  schedule: { kind: 'daily', time: '09:00' },
  provider: 'claude',
  model: '',
  effort: '',
  permissionMode: 'auto',
  projectId: 'p1',
  reuseChat: false,
  catchUp: true,
  ...patch,
})

describe('ScheduledTasks', () => {
  let dir: string
  let file: string
  let fake: ReturnType<typeof fakeSessions>
  let limits: ReturnType<typeof fakeUsage>
  const accounts: Record<string, Partial<Account>> = {
    'acc-claude': { id: 'acc-claude', provider: 'claude', kind: 'system' },
    'acc-codex': { id: 'acc-codex', provider: 'codex', kind: 'system' },
    'acc-key': { id: 'acc-key', provider: 'claude', kind: 'apiKey' },
  }
  const make = () =>
    new ScheduledTasks({
      file,
      sessions: fake.sessions,
      projects: { get: (id) => (id === 'p1' ? ({ id: 'p1', name: 'nexa', path: 'F:\\nexa' } as Project) : undefined) },
      accounts: { has: (id) => id in accounts, get: (id) => accounts[id] as Account },
      usage: limits.usage,
    })

  beforeEach(() => {
    vi.useFakeTimers({ now: at('2026-11-25T08:00') })
    dir = mkdtempSync(join(tmpdir(), 'nexa-scheduled-'))
    file = join(dir, 'scheduled-tasks.json')
    fake = fakeSessions()
    limits = fakeUsage()
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs a task at its time in a new chat of its project, named after it', async () => {
    const tasks = make()
    tasks.start()
    const task = await tasks.save(input({ account: 'acc-claude', model: 'opus' }))
    expect(task.nextRunAt).toBe(at('2026-11-25T09:00'))

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(fake.created).toEqual([
      { projectId: 'p1', provider: 'claude', account: 'acc-claude', model: 'opus', effort: undefined, permissionMode: 'auto', scheduledTask: { id: task.id, name: 'Briefing' } },
    ])
    expect(fake.titles['chat-1']).toBe('Briefing · 25.11. 9:00')
    expect(fake.sent).toEqual([{ id: 'chat-1', text: 'Fasse den Tag zusammen.' }])
    const [saved] = tasks.list()
    expect(saved!.runs[0]).toMatchObject({ trigger: 'schedule', outcome: 'started', sessionId: 'chat-1' })
    expect(saved!.nextRunAt).toBe(at('2026-11-26T09:00'))
    await tasks.dispose()
  })

  it('skips a run while the chat of the last run still works, and goes on in it with reuseChat', async () => {
    const tasks = make()
    tasks.start()
    const task = await tasks.save(input({ schedule: { kind: 'manual' }, reuseChat: true }))
    expect(task.nextRunAt).toBeNull()
    expect(await tasks.runNow(task.id)).toMatchObject({ outcome: 'started', sessionId: 'chat-1' })

    fake.working.add('chat-1')
    expect(await tasks.runNow(task.id)).toMatchObject({ outcome: 'skipped', trigger: 'manual', sessionId: 'chat-1' })
    expect(tasks.list()[0]!.runs[0]).toMatchObject({ outcome: 'skipped' })

    fake.working.clear()
    expect(await tasks.runNow(task.id)).toMatchObject({ outcome: 'started', sessionId: 'chat-1' })
    expect(fake.created).toHaveLength(1)
    expect(fake.sent.map((s) => s.id)).toEqual(['chat-1', 'chat-1'])
    await tasks.dispose()
  })

  it('catches up once on a run missed while Nexa was off, or records it as missed', async () => {
    const stored = (catchUp: boolean): ScheduledTask => ({
      ...input({ catchUp }),
      id: catchUp ? 'up' : 'missed',
      createdAt: 0,
      updatedAt: 0,
      // Due yesterday, and the days before.
      nextRunAt: at('2026-11-24T09:00'),
      runs: [],
    })
    writeFileSync(file, JSON.stringify({ version: 1, tasks: [stored(true), stored(false)] }))
    const tasks = make()
    tasks.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(fake.created).toHaveLength(1)
    const [up, missed] = tasks.list()
    expect(up!.runs).toMatchObject([{ trigger: 'catch-up', outcome: 'started' }])
    expect(missed!.runs).toMatchObject([{ outcome: 'missed' }])
    expect(up!.nextRunAt).toBe(at('2026-11-25T09:00'))
    expect(missed!.nextRunAt).toBe(at('2026-11-25T09:00'))
    await tasks.dispose()
  })

  it('runs a single run once and switches the task off', async () => {
    const tasks = make()
    tasks.start()
    await expect(tasks.save(input({ schedule: { kind: 'once', at: '2026-11-24T09:00' } }))).rejects.toThrow('Vergangenheit')
    await tasks.save(input({ schedule: { kind: 'once', at: '2026-11-25T08:30' } }))
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    const [task] = tasks.list()
    expect(task).toMatchObject({ enabled: false, nextRunAt: null })
    expect(fake.created).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    expect(fake.created).toHaveLength(1)
    await tasks.dispose()
  })

  it('keeps tasks across a restart and refuses accounts of another CLI', async () => {
    const tasks = make()
    await expect(tasks.save(input({ account: 'acc-codex' }))).rejects.toThrow('anderen CLI')
    await expect(tasks.save(input({ projectId: 'gone' }))).rejects.toThrow('Projekt')
    const task = await tasks.save(input())
    await tasks.setEnabled(task.id, false)
    await tasks.dispose()

    const again = make()
    expect(again.list()).toMatchObject([{ id: task.id, name: 'Briefing', enabled: false, nextRunAt: null }])
    await again.remove(task.id)
    expect(again.list()).toEqual([])
    await again.dispose()
  })

  it('records why a run could not start', async () => {
    const tasks = make()
    fake.sessions.send = async () => {
      throw new Error('Claude Code ist nicht installiert.')
    }
    const task = await tasks.save(input({ schedule: { kind: 'manual' } }))
    // The chat is there with the prompt and the error: it opens.
    expect(await tasks.runNow(task.id)).toMatchObject({ outcome: 'error', sessionId: 'chat-1' })
    expect(tasks.list()[0]!.runs[0]).toMatchObject({ outcome: 'error', sessionId: 'chat-1', error: 'Claude Code ist nicht installiert.' })
    await tasks.dispose()
  })

  describe('limits', () => {
    const below80 = (otherwise: 'skip' | 'wait' = 'skip', runWithoutNumbers = false) =>
      ({ ranges: { session: { min: 0, max: 80 } }, otherwise, runWithoutNumbers }) as const

    it('leaves a run out while the account is past its threshold, and runs once it is below', async () => {
      limits.set('acc-claude', 92)
      const tasks = make()
      tasks.start()
      await tasks.save(input({ usageGuard: below80() }))

      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(fake.created).toHaveLength(0)
      // Numbers an hour old are read anew first.
      expect(limits.refreshed).toEqual(['acc-claude'])
      expect(tasks.list()[0]!.runs[0]).toMatchObject({ trigger: 'schedule', outcome: 'skipped', error: '5 Stunden bei 92 % (läuft bis 80 %)' })
      expect(tasks.list()[0]!.waiting).toBeUndefined()

      limits.set('acc-claude', 80)
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(fake.created).toHaveLength(1)
      expect(tasks.list()[0]!.runs[0]).toMatchObject({ outcome: 'started', sessionId: 'chat-1' })
      await tasks.dispose()
    })

    it('runs only above a point, with the fullest window of a kind', async () => {
      limits.set('acc-claude', 10, 40)
      limits.numbers['acc-claude']!.windows.push({ key: 'weekly_scoped:Opus', label: 'Opus · Woche', usedPercent: 75 })
      const tasks = make()
      tasks.start()
      await tasks.save(input({ usageGuard: { ranges: { week: { min: 70, max: 100 } }, otherwise: 'skip', runWithoutNumbers: false } }))
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(fake.created).toHaveLength(1)

      limits.numbers['acc-claude']!.windows.pop()
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(fake.created).toHaveLength(1)
      expect(tasks.list()[0]!.runs[0]).toMatchObject({ outcome: 'skipped', error: 'Woche bei 40 % (läuft ab 70 %)' })
      await tasks.dispose()
    })

    it('waits until the limits fit and notes how long', async () => {
      limits.set('acc-claude', 92)
      const tasks = make()
      tasks.start()
      await tasks.save(input({ usageGuard: below80('wait') }))

      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(fake.created).toHaveLength(0)
      expect(tasks.list()[0]!.waiting).toEqual({ since: at('2026-11-25T09:00'), trigger: 'schedule', reason: '5 Stunden bei 92 % (läuft bis 80 %)' })
      expect(tasks.list()[0]!.runs).toEqual([])

      await vi.advanceTimersByTimeAsync(30 * 60_000)
      limits.set('acc-claude', 30)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fake.created).toHaveLength(1)
      const [task] = tasks.list()
      expect(task!.waiting).toBeUndefined()
      expect(task!.runs[0]).toMatchObject({ trigger: 'schedule', outcome: 'started', sessionId: 'chat-1' })
      expect(task!.runs[0]!.waited).toBeGreaterThanOrEqual(30 * 60_000)
      expect(task!.nextRunAt).toBe(at('2026-11-26T09:00'))
      await tasks.dispose()
    })

    it('gives a wait up when the next run is due, which checks anew', async () => {
      limits.set('acc-claude', 92)
      const tasks = make()
      tasks.start()
      await tasks.save(input({ usageGuard: below80('wait') }))
      await vi.advanceTimersByTimeAsync(25 * 60 * 60_000)

      const [task] = tasks.list()
      expect(fake.created).toHaveLength(0)
      expect(task!.runs).toMatchObject([{ at: at('2026-11-25T09:00'), outcome: 'skipped' }])
      expect(task!.runs[0]!.waited).toBeGreaterThanOrEqual(24 * 60 * 60_000)
      expect(task!.runs[0]!.error).toContain('bis zum nächsten Lauf nicht')
      expect(task!.waiting).toMatchObject({ since: at('2026-11-26T09:00') })
      await tasks.dispose()
    })

    it('keeps a wait across a restart, and ends it when stopped or switched off', async () => {
      limits.set('acc-claude', 92)
      const tasks = make()
      tasks.start()
      const task = await tasks.save(input({ usageGuard: below80('wait') }))
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      await tasks.dispose()

      const again = make()
      expect(again.list()[0]!.waiting).toMatchObject({ since: at('2026-11-25T09:00') })
      const stopped = await again.stopWaiting(task.id)
      expect(stopped.waiting).toBeUndefined()
      expect(stopped.runs[0]).toMatchObject({ outcome: 'skipped' })
      expect(stopped.runs[0]!.error).toContain('Warten abgebrochen')
      await again.dispose()
    })

    it('ends a wait when the task is switched off or no longer waits', async () => {
      limits.set('acc-claude', 92)
      const tasks = make()
      tasks.start()
      const task = await tasks.save(input({ usageGuard: below80('wait') }))
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      await tasks.setEnabled(task.id, false)
      expect(tasks.list()[0]!.waiting).toBeUndefined()
      expect(tasks.list()[0]!.runs).toMatchObject([{ outcome: 'skipped' }])

      await tasks.setEnabled(task.id, true)
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(tasks.list()[0]!.waiting).toBeDefined()
      // Waits on under new limits, but not once it leaves runs out instead.
      await tasks.save(input({ usageGuard: { ...below80('wait'), ranges: { session: { min: 0, max: 70 } } } }), task.id)
      expect(tasks.list()[0]!.waiting).toBeDefined()
      await tasks.save(input({ usageGuard: below80('skip') }), task.id)
      expect(tasks.list()[0]!.waiting).toBeUndefined()
      expect(tasks.list()[0]!.runs[0]!.error).toContain('Geändert')
      expect(fake.created).toHaveLength(0)
      await tasks.dispose()
    })

    it('holds back without numbers unless the task runs anyway, and reads them first', async () => {
      const tasks = make()
      tasks.start()
      const task = await tasks.save(input({ usageGuard: below80() }))
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(limits.refreshed).toEqual(['acc-claude'])
      expect(tasks.list()[0]!.runs[0]).toMatchObject({ outcome: 'skipped', error: 'Nexa kennt die Limits des Accounts noch nicht' })

      await tasks.save(input({ usageGuard: below80('skip', true) }), task.id)
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(fake.created).toHaveLength(1)

      // The reading brings numbers that fit.
      limits.whenRefreshed((id) => limits.set(id, 20))
      await tasks.save(input({ usageGuard: below80() }), task.id)
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(fake.created).toHaveLength(2)
      await tasks.dispose()
    })

    it('holds an API key to nothing, nor „Jetzt ausführen“', async () => {
      limits.set('acc-claude', 99)
      limits.set('acc-key', 99)
      const tasks = make()
      tasks.start()
      await tasks.save(input({ account: 'acc-key', usageGuard: below80() }))
      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(fake.created).toHaveLength(1)
      expect(limits.refreshed).toEqual([])

      const manual = await tasks.save(input({ schedule: { kind: 'manual' }, usageGuard: below80('wait') }))
      expect(await tasks.runNow(manual.id)).toMatchObject({ outcome: 'started', trigger: 'manual' })
      await tasks.dispose()
    })
  })
})
