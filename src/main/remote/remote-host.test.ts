import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, SessionEvent } from '@shared/chat'
import { RemoteKind, WATCH_TTL_MS, type RemoteEvent, type RemoteLevel, type RemoteResponse } from '@shared/remote'
import type { SessionDetail, SessionMeta } from '@shared/types'
import { RemoteHost, type RemoteHostDeps } from './remote-host'

const meta = (id: string, extra: Partial<SessionMeta> = {}): SessionMeta =>
  ({ id, projectId: 'p1', title: `Chat ${id}`, provider: 'claude', model: 'opus', createdAt: 1, updatedAt: 2, cli: {}, ...extra }) as SessionMeta
const user = (id: string, text = 'Hallo'): ChatItem => ({ kind: 'user', id, ts: 1, provider: 'claude', text })
const assistant = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, ts: 1, provider: 'claude', text })

interface Sent {
  to: string
  kind: string
  data: unknown
}

function setup(levels: Record<string, RemoteLevel> = { laptop: 'read' }, enabled = true) {
  const sent: Sent[] = []
  const state = { enabled, levels: { ...levels } }
  const items = new Map<string, ChatItem[]>([['c1', [user('u1'), assistant('a1', 'Antwort')]]])
  const metas = [meta('c1'), meta('c2', { archived: true })]
  const calls: string[] = []
  const deps: RemoteHostDeps = {
    link: {
      sendToDevice: async (to, kind, data) => {
        sent.push({ to, kind, data })
        return `m${sent.length}`
      },
      selfName: () => 'Desktop',
      deviceName: (id) => (id === 'laptop' ? 'Laptop' : null),
      level: (id) => (state.enabled ? (state.levels[id] ?? 'off') : 'off'),
      enabled: () => state.enabled,
      revoke: async (id) => {
        state.levels[id] = 'off'
      },
    },
    sessions: {
      list: () => metas,
      open: async (id): Promise<SessionDetail> => ({ meta: metas.find((m) => m.id === id)!, items: items.get(id) ?? [], runtime: { status: 'idle', connected: false } }),
      send: async (id, text) => void calls.push(`send ${id} ${text}`),
      interrupt: async (id) => void calls.push(`interrupt ${id}`),
      respond: async (id, itemId) => void calls.push(`respond ${id} ${itemId}`),
      runtimes: () => ({}),
    },
    projects: () => ({ projects: [{ id: 'p1', name: 'nexa', path: 'F:\\nexa', createdAt: 1, updatedAt: 1, sectionId: 's1' }], sections: [{ id: 's1', name: 'Arbeit' } as never] }),
    version: '1.2.3',
  }
  const host = new RemoteHost(deps)
  let next = 0
  /** A request of `from`, and the answer the host sent to it. */
  async function ask(m: string, p: unknown = {}, from = 'laptop'): Promise<RemoteResponse> {
    const id = `r${++next}`
    await host.onDeviceMessage(from, RemoteKind.request, id, { m, p })
    const answer = sent.findLast((s) => s.kind === RemoteKind.response && (s.data as RemoteResponse).re === id)
    if (!answer) throw new Error(`no answer to ${m}`)
    return answer.data as RemoteResponse
  }
  const events = () => sent.filter((s) => s.kind === RemoteKind.events).flatMap((s) => (s.data as { events: RemoteEvent[] }).events)
  return { host, state, sent, calls, items, ask, events }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RemoteHost', () => {
  it('says who it is and how far the asking device may go, also with Remote Control off', async () => {
    const { ask, state } = setup()
    expect(await ask('hello')).toMatchObject({ r: { name: 'Desktop', enabled: true, level: 'read', version: '1.2.3' } })
    state.enabled = false
    expect(await ask('hello')).toMatchObject({ r: { enabled: false, level: 'off' } })
  })

  it('answers nothing else while Remote Control is off', async () => {
    const { ask } = setup({ laptop: 'full' }, false)
    expect(await ask('chats')).toMatchObject({ e: { code: 'disabled' } })
  })

  it('checks every request against the level it gives the device', async () => {
    const { ask, calls, state } = setup({ laptop: 'read' })
    expect(await ask('send', { id: 'c1', text: 'Los' })).toMatchObject({ e: { code: 'forbidden' } })
    expect(await ask('chats', {}, 'stranger')).toMatchObject({ e: { code: 'forbidden' } })
    state.levels.laptop = 'prompt'
    expect(await ask('send', { id: 'c1', text: 'Los' })).toEqual({ re: expect.any(String), r: null })
    expect(await ask('interrupt', { id: 'c1' })).toMatchObject({ r: null })
    expect(await ask('respond', { id: 'c1', itemId: 'ask:1', response: { type: 'permission', decision: 'allow' } })).toMatchObject({ e: { code: 'forbidden' } })
    state.levels.laptop = 'full'
    expect(await ask('respond', { id: 'c1', itemId: 'ask:1', response: { type: 'permission', decision: 'allow' } })).toMatchObject({ r: null })
    expect(calls).toEqual(['send c1 Los', 'interrupt c1', 'respond c1 ask:1'])
  })

  it('refuses what it doesn’t understand, and chats it doesn’t show', async () => {
    const { ask } = setup()
    expect(await ask('format', { disk: 'C:' })).toMatchObject({ e: { code: 'bad-request' } })
    expect(await ask('open', { id: 'c2' })).toMatchObject({ e: { code: 'not-found' } })
    expect(await ask('open', { id: 'nope' })).toMatchObject({ e: { code: 'not-found' } })
  })

  it('lists projects with their separator and the chats without archived ones', async () => {
    const { ask } = setup()
    const answer = await ask('chats')
    expect(answer).toMatchObject({ r: { projects: [{ id: 'p1', name: 'nexa', section: 'Arbeit' }], sessions: [{ id: 'c1', title: 'Chat c1' }] } })
    expect((answer as { r: { sessions: unknown[] } }).r.sessions).toHaveLength(1)
    expect(JSON.stringify(answer)).not.toContain('"cli"')
  })

  it('opens a chat as its newest page', async () => {
    const { ask } = setup()
    expect(await ask('open', { id: 'c1' })).toMatchObject({ r: { session: { id: 'c1' }, start: 0, total: 2, items: [{ id: 'u1' }, { id: 'a1' }] } })
  })

  it('sends the events of watched chats in bundles, streamed text joined', async () => {
    const { ask, host, events } = setup()
    expect(await ask('watch', { ids: ['c1'] })).toMatchObject({ r: { renewed: false } })
    expect(host.controllers()).toMatchObject([{ id: 'laptop', name: 'Laptop', level: 'read' }])
    const send = (e: SessionEvent) => host.onSessionEvent(e)
    send({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'Hal' })
    send({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'lo' })
    send({ type: 'delta', sessionId: 'other', itemId: 'x', field: 'text', text: 'not watched' })
    send({ type: 'runtime', sessionId: 'other', runtime: { status: 'running', connected: true } })
    send({ type: 'runtime', sessionId: 'other', runtime: { status: 'idle', connected: true } })
    expect(events()).toEqual([])
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([
      { type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'Hallo' },
      // Of chats not watched only how they run, and only the newest state.
      { type: 'runtime', sessionId: 'other', runtime: { status: 'idle', connected: true } },
    ])
  })

  it('lets a finished item replace what streamed into it meanwhile', async () => {
    const { ask, host, events } = setup()
    await ask('watch', { ids: ['c1'] })
    host.onSessionEvent({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'Hal' })
    host.onSessionEvent({ type: 'item', sessionId: 'c1', item: assistant('a1', 'Hallo Welt') })
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([{ type: 'item', sessionId: 'c1', item: assistant('a1', 'Hallo Welt') }])
  })

  it('drops the waiting events of a chat it opens: the page holds them', async () => {
    const { ask, host, events, items } = setup()
    await ask('watch', { ids: ['c1'] })
    items.get('c1')!.push(user('u2', 'Neu'))
    host.onSessionEvent({ type: 'item', sessionId: 'c1', item: user('u2', 'Neu') })
    expect(await ask('open', { id: 'c1' })).toMatchObject({ r: { total: 3 } })
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([])
  })

  it('renews a watch, and ends it when it runs out, the device goes or may no longer read', async () => {
    const { ask, host, state } = setup()
    await ask('watch', { ids: [] })
    expect(await ask('watch', { ids: ['c1'] })).toMatchObject({ r: { renewed: true } })
    await vi.advanceTimersByTimeAsync(WATCH_TTL_MS + 10)
    expect(host.controllers()).toEqual([])

    await ask('watch', { ids: [] })
    host.onDeviceStatus('laptop', false)
    expect(host.controllers()).toEqual([])

    await ask('watch', { ids: [] })
    state.levels.laptop = 'off'
    host.onRemoteChanged()
    expect(host.controllers()).toEqual([])
  })

  it('tells the watching devices when the list of chats changed, once for a burst', async () => {
    const { ask, host, events } = setup()
    await ask('watch', { ids: [] })
    host.onSessionsChanged()
    host.onSessionsChanged()
    await vi.advanceTimersByTimeAsync(2_100)
    expect(events()).toEqual([{ type: 'chats' }])
  })

  it('takes a device’s level away with „Trennen“', async () => {
    const { ask, host, state } = setup({ laptop: 'full' })
    await ask('watch', { ids: [] })
    const changes: number[] = []
    host.on('changed', (list) => changes.push(list.length))
    await host.disconnect('laptop')
    expect(state.levels.laptop).toBe('off')
    expect(host.controllers()).toEqual([])
    expect(changes.at(-1)).toBe(0)
  })
})
