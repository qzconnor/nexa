import { describe, expect, it } from 'vitest'
import type { SessionMeta } from '@shared/types'
import { cleanupMatches, removalDescription, removalProblems, removedTitle, type CleanupFilter } from './chat-cleanup'

const NOW = Date.UTC(2026, 10, 24)
const DAY = 86_400_000
const ANY: CleanupFilter = { olderThanDays: 0, largerThanMb: 0, projectId: null, archived: 'all' }

function meta(patch: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1',
    projectId: 'p1',
    title: 'Chat',
    titleSource: 'user',
    provider: 'claude',
    model: '',
    effort: '',
    permissionMode: 'ask',
    createdAt: NOW - 40 * DAY,
    updatedAt: NOW - 40 * DAY,
    cli: {},
    ...patch,
  }
}

describe('cleanupMatches', () => {
  it('filters by age, project and archive', () => {
    expect(cleanupMatches(meta(), 0, { ...ANY, olderThanDays: 30 }, NOW)).toBe(true)
    expect(cleanupMatches(meta(), 0, { ...ANY, olderThanDays: 90 }, NOW)).toBe(false)
    expect(cleanupMatches(meta(), 0, { ...ANY, projectId: 'p2' }, NOW)).toBe(false)
    expect(cleanupMatches(meta(), 0, { ...ANY, archived: 'only' }, NOW)).toBe(false)
    expect(cleanupMatches(meta({ archived: true }), 0, { ...ANY, archived: 'none' }, NOW)).toBe(false)
  })

  it('filters by size once it is known', () => {
    const big = { ...ANY, largerThanMb: 10 }
    expect(cleanupMatches(meta(), 11 * 1024 * 1024, big, NOW)).toBe(true)
    expect(cleanupMatches(meta(), 10 * 1024 * 1024, big, NOW)).toBe(false)
    expect(cleanupMatches(meta(), undefined, big, NOW)).toBe(true)
  })
})

describe('texts', () => {
  it('names one chat, counts several', () => {
    expect(removedTitle([{ title: 'Fix' }])).toBe('„Fix“ gelöscht')
    expect(removedTitle([{ title: 'a' }, { title: 'b' }])).toBe('2 Chats gelöscht')
    expect(removalDescription(3, true)).toBe('Ihr Verlauf in Nexa geht verloren, ihre Unterhaltungen in Claude Code und Codex kommen in den Papierkorb.')
    expect(removalDescription(1, false)).toBe('Sein Verlauf in Nexa geht verloren.')
  })

  it('reports only what went wrong', () => {
    const ok = { removed: ['a'], trashed: 3, bytes: 10, openElsewhere: [], failed: 0 }
    expect(removalProblems(ok)).toEqual([])
    const problems = removalProblems({ ...ok, openElsewhere: ['a'], failed: 2, error: 'Zugriff verweigert' })
    expect(problems.map((p) => p.title)).toEqual(['Ein Transkript bleibt', 'Nicht alles kam in den Papierkorb'])
    expect(problems[1]!.description).toBe('2 Dateien der CLIs blieben liegen: Zugriff verweigert')
  })
})
