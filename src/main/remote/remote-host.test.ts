import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, SessionEvent } from '@shared/chat'
import { FilesEvent, FilesInvoke } from '@shared/files-ipc'
import { IpcEvent, IpcInvoke } from '@shared/ipc'
import {
  parseRemoteResponse,
  RemoteKind,
  REMOTE_TEXT_LIMIT,
  SESSIONS_OLDER,
  WATCH_TTL_MS,
  type RemoteEvent,
  type RemoteItems,
  type RemoteLevel,
  type RemoteResponse,
} from '@shared/remote'
import type { SessionDetail, SessionMeta } from '@shared/types'
import { MessageTooLargeError } from '../server-link/device-channel'
import { RemoteHost, type RemoteHostDeps } from './remote-host'

const meta = (id: string, extra: Partial<SessionMeta> = {}): SessionMeta =>
  ({ id, projectId: 'p1', title: `Chat ${id}`, provider: 'claude', model: 'opus', createdAt: 1, updatedAt: 2, cli: {}, ...extra }) as SessionMeta
const user = (id: string, text = 'Hallo'): ChatItem => ({ kind: 'user', id, ts: 1, provider: 'claude', text })
const assistant = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, ts: 1, provider: 'claude', text })
const session = (event: SessionEvent): RemoteEvent => ({ ch: IpcEvent.sessionEvent, args: [event] })
const running = { status: 'running', connected: true } as const
const idle = { status: 'idle', connected: true } as const

interface Sent {
  to: string
  kind: string
  data: unknown
}

function setup(levels: Record<string, RemoteLevel> = { laptop: 'read' }, enabled = true) {
  const sent: Sent[] = []
  const state = {
    enabled,
    levels: { ...levels },
    limits: { maxMessageBytes: 1024 * 1024, rateLimit: 100 },
    /** Bundles of events too large to send. */
    tooLarge: false,
    /** Answers with a result too large to send (an error still goes). */
    tooLargeAnswer: false,
    /** The server refuses bundles before their send returned. */
    refuseEarly: false,
    /** Not connected: nothing goes. */
    offline: false,
  }
  const items = new Map<string, ChatItem[]>([['c1', [user('u1'), assistant('a1', 'Antwort')]]])
  const calls: { ch: string; args: unknown[] }[] = []
  /** Who each call was for. */
  const callers: string[] = []
  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    [IpcInvoke.sessionsList]: () => [meta('c1'), meta('c2')],
    [IpcInvoke.sessionsOpen]: (id): SessionDetail => ({ meta: meta(id as string), items: items.get(id as string) ?? [], runtime: { status: 'idle', connected: false } }),
    [IpcInvoke.sessionsSend]: () => undefined,
    [IpcInvoke.sessionsRespond]: () => undefined,
    [IpcInvoke.sessionsUpdate]: (id) => meta(id as string),
    [IpcInvoke.appSaveImage]: () => 'C:\\Nexa\\attachments\\bild.png',
    [IpcInvoke.sessionsRemove]: () => {
      throw new Error('Die Session läuft noch.')
    },
  }
  let host: RemoteHost
  const deps: RemoteHostDeps = {
    link: {
      sendToDevice: async (to, kind, data) => {
        if (state.offline) return null
        if (state.tooLarge && kind === RemoteKind.events) throw new MessageTooLargeError(2_000_000)
        if (state.tooLargeAnswer && kind === RemoteKind.response && 'r' in (data as object)) throw new MessageTooLargeError(3_000_000)
        sent.push({ to, kind, data })
        const id = `m${sent.length}`
        if (state.refuseEarly && kind === RemoteKind.events) host.onSendFailed(id)
        return id
      },
      limits: () => state.limits,
      selfName: () => 'Desktop',
      deviceName: (id) => ({ laptop: 'Laptop', tablet: 'Tablet' })[id] ?? null,
      level: (id) => (state.enabled ? (state.levels[id] ?? 'off') : 'off'),
      enabled: () => state.enabled,
      revoke: async (id) => {
        state.levels[id] = 'off'
      },
    },
    invoke: async (ch, args, from) => {
      calls.push({ ch, args })
      callers.push(from)
      const handler = handlers[ch]
      if (!handler) throw new Error(`no handler for ${ch}`)
      return handler(...args)
    },
    version: '1.2.3',
  }
  host = new RemoteHost(deps)
  let next = 0
  /** A request of `from`, and the answer the host sent to it. */
  async function ask(m: string, p: unknown = {}, from = 'laptop'): Promise<RemoteResponse> {
    const id = `r${++next}`
    await host.onDeviceMessage(from, RemoteKind.request, id, { m, p })
    const answer = sent.findLast((s) => s.kind === RemoteKind.response && (s.data as RemoteResponse).re === id)
    if (!answer) throw new Error(`no answer to ${m}`)
    return answer.data as RemoteResponse
  }
  const invoke = (ch: string, args: unknown[] = [], from = 'laptop') => ask('invoke', { ch, args }, from)
  const bundles = (to = 'laptop') => sent.filter((s) => s.kind === RemoteKind.events && s.to === to).map((s) => (s.data as { events: RemoteEvent[] }).events)
  const events = (to = 'laptop') => bundles(to).flat()
  const fire = (event: SessionEvent) => host.onBroadcast(IpcEvent.sessionEvent, [event])
  return { host, state, sent, calls, callers, handlers, items, ask, invoke, bundles, events, fire }
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
    expect(await ask('hello', {}, 'stranger')).toMatchObject({ r: { enabled: true, level: 'off' } })
    state.enabled = false
    expect(await ask('hello')).toMatchObject({ r: { enabled: false, level: 'off' } })
    // Stopping needs no level either.
    expect(await ask('unwatch')).toEqual({ re: expect.any(String), r: null })
  })

  it('answers no call while Remote Control is off', async () => {
    const { ask, invoke, calls } = setup({ laptop: 'full' }, false)
    expect(await invoke(IpcInvoke.sessionsList)).toMatchObject({ e: { code: 'disabled' } })
    expect(await invoke(IpcInvoke.sessionsSend, ['c1', { text: 'Los' }])).toMatchObject({ e: { code: 'disabled' } })
    expect(await ask('watch', { ids: ['c1'] })).toMatchObject({ e: { code: 'disabled' } })
    expect(calls).toEqual([])
  })

  it('refuses channels not on the list, whatever the level', async () => {
    const { invoke, calls } = setup({ laptop: 'full' })
    for (const ch of [IpcInvoke.settingsExport, IpcInvoke.sessionsExportMarkdown, IpcInvoke.projectsCreate, 'format:disk']) {
      expect(await invoke(ch, [])).toMatchObject({ e: { code: 'forbidden' } })
    }
    expect(calls).toEqual([])
  })

  it('checks every call against the level it gives the device', async () => {
    const { invoke, ask, calls, state } = setup({ laptop: 'read' })
    expect(await invoke(IpcInvoke.sessionsList)).toMatchObject({ r: [{ id: 'c1' }, { id: 'c2' }] })
    expect(await invoke(IpcInvoke.sessionsSend, ['c1', { text: 'Los' }])).toMatchObject({ e: { code: 'forbidden' } })
    expect(await invoke(IpcInvoke.sessionsList, [], 'stranger')).toMatchObject({ e: { code: 'forbidden' } })
    expect(await ask('watch', { ids: [] }, 'stranger')).toMatchObject({ e: { code: 'forbidden' } })

    state.levels.laptop = 'prompt'
    expect(await invoke(IpcInvoke.sessionsSend, ['c1', { text: 'Los' }])).not.toHaveProperty('e')
    expect(await invoke(IpcInvoke.sessionsUpdate, ['c1', { title: 'Neu' }])).toMatchObject({ r: { id: 'c1' } })
    // How the agent runs, and what it may do, is the full level's.
    expect(await invoke(IpcInvoke.sessionsUpdate, ['c1', { model: 'haiku' }])).toMatchObject({ e: { code: 'forbidden' } })
    const allow = ['c1', 'ask:1', { type: 'permission', decision: 'allow' }]
    expect(await invoke(IpcInvoke.sessionsRespond, allow)).toMatchObject({ e: { code: 'forbidden' } })

    state.levels.laptop = 'full'
    expect(await invoke(IpcInvoke.sessionsUpdate, ['c1', { model: 'haiku' }])).toMatchObject({ r: { id: 'c1' } })
    expect(await invoke(IpcInvoke.sessionsRespond, allow)).not.toHaveProperty('e')
    expect(calls).toEqual([
      { ch: IpcInvoke.sessionsList, args: [] },
      { ch: IpcInvoke.sessionsSend, args: ['c1', { text: 'Los' }] },
      { ch: IpcInvoke.sessionsUpdate, args: ['c1', { title: 'Neu' }] },
      { ch: IpcInvoke.sessionsUpdate, args: ['c1', { model: 'haiku' }] },
      { ch: IpcInvoke.sessionsRespond, args: allow },
    ])
  })

  it('refuses what isn’t a request, and ignores what isn’t for it', async () => {
    const { ask, host, sent } = setup()
    expect(await ask('format', { disk: 'C:' })).toMatchObject({ e: { code: 'bad-request' } })
    expect(await ask('invoke', { ch: '../x', args: [] })).toMatchObject({ e: { code: 'bad-request' } })
    const before = sent.length
    await host.onDeviceMessage('laptop', RemoteKind.response, 'x1', { re: 'r1', r: null })
    await host.onDeviceMessage('laptop', RemoteKind.events, 'x2', { events: [] })
    expect(sent).toHaveLength(before)
  })

  // A handler without a result (sessions:send and the like return Promise<void>) answers null: an
  // undefined `r` vanished in JSON, and the controller then waited for its timeout.
  it('answers a call without a result so that the controller can read it', async () => {
    const { invoke } = setup({ laptop: 'prompt' })
    const answer = await invoke(IpcInvoke.sessionsSend, ['c1', { text: 'Los' }])
    expect(parseRemoteResponse(JSON.parse(JSON.stringify(answer)))).not.toBeNull()
  })

  it('answers with what went wrong when a handler fails', async () => {
    const { invoke } = setup({ laptop: 'full' })
    expect(await invoke(IpcInvoke.sessionsRemove, [['c1']])).toMatchObject({ e: { code: 'failed', message: 'Die Session läuft noch.' } })
  })

  it('takes a picture as base64 and hands its bytes to the handler', async () => {
    const { invoke, calls } = setup({ laptop: 'prompt' })
    const data = Buffer.from('PNG-Bytes').toString('base64')
    expect(await invoke(IpcInvoke.appSaveImage, [data, 'image/png'])).toMatchObject({ r: 'C:\\Nexa\\attachments\\bild.png' })
    expect(calls).toHaveLength(1)
    const [bytes, mime] = calls[0].args
    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect((bytes as Buffer).toString()).toBe('PNG-Bytes')
    expect(mime).toBe('image/png')

    expect(await invoke(IpcInvoke.appSaveImage, [{ 0: 1 }, 'image/png'])).toMatchObject({ e: { code: 'bad-request' } })
    expect(await invoke(IpcInvoke.appSaveImage, [])).toMatchObject({ e: { code: 'bad-request' } })
    expect(calls).toHaveLength(1)
  })

  it('answers that an answer was too large to send', async () => {
    const { invoke, state } = setup()
    state.tooLargeAnswer = true
    expect(await invoke(IpcInvoke.sessionsList)).toMatchObject({ e: { code: 'too-large', message: '3000000 bytes' } })
  })

  it('opens a chat with its items slimmed, and from then on sends its events', async () => {
    const { ask, invoke, items, fire, events } = setup()
    items.get('c1')!.push({ kind: 'tool', id: 't1', ts: 1, provider: 'claude', tool: 'bash', name: 'Bash', title: 'Bash', status: 'done', startedAt: 1, output: 'x'.repeat(REMOTE_TEXT_LIMIT + 10) } as ChatItem)
    await ask('watch', { ids: [] })
    const answer = (await invoke(IpcInvoke.sessionsOpen, ['c1'])) as { r: SessionDetail }
    expect(answer.r.meta.id).toBe('c1')
    expect(answer.r.items.map((i) => i.id)).toEqual(['u1', 'a1', 't1'])
    expect((answer.r.items[2] as Extract<ChatItem, { kind: 'tool' }>).output!.length).toBeLessThan(REMOTE_TEXT_LIMIT + 20)

    fire({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Neu' })
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([session({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Neu' })])
  })

  it('opens a long chat with its newest items, and gives the ones before as the device asks', async () => {
    const { invoke, items } = setup()
    // About 3 MB: far more than goes at once.
    const long = Array.from({ length: 60 }, (_, t) => [user(`u${t}`), assistant(`a${t}`, 'x'.repeat(50_000))]).flat()
    items.set('c9', long)
    const opened = ((await invoke(IpcInvoke.sessionsOpen, ['c9'])) as { r: SessionDetail }).r
    expect(opened.older).toBeGreaterThan(0)
    expect(opened.items[0]!.kind).toBe('user')
    expect(opened.items.map((i) => i.id)).toEqual(long.slice(opened.older).map((i) => i.id))

    const page = ((await invoke(SESSIONS_OLDER, ['c9', opened.items[0]!.id])) as { r: RemoteItems }).r
    expect(page.older).toBeLessThan(opened.older!)
    expect(page.items.map((i) => i.id)).toEqual(long.slice(page.older, opened.older).map((i) => i.id))

    expect(await invoke(SESSIONS_OLDER, ['c9', 'nope'])).toMatchObject({ e: { code: 'not-found' } })
    expect(await invoke(SESSIONS_OLDER, ['c9'])).toMatchObject({ e: { code: 'bad-request' } })
    expect(await invoke(SESSIONS_OLDER, ['c9', 'u1'], 'stranger')).toMatchObject({ e: { code: 'forbidden' } })
    // A short chat comes whole.
    expect(((await invoke(IpcInvoke.sessionsOpen, ['c1'])) as { r: SessionDetail }).r).toMatchObject({ older: 0 })
  })

  it('opens a chat for a device that doesn’t watch without watching for it', async () => {
    const { host, invoke, fire, events } = setup()
    expect(await invoke(IpcInvoke.sessionsOpen, ['c1'])).toMatchObject({ r: { meta: { id: 'c1' } } })
    expect(host.controllers()).toEqual([])
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Neu' })
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([])
  })

  it('drops the waiting events of a chat it opens: the answer holds them', async () => {
    const { ask, invoke, fire, events, items } = setup()
    await ask('watch', { ids: ['c1'] })
    items.get('c1')!.push(user('u2', 'Neu'))
    fire({ type: 'item', sessionId: 'c1', item: user('u2', 'Neu') })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Hal' })
    fire({ type: 'runtime', sessionId: 'c1', runtime: running })
    fire({ type: 'delta', sessionId: 'c2', itemId: 'x', field: 'text', text: 'anderer Chat' })
    expect(await invoke(IpcInvoke.sessionsOpen, ['c1'])).toMatchObject({ r: { items: [{ id: 'u1' }, { id: 'a1' }, { id: 'u2' }] } })
    await vi.advanceTimersByTimeAsync(150)
    // How it runs stays: the answer may be older than that.
    expect(events()).toEqual([session({ type: 'runtime', sessionId: 'c1', runtime: running })])
  })

  it('sends a chat’s items and text only to the devices that watch it, how chats run to all', async () => {
    const { ask, fire, events } = setup({ laptop: 'read', tablet: 'read' })
    await ask('watch', { ids: ['c1'] })
    await ask('watch', { ids: ['c2'] }, 'tablet')
    fire({ type: 'item', sessionId: 'c1', item: user('u2') })
    fire({ type: 'delta', sessionId: 'c2', itemId: 'b1', field: 'text', text: 'Zwei' })
    fire({ type: 'truncated', sessionId: 'c2', length: 1 })
    fire({ type: 'runtime', sessionId: 'c3', runtime: running })
    fire({ type: 'runtime', sessionId: 'c3', runtime: idle })
    expect(events()).toEqual([])
    await vi.advanceTimersByTimeAsync(150)
    expect(events('laptop')).toEqual([
      session({ type: 'item', sessionId: 'c1', item: user('u2') }),
      // Only the newest state of how a chat runs.
      session({ type: 'runtime', sessionId: 'c3', runtime: idle }),
    ])
    expect(events('tablet')).toEqual([
      session({ type: 'delta', sessionId: 'c2', itemId: 'b1', field: 'text', text: 'Zwei' }),
      session({ type: 'truncated', sessionId: 'c2', length: 1 }),
      session({ type: 'runtime', sessionId: 'c3', runtime: idle }),
    ])
  })

  it('sends nothing of its own windows’ business, nor to devices that don’t watch', async () => {
    const { ask, host, fire, sent } = setup()
    fire({ type: 'item', sessionId: 'c1', item: user('u2') })
    await vi.advanceTimersByTimeAsync(150)
    expect(sent).toEqual([])
    await ask('watch', { ids: ['c1'] })
    host.onBroadcast(IpcEvent.showSession, ['c1'])
    host.onBroadcast(IpcEvent.windowState, [{ maximized: true }])
    await vi.advanceTimersByTimeAsync(150)
    expect(sent.filter((s) => s.kind === RemoteKind.events)).toEqual([])
  })

  it('joins text streamed into the same item, and lets a finished item replace it', async () => {
    const { ask, fire, events } = setup()
    await ask('watch', { ids: ['c1'] })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'Hal' })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'lo' })
    // Another field, then another item: each a piece of its own.
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'output', text: '$ ls' })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Zwei' })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: ' Welt' })
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([
      session({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'Hallo' }),
      session({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'output', text: '$ ls' }),
      session({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Zwei' }),
      session({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: ' Welt' }),
    ])

    fire({ type: 'delta', sessionId: 'c1', itemId: 'a3', field: 'text', text: 'Hal' })
    fire({ type: 'item', sessionId: 'c1', item: assistant('a3', 'Hal') })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a3', field: 'text', text: 'lo' })
    fire({ type: 'item', sessionId: 'c1', item: assistant('a3', 'Hallo Welt') })
    await vi.advanceTimersByTimeAsync(150)
    expect(events().slice(4)).toEqual([session({ type: 'item', sessionId: 'c1', item: assistant('a3', 'Hallo Welt') })])
  })

  it('slims the items it sends', async () => {
    const { ask, fire, events } = setup()
    await ask('watch', { ids: ['c1'] })
    fire({ type: 'item', sessionId: 'c1', item: assistant('a9', 'ü'.repeat(4 * REMOTE_TEXT_LIMIT)) })
    await vi.advanceTimersByTimeAsync(150)
    const [event] = events() as { ch: string; args: [{ item: { text: string } }] }[]
    expect(new TextEncoder().encode(event.args[0].item.text).length).toBeLessThanOrEqual(4 * REMOTE_TEXT_LIMIT + 20)
    expect(event.args[0].item.text.endsWith('(gekürzt)')).toBe(true)
  })

  it('sends lists as what changed since the device got them last, and the newest one of a burst', async () => {
    const { ask, host, events } = setup()
    await ask('watch', { ids: [] })
    const a = meta('a')
    const b = meta('b')
    host.onBroadcast(IpcEvent.sessionsChanged, [[a]])
    host.onBroadcast(IpcEvent.sessionsChanged, [[a, b]])
    host.onBroadcast(IpcEvent.settingsChanged, [{ theme: 'dark' }])
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([
      { ch: IpcEvent.sessionsChanged, diff: { ids: ['a', 'b'], changed: [a, b] } },
      { ch: IpcEvent.settingsChanged, args: [{ theme: 'dark' }] },
    ])

    const renamed = meta('b', { title: 'Umbenannt' })
    host.onBroadcast(IpcEvent.sessionsChanged, [[renamed, a, meta('c')]])
    await vi.advanceTimersByTimeAsync(150)
    expect(events().at(-1)).toEqual({ ch: IpcEvent.sessionsChanged, diff: { ids: ['b', 'a', 'c'], changed: [renamed, meta('c')] } })

    host.onBroadcast(IpcEvent.sessionsChanged, [[a]])
    // Something of a list event that is no list goes as it is.
    host.onBroadcast(IpcEvent.projectsChanged, [{ broken: true }])
    await vi.advanceTimersByTimeAsync(150)
    expect(events().slice(-2)).toEqual([
      { ch: IpcEvent.sessionsChanged, diff: { ids: ['a'], changed: [] } },
      { ch: IpcEvent.projectsChanged, args: [{ broken: true }] },
    ])
  })

  it('keeps the base of the lists per device', async () => {
    const { ask, host, events } = setup({ laptop: 'read', tablet: 'read' })
    const list = [meta('a'), meta('b')]
    await ask('watch', { ids: [] })
    host.onBroadcast(IpcEvent.sessionsChanged, [list])
    await vi.advanceTimersByTimeAsync(150)
    await ask('watch', { ids: [] }, 'tablet')
    host.onBroadcast(IpcEvent.sessionsChanged, [list])
    await vi.advanceTimersByTimeAsync(150)
    expect(events('laptop').at(-1)).toEqual({ ch: IpcEvent.sessionsChanged, diff: { ids: ['a', 'b'], changed: [] } })
    expect(events('tablet')).toEqual([{ ch: IpcEvent.sessionsChanged, diff: { ids: ['a', 'b'], changed: list } }])
  })

  it('renews a watch, and starts it anew when the device has nothing of before', async () => {
    const { ask, host, events } = setup()
    const list = [meta('a')]
    expect(await ask('watch', { ids: [] })).toMatchObject({ r: { renewed: false, enabled: true, level: 'read', name: 'Desktop' } })
    expect(await ask('watch', { ids: ['c1'] })).toMatchObject({ r: { renewed: true } })
    host.onBroadcast(IpcEvent.sessionsChanged, [list])
    await vi.advanceTimersByTimeAsync(150)

    // What still waited goes with a fresh start, and the lists come whole again.
    host.onBroadcast(IpcEvent.settingsChanged, [{ theme: 'dark' }])
    expect(await ask('watch', { ids: ['c1'], fresh: true })).toMatchObject({ r: { renewed: false } })
    host.onBroadcast(IpcEvent.sessionsChanged, [list])
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([
      { ch: IpcEvent.sessionsChanged, diff: { ids: ['a'], changed: list } },
      { ch: IpcEvent.sessionsChanged, diff: { ids: ['a'], changed: list } },
    ])
    expect(host.controllers()).toHaveLength(1)
  })

  it('watches the chats of the last watch only', async () => {
    const { ask, fire, events } = setup()
    await ask('watch', { ids: ['c1'] })
    await ask('watch', { ids: ['c2'] })
    fire({ type: 'item', sessionId: 'c1', item: user('u2') })
    fire({ type: 'item', sessionId: 'c2', item: user('u3') })
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([session({ type: 'item', sessionId: 'c2', item: user('u3') })])
  })

  it('ends a watch when it runs out, unless it was renewed', async () => {
    const { ask, host } = setup()
    await ask('watch', { ids: [] })
    await vi.advanceTimersByTimeAsync(WATCH_TTL_MS - 1_000)
    await ask('watch', { ids: [] })
    await vi.advanceTimersByTimeAsync(WATCH_TTL_MS - 1_000)
    expect(host.controllers()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_010)
    expect(host.controllers()).toEqual([])
    expect(await ask('watch', { ids: [] })).toMatchObject({ r: { renewed: false } })
  })

  it('ends a watch when the device asks, goes, or may no longer read', async () => {
    const { ask, host, state, fire, events } = setup()
    const changes: number[] = []
    host.on('changed', (list) => changes.push(list.length))
    await ask('watch', { ids: ['c1'] })
    expect(host.controllers()).toEqual([{ id: 'laptop', name: 'Laptop', since: Date.now(), level: 'read' }])
    expect(await ask('unwatch')).toMatchObject({ r: null })
    expect(host.controllers()).toEqual([])
    fire({ type: 'item', sessionId: 'c1', item: user('u2') })
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([])

    await ask('watch', { ids: [] })
    host.onDeviceStatus('laptop', true)
    expect(host.controllers()).toHaveLength(1)
    host.onDeviceStatus('laptop', false)
    expect(host.controllers()).toEqual([])

    await ask('watch', { ids: [] })
    state.levels.laptop = 'off'
    host.onRemoteChanged()
    expect(host.controllers()).toEqual([])

    state.levels.laptop = 'read'
    await ask('watch', { ids: [] })
    state.enabled = false
    host.onRemoteChanged()
    expect(host.controllers()).toEqual([])
    expect(changes).toEqual([1, 0, 1, 0, 1, 0, 0, 1, 0, 0])
  })

  it('takes a device’s level away with „Trennen“', async () => {
    const { ask, host, state } = setup({ laptop: 'full' })
    await ask('watch', { ids: [] })
    const changes: number[] = []
    host.on('changed', (list) => changes.push(list.length))
    await host.disconnect('laptop')
    expect(state.levels.laptop).toBe('off')
    expect(host.controllers()).toEqual([])
    expect(changes).toEqual([0])
    expect(await ask('watch', { ids: [] })).toMatchObject({ e: { code: 'forbidden' } })
  })

  it('bundles less often when the server allows few messages a second', async () => {
    const { ask, fire, events, state } = setup()
    state.limits = { maxMessageBytes: 1024 * 1024, rateLimit: 4 }
    await ask('watch', { ids: ['c1'] })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'x' })
    await vi.advanceTimersByTimeAsync(500)
    expect(events()).toEqual([])
    await vi.advanceTimersByTimeAsync(600)
    expect(events()).toHaveLength(1)
  })

  it('ends the watch of a device a bundle didn’t reach, so it reads its chats anew', async () => {
    const { ask, host, sent, fire } = setup()
    await ask('watch', { ids: ['c1'] })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'x' })
    await vi.advanceTimersByTimeAsync(150)
    const bundle = sent.findIndex((s) => s.kind === RemoteKind.events)
    // An answer that failed is no bundle: the watch stays.
    host.onSendFailed('m1')
    expect(host.controllers()).toHaveLength(1)
    host.onSendFailed(`m${bundle + 1}`)
    expect(host.controllers()).toEqual([])
    expect(await ask('watch', { ids: ['c1'] })).toMatchObject({ r: { renewed: false } })
  })

  it('ends the watch also when the server refused a bundle before its send returned', async () => {
    const { ask, host, state, fire } = setup()
    await ask('watch', { ids: ['c1'] })
    state.refuseEarly = true
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'x' })
    await vi.advanceTimersByTimeAsync(150)
    expect(host.controllers()).toEqual([])
  })

  it('ends the watch when an event is too large to send, or the connection is down', async () => {
    const { ask, host, state, fire } = setup()
    await ask('watch', { ids: ['c1'] })
    state.tooLarge = true
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'x' })
    await vi.advanceTimersByTimeAsync(150)
    expect(host.controllers()).toEqual([])

    state.tooLarge = false
    await ask('watch', { ids: ['c1'] })
    state.offline = true
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'x' })
    await vi.advanceTimersByTimeAsync(150)
    expect(host.controllers()).toEqual([])
  })

  it('sends the file panel’s events only to devices that watch the folder or have the chat open, joined per folder', async () => {
    const { ask, invoke, host, events, handlers } = setup({ laptop: 'read', tablet: 'read' })
    handlers[FilesInvoke.watch] = () => undefined
    handlers[FilesInvoke.gitWatch] = () => undefined
    await ask('watch', { ids: ['c1'] })
    await ask('watch', { ids: [] }, 'tablet')
    expect(await invoke(FilesInvoke.watch, [[{ root: 'C:\\dev', dirs: [''] }]])).toEqual({ re: expect.any(String), r: null })
    await invoke(FilesInvoke.gitWatch, [['C:\\dev']])

    host.onBroadcast(FilesEvent.changed, ['C:\\dev', ['src'], false, false])
    host.onBroadcast(FilesEvent.changed, ['C:\\other', [''], true, false])
    host.onBroadcast(FilesEvent.touched, ['c1', [{ path: 'C:\\dev\\a.ts', kind: 'read' }]])
    host.onBroadcast(FilesEvent.touched, ['c2', [{ path: 'C:\\dev\\b.ts', kind: 'read' }]])
    host.onBroadcast(FilesEvent.changed, ['C:\\dev', ['lib'], true, false])
    host.onBroadcast(FilesEvent.gitBranchChanged, ['C:\\dev', { name: 'main', detached: false }])
    host.onBroadcast(FilesEvent.gitBranchChanged, ['C:\\other', { name: 'main', detached: false }])
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([
      { ch: FilesEvent.touched, args: ['c1', [{ path: 'C:\\dev\\a.ts', kind: 'read' }]] },
      { ch: FilesEvent.changed, args: ['C:\\dev', ['src', 'lib'], true, false] },
      { ch: FilesEvent.gitBranchChanged, args: ['C:\\dev', { name: 'main', detached: false }] },
    ])
    expect(events('tablet')).toEqual([])
  })

  it('starts watching folders only for a device that watches, with who asks', async () => {
    const { ask, invoke, calls, callers, handlers } = setup({ laptop: 'read' })
    handlers[FilesInvoke.watch] = () => undefined
    handlers[FilesInvoke.list] = () => ({ entries: [], omitted: 0 })
    expect(await invoke(FilesInvoke.watch, [[{ root: 'C:\\dev', dirs: [''] }]])).toEqual({ re: expect.any(String), r: null })
    expect(calls).toEqual([])
    await ask('watch', { ids: [] })
    await invoke(FilesInvoke.watch, [[{ root: 'C:\\dev', dirs: [''] }]])
    await invoke(FilesInvoke.list, ['C:\\dev'])
    expect(calls.map((c) => c.ch)).toEqual([FilesInvoke.watch, FilesInvoke.list])
    expect(callers).toEqual(['laptop', 'laptop'])
  })

  it('lets go of what a device watched once its watch ends or starts anew', async () => {
    const { ask, invoke, host, state, events, handlers } = setup({ laptop: 'read' })
    handlers[FilesInvoke.watch] = () => undefined
    const dropped: string[] = []
    host.on('dropped', (id) => dropped.push(id))
    await ask('watch', { ids: [] })
    await invoke(FilesInvoke.watch, [[{ root: 'C:\\dev', dirs: [''] }]])
    expect(await ask('watch', { ids: [] })).toMatchObject({ r: { renewed: true } })
    expect(dropped).toEqual([])

    // A fresh start: what it watched goes, until it asks again.
    await ask('watch', { ids: [], fresh: true })
    expect(dropped).toEqual(['laptop'])
    host.onBroadcast(FilesEvent.changed, ['C:\\dev', [''], true, false])
    await vi.advanceTimersByTimeAsync(150)
    expect(events()).toEqual([])

    await ask('unwatch')
    await ask('watch', { ids: [] })
    host.onDeviceStatus('laptop', false)
    await ask('watch', { ids: [] })
    state.levels.laptop = 'off'
    host.onRemoteChanged()
    expect(dropped).toEqual(['laptop', 'laptop', 'laptop', 'laptop'])
  })

  it('stops everything when disposed', async () => {
    const { ask, host, fire, events } = setup()
    await ask('watch', { ids: ['c1'] })
    fire({ type: 'delta', sessionId: 'c1', itemId: 'a1', field: 'text', text: 'x' })
    host.dispose()
    await vi.advanceTimersByTimeAsync(WATCH_TTL_MS)
    expect(host.controllers()).toEqual([])
    expect(events()).toEqual([])
  })
})
