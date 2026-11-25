import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@shared/accounts'
import type { ScheduledTask, ScheduledTaskInput } from '@shared/scheduled-tasks'
import type { Project, SessionCreateInput, SessionMeta } from '@shared/types'
import { ScheduledTasks, type ScheduledSessions } from './scheduled-tasks'

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
  const accounts: Record<string, Partial<Account>> = { 'acc-claude': { id: 'acc-claude', provider: 'claude' }, 'acc-codex': { id: 'acc-codex', provider: 'codex' } }
  const make = () =>
    new ScheduledTasks({
      file,
      sessions: fake.sessions,
      projects: { get: (id) => (id === 'p1' ? ({ id: 'p1', name: 'nexa', path: 'F:\\nexa' } as Project) : undefined) },
      accounts: { has: (id) => id in accounts, get: (id) => accounts[id] as Account },
    })

  beforeEach(() => {
    vi.useFakeTimers({ now: at('2026-11-25T08:00') })
    dir = mkdtempSync(join(tmpdir(), 'nexa-scheduled-'))
    file = join(dir, 'scheduled-tasks.json')
    fake = fakeSessions()
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
})
