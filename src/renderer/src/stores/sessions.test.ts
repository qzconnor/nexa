import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, SessionEvent } from '@shared/chat'
import { IpcEvent, IpcInvoke } from '@shared/ipc'
import { SESSIONS_OLDER, type RemoteBroadcast } from '@shared/remote'
import type { SessionMeta } from '@shared/types'

vi.mock('./devices', () => ({ useDevicesStore: () => ({ devices: [], can: () => true }) }))
// No chat is in a window of its own.
vi.mock('./chat-windows', () => ({ useChatWindowsStore: () => ({ elsewhere: () => false, show: () => {} }) }))

function meta(id: string): SessionMeta {
  return { id, projectId: 'p', title: id, titleSource: 'auto', provider: 'claude', model: '', effort: '', permissionMode: 'ask', createdAt: 0, updatedAt: 0, cli: {} }
}
const user = (id: string): ChatItem => ({ kind: 'user', id, ts: 1, provider: 'claude', text: id })
const idle = { status: 'idle', connected: false } as const

/** Events of other devices, as Remote Control hands them to the window. */
let remoteEvents: (instance: string, events: RemoteBroadcast[]) => void = () => {}

const api = {
  remote: {
    invoke: vi.fn(async (_instance: string, _ch: string, _args: unknown[]): Promise<unknown> => null),
    onEvents: (cb: typeof remoteEvents) => {
      remoteEvents = cb
      return () => {}
    },
    onResync: () => () => {},
  },
  sessions: {
    list: vi.fn(async () => [meta('s1')]),
    runtimes: vi.fn(async () => ({})),
    open: vi.fn(async (id: string) => ({ meta: meta(id), items: [user('u1')], runtime: idle })),
    onChanged: () => () => {},
    onEvent: () => () => {},
  },
}

beforeEach(() => {
  vi.stubGlobal('window', { api })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('a long chat of another device', () => {
  /** The chat `r1` there: 5 items, of which the newest 2 come when it opens. */
  async function openRemote() {
    api.remote.invoke.mockImplementation(async (_instance, ch, args) => {
      switch (ch) {
        case IpcInvoke.sessionsList:
          return [meta('r1')]
        case IpcInvoke.sessionsRuntimes:
          return {}
        case IpcInvoke.sessionsOpen:
          return { meta: meta('r1'), items: [user('u3'), user('u4')], runtime: idle, older: 3 }
        case SESSIONS_OLDER:
          return args[1] === 'u3' ? { items: [user('u1'), user('u2')], older: 1 } : { items: [user('u0')], older: 0 }
        default:
          return null
      }
    })
    const { useSessionsStore } = await import('./sessions')
    const sessions = useSessionsStore('dev1')
    await sessions.load()
    await sessions.open('r1')
    return sessions
  }
  const ids = (items: ChatItem[]) => items.map((item) => item.id)
  const fire = (event: SessionEvent) => remoteEvents('dev1', [{ ch: IpcEvent.sessionEvent, args: [event] }])

  it('gets the items before the ones it has as asked, until there are none', async () => {
    const sessions = await openRemote()
    const chat = sessions.chats.get('r1')!
    expect(chat).toMatchObject({ older: 3, loadingOlder: false })

    const loading = sessions.loadOlder('r1')
    expect(chat.loadingOlder).toBe(true)
    // Asked twice at once, it goes once.
    void sessions.loadOlder('r1')
    await loading
    expect(ids(chat.items)).toEqual(['u1', 'u2', 'u3', 'u4'])
    expect(chat.index.get('u3')).toBe(2)
    expect(chat).toMatchObject({ older: 1, loadingOlder: false })

    await sessions.loadOlder('r1')
    expect(ids(chat.items)).toEqual(['u0', 'u1', 'u2', 'u3', 'u4'])
    await sessions.loadOlder('r1')
    expect(api.remote.invoke.mock.calls.filter((c) => c[1] === SESSIONS_OLDER).map((c) => c[2])).toEqual([
      ['r1', 'u3'],
      ['r1', 'u1'],
    ])
  })

  it('counts the items not here when the chat there is cut', async () => {
    const sessions = await openRemote()
    const chat = sessions.chats.get('r1')!
    fire({ type: 'item', sessionId: 'r1', item: user('u5') })
    expect(ids(chat.items)).toEqual(['u3', 'u4', 'u5'])
    // A prompt edited there: the chat keeps its first 4 of all 6, 3 of them not here.
    fire({ type: 'truncated', sessionId: 'r1', length: 4 })
    expect(ids(chat.items)).toEqual(['u3'])
    expect(chat.older).toBe(3)
    // Cut before what is here: none of it stays.
    fire({ type: 'truncated', sessionId: 'r1', length: 2 })
    expect(chat.items).toEqual([])
    expect(chat.older).toBe(2)
  })

  it('never asks for this device’s own chats: they come whole', async () => {
    const { useSessionsStore } = await import('./sessions')
    const sessions = useSessionsStore(null)
    await sessions.load()
    await sessions.open('s1')
    expect(sessions.chats.get('s1')).toMatchObject({ older: 0 })
    await sessions.loadOlder('s1')
    expect(api.remote.invoke).not.toHaveBeenCalled()
  })
})
