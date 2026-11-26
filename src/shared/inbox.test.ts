import { describe, expect, it } from 'vitest'
import type { ChatItem, InteractionItem, SessionRuntime } from './chat'
import { inboxEntries, inboxSection } from './inbox'
import type { SessionMeta } from './types'

function meta(id: string, more: Partial<SessionMeta> = {}): SessionMeta {
  return { id, projectId: 'p', title: id, titleSource: 'auto', provider: 'claude', model: '', effort: '', permissionMode: 'ask', createdAt: 0, updatedAt: 0, cli: {}, ...more }
}
const question = (id: string, state: InteractionItem['state'] = 'pending'): InteractionItem => ({
  kind: 'interaction',
  id,
  ts: 1,
  provider: 'claude',
  state,
  request: { type: 'plan', plan: 'Weiter?' },
})

describe('inboxSection', () => {
  it('puts a chat where it needs the user most', () => {
    expect(inboxSection(meta('a'), { status: 'waiting', connected: true })).toBe('waiting')
    expect(inboxSection(meta('a'), { status: 'error', connected: false, error: 'kaputt' })).toBe('trouble')
    expect(inboxSection(meta('a'), { status: 'idle', connected: false, resume: { at: 5, accountId: null, byUser: false } })).toBe('trouble')
    expect(inboxSection(meta('a', { finishedAt: 5 }), { status: 'running', connected: true })).toBe('running')
    expect(inboxSection(meta('a', { finishedAt: 5, seenAt: 3 }), undefined)).toBe('unread')
    expect(inboxSection(meta('a', { finishedAt: 5, seenAt: 5 }), undefined)).toBeNull()
    expect(inboxSection(meta('a'), { status: 'idle', connected: true })).toBeNull()
  })
})

describe('inboxEntries', () => {
  it('lists them by section, the newest first, with the questions that wait, and leaves out the archived', () => {
    const metas = [
      meta('old-unread', { finishedAt: 9, updatedAt: 1 }),
      meta('new-unread', { finishedAt: 9, updatedAt: 8, preview: 'Fertig.' }),
      meta('asks', { updatedAt: 2 }),
      meta('broke', { updatedAt: 3 }),
      meta('works', { updatedAt: 4 }),
      meta('quiet', { updatedAt: 5 }),
      meta('archived', { updatedAt: 6, archived: true, finishedAt: 9 }),
    ]
    const runtimes: Record<string, SessionRuntime> = {
      asks: { status: 'waiting', connected: true },
      broke: { status: 'error', connected: false, error: 'Der Prozess endete.' },
      works: { status: 'running', connected: true },
    }
    const items: Record<string, ChatItem[]> = { asks: [question('q1', 'answered'), question('q2')] }
    const entries = inboxEntries(metas, (id) => runtimes[id], (id) => items[id] ?? null)
    expect(entries.map((e) => [e.section, e.id])).toEqual([
      ['waiting', 'asks'],
      ['trouble', 'broke'],
      ['unread', 'new-unread'],
      ['unread', 'old-unread'],
      ['running', 'works'],
    ])
    expect(entries[0]!.pending?.map((i) => i.id)).toEqual(['q2'])
    expect(entries[1]).toMatchObject({ error: 'Der Prozess endete.' })
    expect(entries[2]).toMatchObject({ preview: 'Fertig.' })
    expect(entries[4]).not.toHaveProperty('pending')
  })
})
