import type { PermissionMode, ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import {
  USAGE_WINDOW_KINDS,
  waitUntil,
  type ScheduledTask,
  type TaskRun,
  type TaskScheduleKind,
  type TaskUsageGuard,
  type TaskWait,
  type UsageWindowKind,
} from '@shared/scheduled-tasks'
import { formatSpan } from './format'

/** What the page „Geplant“ says of tasks and their runs, apart from Vue so it can be tested. */

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0)
const pad = (n: number) => String(n).padStart(2, '0')
const WEEKDAY = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']

/** A moment near now as people say it: „heute, 9:00“, „morgen, 7:18“, „Fr., 9:00“, „28.11., 9:00“. */
export function formatWhen(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const clock = `${d.getHours()}:${pad(d.getMinutes())}`
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / 86_400_000)
  if (days === 0) return `heute, ${clock}`
  if (days === 1) return `morgen, ${clock}`
  if (days === -1) return `gestern, ${clock}`
  if (days > 1 && days < 7) return `${WEEKDAY[d.getDay()]}, ${clock}`
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : String(d.getFullYear())
  return `${d.getDate()}.${d.getMonth() + 1}.${year}, ${clock}`
}

/** A run in words, for the row of its task. */
export function runLabel(run: TaskRun): string {
  switch (run.outcome) {
    case 'started':
      return run.trigger === 'manual' ? 'von Hand gestartet' : run.trigger === 'catch-up' ? 'nachgeholt' : 'gelaufen'
    case 'skipped':
      return 'übersprungen'
    case 'missed':
      return 'verpasst'
    case 'error':
      return 'fehlgeschlagen'
  }
}

/** Why a run didn't happen as planned, and how long it waited for its limits, for its tooltip. */
export function runDetail(run: TaskRun): string | null {
  if (run.outcome === 'missed') return 'Nexa lief nicht oder der Computer schlief, und die Aufgabe holt nichts nach.'
  const waited = run.waited ? (run.outcome === 'skipped' ? `Wartete ${formatSpan(run.waited)} auf die Limits.` : `Wartete ${formatSpan(run.waited)}, bis die Limits passten.`) : null
  return [run.error, waited].filter(Boolean).join(' ') || null
}

/** What a run waiting for its limits waits for and until when, for its tooltip. */
export function waitDetail(task: ScheduledTask, wait: TaskWait, now = Date.now()): string {
  return `${wait.reason}. Läuft, sobald die Limits passen; wartet höchstens bis ${formatWhen(waitUntil(task, wait), now)}.`
}

/** The limits as the dialog edits them: each kind of window with both ends, also when they hold nothing back. */
export interface LimitsDraft {
  on: boolean
  ranges: Record<UsageWindowKind, [min: number, max: number]>
  otherwise: TaskUsageGuard['otherwise']
  runWithoutNumbers: boolean
}

/** Where the limits start when switched on: room for other work in both windows. */
const DEFAULT_MAX = 80

/** The dialog's limits for a task's; switched off without any. */
export function limitsDraft(guard: TaskUsageGuard | undefined): LimitsDraft {
  const range = (kind: UsageWindowKind): [number, number] => {
    const r = guard ? guard.ranges[kind] : { min: 0, max: DEFAULT_MAX }
    return r ? [r.min, r.max] : [0, 100]
  }
  return {
    on: !!guard,
    ranges: { session: range('session'), week: range('week') },
    otherwise: guard?.otherwise ?? 'skip',
    runWithoutNumbers: guard?.runWithoutNumbers ?? false,
  }
}

/** The task's limits from the dialog's; none when off or no range holds anything back. */
export function guardOfDraft(draft: LimitsDraft): TaskUsageGuard | undefined {
  if (!draft.on) return undefined
  const ranges: TaskUsageGuard['ranges'] = {}
  for (const kind of USAGE_WINDOW_KINDS) {
    const [min, max] = draft.ranges[kind]
    if (min > 0 || max < 100) ranges[kind] = { min, max }
  }
  return Object.keys(ranges).length ? { ranges, otherwise: draft.otherwise, runWithoutNumbers: draft.runWithoutNumbers } : undefined
}

/** The schedules the dialog offers, in its order. */
export const SCHEDULE_KINDS: { value: TaskScheduleKind; label: string }[] = [
  { value: 'daily', label: 'Täglich' },
  { value: 'weekdays', label: 'Wochentags' },
  { value: 'weekly', label: 'Wöchentlich' },
  { value: 'monthly', label: 'Monatlich' },
  { value: 'hourly', label: 'Stündlich' },
  { value: 'once', label: 'Einmalig' },
  { value: 'manual', label: 'Nur von Hand' },
]

/**
 * The permissions a new task starts with: nobody is there to answer, so the classifier where the CLI
 * has one (Claude Code, Antigravity CLI), else the user's default for chats.
 */
export function taskPermissionMode(provider: ProviderId, fallback: PermissionMode): PermissionMode {
  const modes = PROVIDERS[provider].permissionModes
  return modes.includes('auto') ? 'auto' : modes.includes(fallback) ? fallback : 'ask'
}

/** What the permissions mean for a run nobody watches, for the box under the instructions. */
export function permissionNote(mode: PermissionMode): { tone: 'info' | 'warning' | 'danger'; text: string } {
  switch (mode) {
    case 'auto':
      return { tone: 'info', text: 'Ein Klassifikator entscheidet über Freigaben: Der Agent arbeitet ohne anzuhalten und fragt nur, wenn etwas riskant aussieht.' }
    case 'full':
      return { tone: 'danger', text: 'Der Agent darf alles ohne Nachfrage, auch Dateien löschen und beliebige Befehle ausführen. Nur in Ordnern, denen du vertraust.' }
    case 'plan':
      return { tone: 'info', text: 'Der Agent liest nur und schlägt einen Plan vor. Gut für Berichte und Übersichten, die nichts ändern sollen.' }
    default:
      return {
        tone: 'warning',
        text: 'Der Agent hält bei jeder Freigabe an, bis du antwortest. Eine Meldung sagt dir Bescheid; bis dahin wartet der Lauf.',
      }
  }
}

/** The tasks as the page lists them: those that run on their own first, by their next run; then the rest by name. */
export function sortTasks(tasks: readonly ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((a, b) => {
    const an = a.enabled ? a.nextRunAt : null
    const bn = b.enabled ? b.nextRunAt : null
    if (an !== null && bn !== null) return an - bn
    if (an !== null) return -1
    if (bn !== null) return 1
    return a.name.localeCompare(b.name, 'de')
  })
}
