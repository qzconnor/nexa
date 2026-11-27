import { describe, expect, it } from 'vitest'
import type { ScheduledTask } from '@shared/scheduled-tasks'
import { formatWhen, guardOfDraft, limitsDraft, permissionNote, runDetail, sortTasks, taskPermissionMode } from './scheduled'

const at = (text: string) => new Date(text).getTime()

describe('formatWhen', () => {
  const now = at('2026-11-25T10:00')
  it('says today, tomorrow and yesterday, then the weekday, then the date', () => {
    expect(formatWhen(at('2026-11-25T09:05'), now)).toBe('heute, 9:05')
    expect(formatWhen(at('2026-11-26T07:18'), now)).toBe('morgen, 7:18')
    expect(formatWhen(at('2026-11-24T23:00'), now)).toBe('gestern, 23:00')
    expect(formatWhen(at('2026-11-27T09:00'), now)).toBe('Fr., 9:00')
    expect(formatWhen(at('2026-12-10T09:00'), now)).toBe('10.12., 9:00')
    expect(formatWhen(at('2027-01-04T09:00'), now)).toBe('4.1.2027, 9:00')
  })
})

describe('taskPermissionMode', () => {
  it('takes the classifier where the CLI has one, else the default for chats', () => {
    expect(taskPermissionMode('claude', 'ask')).toBe('auto')
    expect(taskPermissionMode('codex', 'edits')).toBe('edits')
    expect(taskPermissionMode('codex', 'auto')).toBe('ask')
  })
})

describe('permissionNote', () => {
  it('warns that asking permissions hold a run up, and full ones are risky', () => {
    expect(permissionNote('ask').tone).toBe('warning')
    expect(permissionNote('edits').tone).toBe('warning')
    expect(permissionNote('full').tone).toBe('danger')
  })
})

describe('limits in the dialog', () => {
  it('starts switched off, with room below 80 % once switched on', () => {
    const draft = limitsDraft(undefined)
    expect(draft).toMatchObject({ on: false, ranges: { session: [0, 80], week: [0, 80] }, otherwise: 'skip' })
    expect(guardOfDraft(draft)).toBeUndefined()
    expect(guardOfDraft({ ...draft, on: true })).toEqual({ ranges: { session: { min: 0, max: 80 }, week: { min: 0, max: 80 } }, otherwise: 'skip', runWithoutNumbers: false })
  })

  it('shows a task’s limits, a window without one as the whole range, and gives them back', () => {
    const guard = { ranges: { week: { min: 50, max: 100 } }, otherwise: 'wait' as const, runWithoutNumbers: true }
    const draft = limitsDraft(guard)
    expect(draft).toEqual({ on: true, ranges: { session: [0, 100], week: [50, 100] }, otherwise: 'wait', runWithoutNumbers: true })
    expect(guardOfDraft(draft)).toEqual(guard)
    // Nothing held back: no limits.
    expect(guardOfDraft({ ...draft, ranges: { session: [0, 100], week: [0, 100] } })).toBeUndefined()
  })
})

describe('runDetail', () => {
  it('says how long a run waited for its limits', () => {
    expect(runDetail({ at: 0, trigger: 'schedule', outcome: 'started', waited: 90 * 60_000 })).toBe('Wartete 1 Std. 30 Min., bis die Limits passten.')
    expect(runDetail({ at: 0, trigger: 'schedule', outcome: 'skipped', error: 'Warten abgebrochen.', waited: 5 * 60_000 })).toBe(
      'Warten abgebrochen. Wartete 5 Min. auf die Limits.',
    )
    expect(runDetail({ at: 0, trigger: 'manual', outcome: 'started' })).toBeNull()
  })
})

describe('sortTasks', () => {
  const task = (name: string, enabled: boolean, nextRunAt: number | null) => ({ name, enabled, nextRunAt }) as ScheduledTask
  it('lists what runs next first, then the rest by name', () => {
    const sorted = sortTasks([task('Zeta', false, 5), task('Beta', true, 20), task('Alpha', true, null), task('Gamma', true, 10)])
    expect(sorted.map((t) => t.name)).toEqual(['Gamma', 'Beta', 'Alpha', 'Zeta'])
  })
})
