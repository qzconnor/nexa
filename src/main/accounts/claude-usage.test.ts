import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0' }, net: { fetch: vi.fn() } }))

const { parseClaudeUsage } = await import('./claude-usage')

describe('parseClaudeUsage', () => {
  it('reads the windows of older answers', () => {
    const parsed = parseClaudeUsage({
      five_hour: { utilization: 42, resets_at: '2026-11-23T15:00:00Z' },
      seven_day: { utilization: 12.5, resets_at: null },
    })
    expect(parsed?.windows).toEqual([
      { key: 'five_hour', label: '5 Stunden', usedPercent: 42, resetsAt: Date.parse('2026-11-23T15:00:00Z'), windowMinutes: 300 },
      { key: 'seven_day', label: 'Woche', usedPercent: 12.5, resetsAt: undefined, windowMinutes: 10080 },
    ])
    expect(parsed?.limited).toBe(false)
  })

  it('reads `limits` with the windows of single models after the main ones', () => {
    const parsed = parseClaudeUsage({
      limits: [
        { kind: 'weekly_opus', percent: 80, scope: { model: { display_name: 'Opus' } } },
        { kind: 'session', percent: 100, resets_at: '2026-11-23T15:00:00Z' },
        { kind: 'weekly_all', percent: 30 },
      ],
    })
    expect(parsed?.windows.map((w) => [w.key, w.usedPercent])).toEqual([
      ['five_hour', 100],
      ['seven_day', 30],
      ['weekly_opus:Opus', 80],
    ])
    expect(parsed?.windows[2].label).toBe('Opus · Woche')
    expect(parsed?.limited).toBe(true)
  })

  it('is null for anything else', () => {
    expect(parseClaudeUsage({ error: 'x' })).toBeNull()
    expect(parseClaudeUsage(null)).toBeNull()
  })
})
