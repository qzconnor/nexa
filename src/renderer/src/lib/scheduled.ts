import type { PermissionMode, ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type { ScheduledTask, TaskRun, TaskScheduleKind } from '@shared/scheduled-tasks'

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

/** Why a run didn't happen as planned, for its tooltip. */
export function runDetail(run: TaskRun): string | null {
  if (run.outcome === 'missed') return 'Nexa lief nicht oder der Computer schlief, und die Aufgabe holt nichts nach.'
  return run.error ?? null
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
