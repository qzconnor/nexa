import { describe, expect, it } from 'vitest'
import { andList, formatDay, sameDay } from './format'

describe('andList', () => {
  it('names one, two and more as prose', () => {
    expect(andList([])).toBe('')
    expect(andList(['Codex'])).toBe('Codex')
    expect(andList(['Claude Code', 'Codex'])).toBe('Claude Code und Codex')
    expect(andList(['Claude Code', 'Codex', 'Antigravity CLI'])).toBe('Claude Code, Codex und Antigravity CLI')
  })
})

describe('formatDay', () => {
  const now = new Date(2026, 10, 25, 18, 30).getTime()

  it('names today and yesterday, other days with weekday and date', () => {
    expect(formatDay(new Date(2026, 10, 25, 0, 5).getTime(), now)).toBe('Heute')
    expect(formatDay(new Date(2026, 10, 24, 23, 59).getTime(), now)).toBe('Gestern')
    expect(formatDay(new Date(2026, 10, 23, 9).getTime(), now)).toBe('Montag, 23. November')
  })

  it('adds the year to a day of another year', () => {
    expect(formatDay(new Date(2025, 11, 31, 12).getTime(), now)).toBe('Mittwoch, 31. Dezember 2025')
  })
})

describe('sameDay', () => {
  it('compares the local calendar day', () => {
    expect(sameDay(new Date(2026, 10, 25, 0, 1).getTime(), new Date(2026, 10, 25, 23, 59).getTime())).toBe(true)
    expect(sameDay(new Date(2026, 10, 24, 23, 59).getTime(), new Date(2026, 10, 25, 0, 1).getTime())).toBe(false)
  })
})
