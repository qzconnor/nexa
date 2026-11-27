import { randomUUID } from 'node:crypto'
import type { Account } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import {
  checkUsage,
  MAX_TASK_RUNS,
  MAX_TASKS,
  MISSED_AFTER_MS,
  nextRunAfter,
  parseTaskInput,
  parseUsageGuard,
  runTitle,
  waitUntil,
  type ScheduledTask,
  type TaskRun,
  type TaskUsageGuard,
  type TaskWait,
} from '@shared/scheduled-tasks'
import type { Project, ProviderUsage, SendInput, SessionCreateInput, SessionMeta, SessionUpdateInput } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'
import { TypedEmitter } from '../lib/typed-emitter'

/** The longest the timer sleeps: a clock set forward or a computer that slept is noticed within it. */
const MAX_SLEEP_MS = 60_000
/** A run due checks numbers at most this old; older ones are read anew first. */
const FRESH_USAGE_MS = 2 * 60_000
/** A run that waits for its limits reads the numbers anew at most this often (they come every 5 min anyway). */
const WAIT_REREAD_MS = 5 * 60_000

/** What the scheduler needs of the chats (SessionService, a fake in tests). */
export interface ScheduledSessions {
  create(input: SessionCreateInput): Promise<SessionMeta>
  update(id: string, patch: SessionUpdateInput): Promise<SessionMeta>
  send(id: string, input: SendInput): Promise<void>
  exists(id: string): boolean
  isWorking(id: string): boolean
}

/** What the scheduler needs of the limits (ProviderService, a fake in tests). */
export interface ScheduledUsage {
  /** The account a chat of the CLI starts with when it names none. */
  defaultAccount(provider: ProviderId): string
  /** The last numbers of an account. */
  get(accountId: string): ProviderUsage | undefined
  /** Reads the account's numbers anew; fails quietly (the last ones stay). */
  refresh(accountId: string): Promise<void>
}

export interface ScheduledTasksDeps {
  file: string
  sessions: ScheduledSessions
  projects: { get(id: string): Project | undefined }
  accounts: { has(id: string): boolean; get(id: string): Account }
  usage: ScheduledUsage
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
 * `MISSED_AFTER_MS` ago) runs once with `catchUp`, else it counts as missed. A task with limits
 * (`usageGuard`) first looks at its account's usage: when it doesn't fit, the run is skipped or waits
 * until it fits, at most until the next run.
 */
export class ScheduledTasks extends TypedEmitter<{ changed: [ScheduledTask[]] }> {
  private tasks: ScheduledTask[]
  private timer: NodeJS.Timeout | null = null
  private started = false
  private disposed = false
  /** Tasks whose limits are being looked at: a slow reading never checks a task twice at once. */
  private readonly checking = new Set<string>()
  /** When an account's numbers were last asked for, so a waiting run doesn't ask every minute. */
  private readonly lastRead = new Map<string, number>()

  constructor(private readonly deps: ScheduledTasksDeps) {
    super()
    const saved = readJsonGuardedSync<Partial<StoredFile>>(deps.file)
    this.tasks = Array.isArray(saved?.tasks) ? saved.tasks.filter(isTask).map(loadTask) : []
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
      // What the input may leave out goes with the old task, else it would stay.
      const { account: _account, usageGuard: _guard, waiting, ...previous } = this.tasks[index]!
      task = { ...previous, ...input, updatedAt: now, nextRunAt }
      this.tasks[index] = task
      // A run that waits for its limits waits on under the new ones, as long as the task still waits.
      if (waiting && input.enabled && input.usageGuard?.otherwise === 'wait') task.waiting = waiting
      else if (waiting) this.record(task, { at: waiting.since, trigger: waiting.trigger, outcome: 'skipped', error: 'Geändert, während der Lauf auf die Limits wartete.', waited: now - waiting.since })
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
      if (!enabled) this.endWait(task, 'Ausgeschaltet, während der Lauf auf die Limits wartete.')
      await this.changed()
    }
    return structuredClone(task)
  }

  /** Runs the task now, whatever its schedule (also one switched off) and its limits; what came of it. */
  runNow(id: string): Promise<TaskRun> {
    const task = this.require(id)
    // The user's run takes the place of one waiting for its limits.
    delete task.waiting
    return this.run(task, 'manual')
  }

  /** A run waiting for its limits doesn't come; it counts as skipped. */
  async stopWaiting(id: string): Promise<ScheduledTask> {
    const task = this.require(id)
    if (task.waiting) this.endWait(task, `Warten abgebrochen. ${task.waiting.reason}`)
    return structuredClone(task)
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
      // A run waiting for its limits gives up when the next is due (the next checks anew), else looks again.
      if (task.waiting) {
        if (waitUntil(task, task.waiting) <= now) this.endWait(task, `Die Limits passten bis zum nächsten Lauf nicht. ${task.waiting.reason}`)
        else void this.recheck(task)
      }
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
      void this.due(task, missed ? 'catch-up' : 'schedule', now)
    }
    if (moved) void this.changed()
    else this.arm(now)
  }

  private arm(now: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.disposed) return
    const due = this.tasks.filter((t) => t.enabled && t.nextRunAt !== null).map((t) => t.nextRunAt!)
    // A run waiting for its limits is looked at each minute.
    const waiting = this.tasks.some((t) => t.waiting)
    if (!due.length && !waiting) return
    const wait = Math.min(Math.max(Math.min(...due) - now, 1000), MAX_SLEEP_MS)
    this.timer = setTimeout(() => this.tick(), wait)
    this.timer.unref?.()
  }

  /** A run its schedule brings (or Nexa's start): first the limits, if the task holds to any. */
  private async due(task: ScheduledTask, trigger: 'schedule' | 'catch-up', at: number): Promise<void> {
    const guard = task.usageGuard
    if (!guard) {
      await this.run(task, trigger)
      return
    }
    let fits: true | string
    try {
      fits = await this.fits(task, guard, FRESH_USAGE_MS)
    } catch (error) {
      console.warn('[scheduled] limits check failed', task.name, error)
      fits = `Die Limits ließen sich nicht prüfen: ${error instanceof Error ? error.message : String(error)}`
    }
    // Gone while the numbers came.
    if (!this.tasks.includes(task)) return
    if (fits === true) {
      await this.run(task, trigger)
    } else if (guard.otherwise === 'wait') {
      task.waiting = { since: at, trigger, reason: fits }
      void this.changed()
    } else {
      this.record(task, { at, trigger, outcome: 'skipped', error: fits })
    }
  }

  /** A run waiting for its limits: starts once they fit. */
  private async recheck(task: ScheduledTask): Promise<void> {
    const wait = task.waiting
    const guard = task.usageGuard
    if (!wait || !guard || this.checking.has(task.id)) return
    this.checking.add(task.id)
    try {
      const fits = await this.fits(task, guard, WAIT_REREAD_MS)
      // Ended meanwhile (stopped, switched off, run by hand, the next run came).
      if (task.waiting !== wait || !this.tasks.includes(task)) return
      if (fits !== true) {
        if (fits !== wait.reason) {
          wait.reason = fits
          void this.changed()
        }
        return
      }
      delete task.waiting
      await this.run(task, wait.trigger, wait.since)
    } catch (error) {
      // Looked at again in a minute.
      console.warn('[scheduled] limits check failed', task.name, error)
    } finally {
      this.checking.delete(task.id)
    }
  }

  /**
   * Whether the usage of the account the task runs with fits its limits now: true, else why not. Numbers
   * older than `maxAge` are read anew first (at most once in `maxAge` per account).
   */
  private async fits(task: ScheduledTask, guard: TaskUsageGuard, maxAge: number): Promise<true | string> {
    const accountId = task.account && this.deps.accounts.has(task.account) ? task.account : this.deps.usage.defaultAccount(task.provider)
    // An API key bills each token: there are no plan limits to hold to.
    if (this.deps.accounts.has(accountId) && this.deps.accounts.get(accountId).kind === 'apiKey') return true
    const now = Date.now()
    const known = this.deps.usage.get(accountId)
    if ((!known || now - known.updatedAt > maxAge) && now - (this.lastRead.get(accountId) ?? 0) > maxAge) {
      this.lastRead.set(accountId, now)
      await this.deps.usage.refresh(accountId).catch((error) => console.warn('[scheduled] could not read the limits', error))
    }
    const check = checkUsage(guard, this.deps.usage.get(accountId), Date.now())
    if (check.fits || (check.fits === null && guard.runWithoutNumbers)) return true
    return check.reason
  }

  /** A run that waited for its limits doesn't come: it counts as skipped, `why` says why. */
  private endWait(task: ScheduledTask, why: string): void {
    const wait = task.waiting
    if (!wait) return
    delete task.waiting
    this.record(task, { at: wait.since, trigger: wait.trigger, outcome: 'skipped', error: why, waited: Date.now() - wait.since })
  }

  /**
   * One run: a prompt in the chat of the last run or a new one; what came of it goes into `runs`.
   * `waitedSince`: it was due then and waited for its limits.
   */
  private async run(task: ScheduledTask, trigger: TaskRun['trigger'], waitedSince?: number): Promise<TaskRun> {
    const at = Date.now()
    const waited = waitedSince !== undefined ? { waited: at - waitedSince } : {}
    const last = task.runs.find((r) => r.sessionId && this.deps.sessions.exists(r.sessionId))?.sessionId
    if (last && this.deps.sessions.isWorking(last)) {
      return this.record(task, { at, trigger, outcome: 'skipped', sessionId: last, error: 'Der Chat des letzten Laufs arbeitet noch.', ...waited })
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
      return this.record(task, { at, trigger, outcome: 'started', sessionId, ...waited })
    } catch (error) {
      console.warn('[scheduled] run failed', task.name, error)
      return this.record(task, { at, trigger, outcome: 'error', ...(sessionId ? { sessionId } : {}), error: error instanceof Error ? error.message : String(error), ...waited })
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

/** A task from the file, without what a hand-edited file could break: limits that don't parse, a wait without them. */
function loadTask(task: ScheduledTask): ScheduledTask {
  const { usageGuard: rawGuard, waiting: rawWait, ...rest } = task
  let usageGuard: TaskUsageGuard | undefined
  try {
    usageGuard = parseUsageGuard(rawGuard)
  } catch {
    usageGuard = undefined
  }
  const wait: unknown = rawWait
  const trigger = isPlainObject(wait) ? (['schedule', 'catch-up'] as const).find((t) => t === wait.trigger) : undefined
  const waiting: TaskWait | undefined =
    usageGuard?.otherwise === 'wait' && isPlainObject(wait) && trigger && typeof wait.since === 'number' && typeof wait.reason === 'string'
      ? { since: wait.since, reason: wait.reason, trigger }
      : undefined
  return { ...rest, runs: task.runs.slice(0, MAX_TASK_RUNS), ...(usageGuard ? { usageGuard } : {}), ...(waiting ? { waiting } : {}) }
}
