import { describe, expect, it } from 'vitest'
import type { ScheduledTask } from '@shared/scheduled-tasks'
import { formatWhen, permissionNote, sortTasks, taskPermissionMode } from './scheduled'

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

describe('sortTasks', () => {
  const task = (name: string, enabled: boolean, nextRunAt: number | null) => ({ name, enabled, nextRunAt }) as ScheduledTask
  it('lists what runs next first, then the rest by name', () => {
    const sorted = sortTasks([task('Zeta', false, 5), task('Beta', true, 20), task('Alpha', true, null), task('Gamma', true, 10)])
    expect(sorted.map((t) => t.name)).toEqual(['Gamma', 'Beta', 'Alpha', 'Zeta'])
  })
})
