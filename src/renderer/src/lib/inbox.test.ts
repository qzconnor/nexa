import { describe, expect, it } from 'vitest'
import type { InboxEntry, InboxSection } from '@shared/inbox'
import type { SessionMeta } from '@shared/types'
import { inboxRows, nextWaiting, sortInbox } from './inbox'

function meta(id: string, more: Partial<SessionMeta> = {}): SessionMeta {
  return { id, projectId: 'p', title: id, titleSource: 'auto', provider: 'claude', model: '', effort: '', permissionMode: 'ask', createdAt: 0, updatedAt: 0, cli: {}, ...more }
}

const entry = (id: string, section: InboxSection, updatedAt = 0): InboxEntry => ({ section, id, title: `${id} (Host)`, projectId: 'p', provider: 'claude', updatedAt })

describe('inboxRows', () => {
  it('names each chat by its device and the title this window knows', () => {
    const metas = new Map([['a', meta('a', { title: 'Hier umbenannt' })]])
    const rows = inboxRows('laptop', [entry('a', 'waiting')], (id) => metas.get(id), new Set())
    expect(rows).toEqual([{ key: 'laptop:a', device: 'laptop', entry: { ...entry('a', 'waiting'), title: 'Hier umbenannt' } }])
  })

  it('leaves out what is put away here: archived, or gone from the list', () => {
    const metas = new Map([['a', meta('a', { archived: true })]])
    expect(inboxRows(null, [entry('a', 'trouble'), entry('gone', 'waiting')], (id) => metas.get(id), new Set())).toEqual([])
  })

  it('shows a finished turn only while the sidebar marks it unread', () => {
    const metas = new Map([
      ['a', meta('a')],
      ['b', meta('b')],
    ])
    const rows = inboxRows(null, [entry('a', 'unread'), entry('b', 'unread'), entry('a', 'running')], (id) => metas.get(id), new Set(['b']))
    expect(rows.map((r) => `${r.entry.id}:${r.entry.section}`)).toEqual(['b:unread', 'a:running'])
  })
})

describe('sortInbox', () => {
  it('puts what waits for an answer first, then failures, finished turns, work; the newest first in each', () => {
    const rows = [entry('run', 'running', 9), entry('new', 'unread', 5), entry('old-q', 'waiting', 1), entry('err', 'trouble', 3), entry('new-q', 'waiting', 7)].map(
      (e) => ({ key: e.id, device: null, entry: e }),
    )
    expect(sortInbox(rows).map((r) => r.key)).toEqual(['new-q', 'old-q', 'err', 'new', 'run'])
  })
})

describe('nextWaiting', () => {
  const rows = [entry('w1', 'waiting'), entry('w2', 'waiting'), entry('err', 'trouble'), entry('x', 'unread')].map((e) => ({
    key: e.id,
    device: null,
    entry: e,
  }))

  it('goes through the chats that wait, from the first when the open one does not', () => {
    expect(nextWaiting(rows, null)).toBe('w1')
    expect(nextWaiting(rows, 'x')).toBe('w1')
    expect(nextWaiting(rows, 'w1')).toBe('w2')
    expect(nextWaiting(rows, 'w2')).toBe('w1')
  })

  it('finds none when nothing waits for an answer', () => {
    expect(nextWaiting(rows.slice(2), null)).toBeNull()
  })
})
