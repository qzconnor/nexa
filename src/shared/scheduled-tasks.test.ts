import { describe, expect, it } from 'vitest'
import { describeSchedule, localDateTime, nextRunAfter, parseLocalDateTime, parseSchedule, parseTaskInput, runTitle, type TaskSchedule } from './scheduled-tasks'

/** Local time (the tests run in Europe/Berlin). */
const at = (text: string) => new Date(text).getTime()
const next = (schedule: TaskSchedule, after: string) => {
  const time = nextRunAfter(schedule, at(after))
  return time === null ? null : localDateTime(time)
}

describe('nextRunAfter', () => {
  it('runs daily at its time, later the same day or the next', () => {
    expect(next({ kind: 'daily', time: '09:30' }, '2026-11-25T08:00')).toBe('2026-11-25T09:30')
    expect(next({ kind: 'daily', time: '09:30' }, '2026-11-25T09:30')).toBe('2026-11-26T09:30')
  })

  it('skips the weekend on weekdays', () => {
    // Friday evening → Monday.
    expect(next({ kind: 'weekdays', time: '07:18' }, '2026-11-27T20:00')).toBe('2026-11-30T07:18')
  })

  it('runs weekly on the days picked', () => {
    // Wednesday → Friday, then Monday.
    const schedule: TaskSchedule = { kind: 'weekly', days: [1, 5], time: '09:00' }
    expect(next(schedule, '2026-11-25T10:00')).toBe('2026-11-27T09:00')
    expect(next(schedule, '2026-11-27T09:00')).toBe('2026-11-30T09:00')
    expect(next({ kind: 'weekly', days: [], time: '09:00' }, '2026-11-25T10:00')).toBeNull()
  })

  it('runs monthly, on the last day of a shorter month', () => {
    expect(next({ kind: 'monthly', day: 1, time: '08:00' }, '2026-11-25T10:00')).toBe('2026-12-01T08:00')
    expect(next({ kind: 'monthly', day: 31, time: '08:00' }, '2026-02-10T10:00')).toBe('2026-02-28T08:00')
    expect(next({ kind: 'monthly', day: 31, time: '08:00' }, '2026-02-28T08:00')).toBe('2026-03-31T08:00')
  })

  it('runs hourly in steps from midnight', () => {
    expect(next({ kind: 'hourly', every: 1, minute: 15 }, '2026-11-25T10:20')).toBe('2026-11-25T11:15')
    expect(next({ kind: 'hourly', every: 1, minute: 15 }, '2026-11-25T10:10')).toBe('2026-11-25T10:15')
    expect(next({ kind: 'hourly', every: 6, minute: 0 }, '2026-11-25T19:00')).toBe('2026-11-26T00:00')
  })

  it('runs once, and not after that', () => {
    expect(next({ kind: 'once', at: '2026-12-24T18:00' }, '2026-11-25T10:00')).toBe('2026-12-24T18:00')
    expect(next({ kind: 'once', at: '2026-12-24T18:00' }, '2026-12-24T18:00')).toBeNull()
  })

  it('never runs by hand on its own', () => {
    expect(next({ kind: 'manual' }, '2026-11-25T10:00')).toBeNull()
  })

  it('keeps the wall clock over the change to summer time', () => {
    // 29 March 2026: 02:00 becomes 03:00 in Berlin; the run at 08:00 stays at 08:00.
    expect(next({ kind: 'daily', time: '08:00' }, '2026-03-28T09:00')).toBe('2026-03-29T08:00')
    // A time the clock skips runs an hour later.
    expect(next({ kind: 'daily', time: '02:30' }, '2026-03-28T09:00')).toBe('2026-03-29T03:30')
  })
})

describe('parseLocalDateTime', () => {
  it('reads a real date and refuses others', () => {
    expect(parseLocalDateTime('2026-11-25T09:05')).toBe(at('2026-11-25T09:05'))
    expect(parseLocalDateTime('2026-02-31T09:05')).toBeNull()
    expect(parseLocalDateTime('25.11.2026 09:05')).toBeNull()
  })
})

describe('describeSchedule', () => {
  it('says when a task runs, as Claude Desktop does', () => {
    expect(describeSchedule({ kind: 'daily', time: '09:38' })).toBe('Täglich um 9:38')
    expect(describeSchedule({ kind: 'weekdays', time: '07:18' })).toBe('Wochentags um 7:18')
    expect(describeSchedule({ kind: 'weekly', days: [1], time: '09:16' })).toBe('Jeden Montag um 9:16')
    expect(describeSchedule({ kind: 'weekly', days: [5, 1, 3], time: '10:00' })).toBe('Mo, Mi und Fr um 10:00')
    expect(describeSchedule({ kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '10:00' })).toBe('Täglich um 10:00')
    expect(describeSchedule({ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '10:00' })).toBe('Wochentags um 10:00')
    expect(describeSchedule({ kind: 'hourly', every: 1, minute: 0 })).toBe('Stündlich zur vollen Stunde')
    expect(describeSchedule({ kind: 'hourly', every: 4, minute: 30 })).toBe('Alle 4 Stunden zur Minute 30')
    expect(describeSchedule({ kind: 'monthly', day: 1, time: '08:00' })).toBe('Monatlich am 1. um 8:00')
    expect(describeSchedule({ kind: 'once', at: '2026-12-24T18:00' })).toBe('Einmalig am 24.12.2026 um 18:00')
    expect(describeSchedule({ kind: 'manual' })).toBe('Nur von Hand')
  })
})

describe('parseSchedule', () => {
  it('takes valid schedules and drops what does not belong', () => {
    expect(parseSchedule({ kind: 'weekly', days: [5, 1, 1, 9], time: '09:00', extra: true })).toEqual({ kind: 'weekly', days: [1, 5], time: '09:00' })
    expect(parseSchedule({ kind: 'hourly', every: 2, minute: 5 })).toEqual({ kind: 'hourly', every: 2, minute: 5 })
  })

  it('refuses broken ones in words', () => {
    expect(() => parseSchedule({ kind: 'daily', time: '25:00' })).toThrow('Uhrzeit')
    expect(() => parseSchedule({ kind: 'weekly', days: [], time: '09:00' })).toThrow('Wochentag')
    expect(() => parseSchedule({ kind: 'hourly', every: 5, minute: 0 })).toThrow()
    expect(() => parseSchedule({ kind: 'once', at: '2026-02-31T10:00' })).toThrow('Datum')
    expect(() => parseSchedule({ kind: 'yearly' })).toThrow()
  })
})

describe('parseTaskInput', () => {
  const valid = {
    name: ' Briefing ',
    prompt: ' Fasse zusammen ',
    enabled: true,
    schedule: { kind: 'daily', time: '07:00' },
    provider: 'codex',
    account: '',
    model: '',
    effort: '',
    permissionMode: 'edits',
    projectId: 'p1',
    reuseChat: false,
    catchUp: true,
  }

  it('trims the task and leaves out an empty account', () => {
    expect(parseTaskInput(valid)).toEqual({ ...valid, name: 'Briefing', prompt: 'Fasse zusammen', account: undefined, schedule: { kind: 'daily', time: '07:00' } })
    expect(parseTaskInput(valid)).not.toHaveProperty('account')
  })

  it('refuses permissions the CLI does not know', () => {
    // Codex has no „auto“.
    expect(() => parseTaskInput({ ...valid, permissionMode: 'auto' })).toThrow('Freigaben')
    expect(parseTaskInput({ ...valid, provider: 'claude', permissionMode: 'auto' }).permissionMode).toBe('auto')
  })

  it('needs a name, a prompt and a project', () => {
    expect(() => parseTaskInput({ ...valid, name: ' ' })).toThrow('Namen')
    expect(() => parseTaskInput({ ...valid, prompt: '' })).toThrow('was die Aufgabe tun soll')
    expect(() => parseTaskInput({ ...valid, projectId: '' })).toThrow('Projekt')
  })
})

describe('runTitle', () => {
  it('names a run after its task and time', () => {
    expect(runTitle('Briefing', at('2026-11-25T07:05'))).toBe('Briefing · 25.11. 7:05')
  })
})
