import { randomUUID } from 'node:crypto'
import type { Account } from '@shared/accounts'
import {
  MAX_TASK_RUNS,
  MAX_TASKS,
  MISSED_AFTER_MS,
  nextRunAfter,
  parseTaskInput,
  runTitle,
  type ScheduledTask,
  type TaskRun,
} from '@shared/scheduled-tasks'
import type { Project, SendInput, SessionCreateInput, SessionMeta, SessionUpdateInput } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'
import { TypedEmitter } from '../lib/typed-emitter'

/** The longest the timer sleeps: a clock set forward or a computer that slept is noticed within it. */
const MAX_SLEEP_MS = 60_000

/** What the scheduler needs of the chats (SessionService, a fake in tests). */
export interface ScheduledSessions {
  create(input: SessionCreateInput): Promise<SessionMeta>
  update(id: string, patch: SessionUpdateInput): Promise<SessionMeta>
  send(id: string, input: SendInput): Promise<void>
  exists(id: string): boolean
  isWorking(id: string): boolean
}

export interface ScheduledTasksDeps {
  file: string
  sessions: ScheduledSessions
  projects: { get(id: string): Project | undefined }
  accounts: { has(id: string): boolean; get(id: string): Account }
}

interface StoredFile {
  version: 1
  tasks: ScheduledTask[]
}

/**
 * The scheduled tasks: kept in `scheduled-tasks.json`, run while Nexa runs. A run is a prompt in a new
 * chat of the task's project with its CLI, account, model and permissions (or on in the chat of the
 * last run, `reuseChat`), named after the task and the time. A run that is due while the last run's
 * chat still works is skipped. One that was due while Nexa was off or the computer slept (more than
 * `MISSED_AFTER_MS` ago) runs once with `catchUp`, else it counts as missed.
 */
export class ScheduledTasks extends TypedEmitter<{ changed: [ScheduledTask[]] }> {
  private tasks: ScheduledTask[]
  private timer: NodeJS.Timeout | null = null
  private started = false
  private disposed = false

  constructor(private readonly deps: ScheduledTasksDeps) {
    super()
    const saved = readJsonGuardedSync<Partial<StoredFile>>(deps.file)
    this.tasks = Array.isArray(saved?.tasks) ? saved.tasks.filter(isTask).map((task) => ({ ...task, runs: task.runs.slice(0, MAX_TASK_RUNS) })) : []
  }

  list(): ScheduledTask[] {
    return structuredClone(this.tasks)
  }

  /**
   * Starts the clock, once the CLIs are known: what fell due while Nexa was off runs now (with
   * `catchUp`) or counts as missed, then each task at its time.
   */
  start(): void {
    if (this.started || this.disposed) return
    this.started = true
    this.tick()
  }

  /** A new task without `id`, else changes that one; its next run counts from now. */
  async save(value: unknown, id?: string): Promise<ScheduledTask> {
    const input = parseTaskInput(value)
    if (!this.deps.projects.get(input.projectId)) throw new Error('Das Projekt gibt es nicht mehr.')
    if (input.account) {
      if (!this.deps.accounts.has(input.account)) throw new Error('Den Account gibt es nicht mehr.')
      if (this.deps.accounts.get(input.account).provider !== input.provider) throw new Error('Der Account gehört zu einer anderen CLI.')
    }
    const now = Date.now()
    const nextRunAt = input.enabled ? this.nextOrRefuse(input.schedule, now) : null
    let task: ScheduledTask
    if (id) {
      const index = this.tasks.findIndex((t) => t.id === id)
      if (index < 0) throw new Error('Die Aufgabe gibt es nicht mehr.')
      const { account: _account, ...previous } = this.tasks[index]!
      task = { ...previous, ...input, updatedAt: now, nextRunAt }
      this.tasks[index] = task
    } else {
      if (this.tasks.length >= MAX_TASKS) throw new Error(`Nexa hält höchstens ${MAX_TASKS} geplante Aufgaben.`)
      task = { ...input, id: randomUUID(), createdAt: now, updatedAt: now, nextRunAt, runs: [] }
      this.tasks.push(task)
    }
    await this.changed()
    return structuredClone(task)
  }

  async remove(id: string): Promise<void> {
    const before = this.tasks.length
    this.tasks = this.tasks.filter((t) => t.id !== id)
    if (this.tasks.length !== before) await this.changed()
  }

  /** On again: the next run counts from now, nothing missed meanwhile comes. */
  async setEnabled(id: string, enabled: boolean): Promise<ScheduledTask> {
    const task = this.require(id)
    if (task.enabled !== enabled) {
      task.nextRunAt = enabled ? this.nextOrRefuse(task.schedule, Date.now()) : null
      task.enabled = enabled
      task.updatedAt = Date.now()
      await this.changed()
    }
    return structuredClone(task)
  }

  /** Runs the task now, whatever its schedule (also one switched off); what came of it. */
  runNow(id: string): Promise<TaskRun> {
    return this.run(this.require(id), 'manual')
  }

  dispose(): Promise<void> {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    return this.persist()
  }

  // ---------------------------------------------------------------------------------------------

  private require(id: string): ScheduledTask {
    const task = this.tasks.find((t) => t.id === id)
    if (!task) throw new Error('Die Aufgabe gibt es nicht mehr.')
    return task
  }

  /** The next run; a single run whose time has passed is refused, so it isn't saved to never come. */
  private nextOrRefuse(schedule: ScheduledTask['schedule'], now: number): number | null {
    const next = nextRunAfter(schedule, now)
    if (next === null && schedule.kind === 'once') throw new Error('Der Zeitpunkt liegt in der Vergangenheit.')
    return next
  }

  /** Runs what is due, then sleeps until the next run (at most a minute). */
  private tick(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.started || this.disposed) return
    const now = Date.now()
    let moved = false
    for (const task of this.tasks) {
      if (!task.enabled || task.nextRunAt === null || task.nextRunAt > now) continue
      const missed = now - task.nextRunAt > MISSED_AFTER_MS
      // Moved on before it runs: a run that takes a while never makes it due twice.
      task.nextRunAt = nextRunAfter(task.schedule, now)
      if (task.schedule.kind === 'once') task.enabled = false
      moved = true
      if (missed && !task.catchUp) {
        this.record(task, { at: now, trigger: 'schedule', outcome: 'missed' })
        continue
      }
      void this.run(task, missed ? 'catch-up' : 'schedule')
    }
    if (moved) void this.changed()
    else this.arm(now)
  }

  private arm(now: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.disposed) return
    const due =this.tasks.filter((t) => t.enabled && t.nextRunAt !== null).map((t) => t.nextRunAt!)
    if (!due.length) return
    const wait = Math.min(Math.max(Math.min(...due) - now, 1000), MAX_SLEEP_MS)
    this.timer = setTimeout(() => this.tick(), wait)
    this.timer.unref?.()
  }

  /** One run: a prompt in the chat of the last run or a new one; what came of it goes into `runs`. */
  private async run(task: ScheduledTask, trigger: TaskRun['trigger']): Promise<TaskRun> {
    const at = Date.now()
    const last = task.runs.find((r) => r.sessionId && this.deps.sessions.exists(r.sessionId))?.sessionId
    if (last && this.deps.sessions.isWorking(last)) {
      return this.record(task, { at, trigger, outcome: 'skipped', sessionId: last, error: 'Der Chat des letzten Laufs arbeitet noch.' })
    }
    let sessionId: string | undefined
    try {
      if (!this.deps.projects.get(task.projectId)) throw new Error('Das Projekt der Aufgabe gibt es nicht mehr.')
      if (task.reuseChat && last) {
        sessionId = last
      } else {
        const meta = await this.deps.sessions.create({
          projectId: task.projectId,
          provider: task.provider,
          // A removed account: the CLI's default, as for any chat.
          account: task.account && this.deps.accounts.has(task.account) ? task.account : undefined,
          model: task.model || undefined,
          effort: task.effort || undefined,
          permissionMode: task.permissionMode,
          scheduledTask: { id: task.id, name: task.name },
        })
        sessionId = meta.id
        await this.deps.sessions.update(meta.id, { title: runTitle(task.name, at) })
      }
      await this.deps.sessions.send(sessionId, { text: task.prompt })
      return this.record(task, { at, trigger, outcome: 'started', sessionId })
    } catch (error) {
      console.warn('[scheduled] run failed', task.name, error)
      return this.record(task, { at, trigger, outcome: 'error', ...(sessionId ? { sessionId } : {}), error: error instanceof Error ? error.message : String(error) })
    }
  }

  private record(task: ScheduledTask, run: TaskRun): TaskRun {
    task.runs = [run, ...task.runs].slice(0, MAX_TASK_RUNS)
    // The task may have gone while it ran: then there is nothing to keep.
    if (this.tasks.includes(task)) void this.changed()
    return run
  }

  private async changed(): Promise<void> {
    this.emit('changed', this.list())
    if (this.started) this.arm(Date.now())
    await this.persist()
  }

  private persist(): Promise<void> {
    const data: StoredFile = { version: 1, tasks: this.tasks }
    return writeJsonAtomic(this.deps.file, data, { guarded: true }).catch((error) => console.error('[scheduled] could not save', error))
  }
}

function isTask(value: unknown): value is ScheduledTask {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.prompt === 'string' &&
    isPlainObject(value.schedule) &&
    typeof value.projectId === 'string' &&
    Array.isArray(value.runs)
  )
}
