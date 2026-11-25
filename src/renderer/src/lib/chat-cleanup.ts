import type { SessionMeta, SessionRemoveResult } from '@shared/types'
import { baseName } from '@shared/utils'

/** Which chats the clean-up dialog lists. */
export interface CleanupFilter {
  /** Untouched for more than this many days; 0: any age. */
  olderThanDays: number
  /** Taking more than this many MB on disk; 0: any size. */
  largerThanMb: number
  /** One project's chats; null: all. */
  projectId: string | null
  /** Only archived chats, or only those not archived. */
  archived: 'all' | 'only' | 'none'
}

export const AGE_STEPS = [0, 7, 30, 90, 365] as const
export const SIZE_STEPS = [0, 1, 10, 100] as const

const DAY_MS = 86_400_000
const MB = 1024 * 1024

/** `bytes`: undefined while sizes are still being counted (the size filter lets everything through until then). */
export function cleanupMatches(meta: SessionMeta, bytes: number | undefined, filter: CleanupFilter, now: number): boolean {
  if (filter.projectId && meta.projectId !== filter.projectId) return false
  if (filter.archived === 'only' && !meta.archived) return false
  if (filter.archived === 'none' && meta.archived) return false
  if (filter.olderThanDays > 0 && now - meta.updatedAt < filter.olderThanDays * DAY_MS) return false
  if (filter.largerThanMb > 0 && bytes !== undefined && bytes <= filter.largerThanMb * MB) return false
  return true
}

export function ageLabel(days: number): string {
  if (days === 0) return 'Jedes Alter'
  if (days === 365) return 'Älter als 1 Jahr'
  return `Älter als ${days} Tage`
}

export function sizeLabel(mb: number): string {
  return mb === 0 ? 'Jede Größe' : `Größer als ${mb} MB`
}

/** „„Titel“ gelöscht“ or „3 Chats gelöscht“. */
export function removedTitle(metas: readonly Pick<SessionMeta, 'title'>[]): string {
  return metas.length === 1 ? `„${metas[0]!.title}“ gelöscht` : `${metas.length} Chats gelöscht`
}

/** What the confirmation for deleting several chats says they lose; `worktrees`: how many of them have one. */
export function removalDescription(count: number, withCli: boolean, worktrees = 0): string {
  const whose = count === 1 ? 'Sein' : 'Ihr'
  const lost = `${whose} Verlauf in Nexa geht verloren`
  const text = withCli
    ? `${lost}, ${count === 1 ? 'seine Unterhaltung' : 'ihre Unterhaltungen'} in den CLIs ${count === 1 ? 'kommt' : 'kommen'} in den Papierkorb.`
    : `${lost}.`
  const note = worktreeNote(worktrees, count === 1)
  return note ? `${text} ${note}` : text
}

/**
 * What deleting chats does to their worktrees (`SessionMeta.worktree`, see `SessionService.remove`);
 * empty when none has one. `own`: the one chat's, as „Sein Worktree“.
 */
export function worktreeNote(worktrees: number, own = false): string {
  if (worktrees === 0) return ''
  const which = own ? 'Sein Worktree wird' : worktrees === 1 ? 'Ein Worktree wird' : `${worktrees} Worktrees werden`
  return `${which} ebenfalls entfernt, sofern darin keine Änderungen und keine eigenen Commits sind.`
}

/** Something deleting chats left otherwise than asked; `folder`: one to open, where it lies. */
export interface RemovalProblem {
  title: string
  description: string
  error: boolean
  folder?: string
}

/** What went otherwise than asked when chats were deleted; nothing when all went as asked. */
export function removalProblems(result: SessionRemoveResult): RemovalProblem[] {
  const problems: RemovalProblem[] = []
  const open = result.openElsewhere.length
  if (open > 0) {
    problems.push({
      title: open === 1 ? 'Ein Transkript bleibt' : `${open} Transkripte bleiben`,
      description: `${open === 1 ? 'Die Unterhaltung ist' : 'Diese Unterhaltungen sind'} außerhalb von Nexa in Claude Code oder Codex offen, ihre Dateien bleiben liegen.`,
      error: false,
    })
  }
  if (result.failed > 0) {
    const files = result.failed === 1 ? 'Eine Datei der CLIs blieb' : `${result.failed} Dateien der CLIs blieben`
    problems.push({
      title: 'Nicht alles kam in den Papierkorb',
      description: `${files} liegen${result.error ? `: ${result.error}` : '.'}`,
      error: true,
    })
  }
  for (const kept of result.worktreesKept ?? []) {
    problems.push({ title: `Worktree „${baseName(kept.path)}“ bleibt`, description: kept.reason, error: false, folder: kept.path })
  }
  return problems
}
