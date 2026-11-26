import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { defaultSettings } from '@shared/defaults'
import type { FileTouch, TimedTouch } from '@shared/files'
import { FilesEvent, FilesInvoke } from '@shared/files-ipc'
import { IpcInvoke } from '@shared/ipc'
import type { RemoteBroadcast } from '@shared/remote'
import type { SessionMeta } from '@shared/types'
import { mergeKnown } from '@shared/utils'

// Another device that lets this one do everything; whether it is reachable doesn't matter here.
vi.mock('./devices', () => ({ useDevicesStore: () => ({ devices: [], can: () => true }) }))

/** What the agent did in a chat: from its history once shown, then live; cleared by hand. */

function meta(id: string): SessionMeta {
  return {
    id,
    projectId: 'p',
    title: id,
    titleSource: 'auto',
    provider: 'claude',
    model: '',
    effort: '',
    permissionMode: 'ask',
    createdAt: 0,
    updatedAt: 0,
    cli: {},
  }
}

let metas: SessionMeta[]
let metasChanged: (next: SessionMeta[]) => void
let touched: (sessionId: string, touches: FileTouch[]) => void
let filesChanged: (root: string, dirs: string[], git: boolean, repo: boolean) => void
let history: TimedTouch[]
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
  platform: 'win32',
  settings: {
    onChanged: () => () => {},
    update: vi.fn(async (patch: Record<string, unknown>) => mergeKnown(defaultSettings(), patch)),
  },
  app: { onQuitting: () => () => {}, info: vi.fn(async () => null) },
  window: { state: vi.fn(async () => ({ maximized: false, focused: true, fullscreen: false })), onState: () => () => {} },
  projects: { list: vi.fn(async () => [{ id: 'p', name: 'dev', path: 'C:\\dev' }]), onChanged: () => () => {}, sections: vi.fn(async () => []), onSectionsChanged: () => () => {} },
  sessions: {
    list: vi.fn(async () => metas),
    runtimes: vi.fn(async () => ({})),
    onChanged: (cb: typeof metasChanged) => {
      metasChanged = cb
      return () => {}
    },
    onEvent: () => () => {},
  },
  files: {
    watch: vi.fn(async () => {}),
    list: vi.fn(async () => ({ entries: [], omitted: 0 })),
    status: vi.fn(async () => null),
    history: vi.fn(async () => history),
    onChanged: (cb: typeof filesChanged) => {
      filesChanged = cb
      return () => {}
    },
    onTouched: (cb: typeof touched) => {
      touched = cb
      return () => {}
    },
  },
}

async function load(ids: string[]) {
  metas = ids.map(meta)
  const { useSessionsStore } = await import('./sessions')
  const { useProjectsStore } = await import('./projects')
  const { useFileTreeStore } = await import('./file-tree')
  await Promise.all([useSessionsStore().load(), useProjectsStore().load()])
  return useFileTreeStore()
}

const read = (path: string): FileTouch => ({ path, kind: 'read' })

beforeEach(() => {
  history = []
  vi.stubGlobal('window', { api })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('changes on disk', () => {
  it('ask git again only when main says git may see them', async () => {
    const fileTree = await load(['s1'])
    vi.useFakeTimers()
    try {
      fileTree.hold('C:\\dev')
      await vi.advanceTimersByTimeAsync(1000)
      api.files.status.mockClear()
      // An install in node_modules: the folders it shows may reload, git isn't asked.
      filesChanged('C:\\dev', ['node_modules/pkg'], false, false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(api.files.status).not.toHaveBeenCalled()
      filesChanged('C:\\dev', [''], true, false)
      await vi.advanceTimersByTimeAsync(1000)
      expect(api.files.status).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('activity', () => {
  it('is cleared by hand, only for that chat', async () => {
    const fileTree = await load(['s1', 's2'])
    touched('s1', [read('C:\\dev\\a.ts'), read('C:\\dev\\b.ts')])
    touched('s2', [read('C:\\dev\\c.ts')])
    expect(fileTree.activityOf('s1')?.size).toBe(2)
    fileTree.clearActivity('s1')
    expect(fileTree.activityOf('s1')).toBeNull()
    expect(fileTree.activityOf('s2')?.size).toBe(1)
    touched('s1', [read('C:\\dev\\d.ts')])
    expect([...fileTree.activityOf('s1')!.keys()]).toEqual(['C:\\dev\\d.ts'])
  })

  it('starts with the chat’s recent history, what was seen live staying the most recent', async () => {
    const fileTree = await load(['s1'])
    const now = Date.now()
    history = [
      { path: 'C:\\dev\\old.ts', kind: 'write', at: now - 10 * 60_000 },
      { path: 'C:\\dev\\a.ts', kind: 'read', at: now - 2000 },
      { path: 'C:\\dev\\b.ts', kind: 'write', at: now - 1000 },
    ]
    touched('s1', [read('C:\\dev\\a.ts')])
    await fileTree.loadHistory('s1')
    const activity = fileTree.activityOf('s1')!
    expect([...activity.keys()]).toEqual(['C:\\dev\\b.ts', 'C:\\dev\\a.ts'])
    expect(activity.get('C:\\dev\\a.ts')!.read).toBeGreaterThan(now - 2000)
    expect(activity.get('C:\\dev\\b.ts')!.write).toBe(now - 1000)
  })

  it('lets each kind run out: a read after a minute, a write after five', async () => {
    const fileTree = await load(['s1'])
    vi.useFakeTimers()
    try {
      touched('s1', [read('C:\\dev\\a.ts'), read('C:\\dev\\b.ts'), { path: 'C:\\dev\\b.ts', kind: 'write' }])
      await vi.advanceTimersByTimeAsync(59_000)
      expect(fileTree.activityOf('s1')?.size).toBe(2)
      await vi.advanceTimersByTimeAsync(2000)
      expect([...fileTree.activityOf('s1')!.keys()]).toEqual(['C:\\dev\\b.ts'])
      expect(Object.keys(fileTree.activityOf('s1')!.get('C:\\dev\\b.ts')!)).toEqual(['write'])
      await vi.advanceTimersByTimeAsync(4 * 60_000)
      expect(fileTree.activityOf('s1')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lasts as long as set; set shorter, what is older goes at once', async () => {
    const fileTree = await load(['s1'])
    const { useSettingsStore } = await import('./settings')
    vi.useFakeTimers()
    try {
      touched('s1', [{ path: 'C:\\dev\\a.ts', kind: 'write' }])
      await vi.advanceTimersByTimeAsync(20_000)
      expect(fileTree.activityOf('s1')?.size).toBe(1)
      await useSettingsStore(null).update({ general: { activitySeconds: { write: 15 } } })
      await nextTick()
      expect(fileTree.activityOf('s1')).toBeNull()
      touched('s1', [{ path: 'C:\\dev\\b.ts', kind: 'write' }])
      await vi.advanceTimersByTimeAsync(16_000)
      expect(fileTree.activityOf('s1')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks for the history once, also after it was cleared', async () => {
    const fileTree = await load(['s1'])
    history = [{ path: 'C:\\dev\\a.ts', kind: 'read', at: Date.now() }]
    await fileTree.loadHistory('s1')
    expect(fileTree.activityOf('s1')?.size).toBe(1)
    fileTree.clearActivity('s1')
    await fileTree.loadHistory('s1')
    expect(api.files.history).toHaveBeenCalledTimes(1)
    expect(fileTree.activityOf('s1')).toBeNull()
  })

  it('goes with its chat', async () => {
    const fileTree = await load(['s1', 's2'])
    touched('s1', [read('C:\\dev\\a.ts')])
    fileTree.showDiff(fileTree.targetOf('s1')!, 'a.ts')
    metasChanged([meta('s2')])
    await nextTick()
    expect(fileTree.activityOf('s1')).toBeNull()
    expect(fileTree.diffOf('s1')).toBeNull()
  })
})

describe('target', () => {
  it('is the folder of the chat’s project', async () => {
    const fileTree = await load(['s1'])
    expect(fileTree.targetOf('s1')).toEqual({ id: 's1', root: 'C:\\dev' })
    expect(fileTree.targetOf('missing')).toBeNull()
  })
})

describe('the tree of another device’s chat', () => {
  /** A device on Linux with the chat `r1` in `/home/me/dev`. */
  async function loadDevice() {
    api.remote.invoke.mockImplementation(async (_instance, ch, args) => {
      switch (ch) {
        case IpcInvoke.sessionsList:
          return [{ ...meta('r1'), projectId: 'q' }]
        case IpcInvoke.sessionsRuntimes:
          return {}
        case IpcInvoke.projectsList:
          return [{ id: 'q', name: 'dev', path: '/home/me/dev' }]
        case IpcInvoke.sectionsList:
          return []
        case FilesInvoke.list:
          return { entries: [{ name: `in ${String(args[0])}`, dir: false }], omitted: 0 }
        default:
          return null
      }
    })
    const own = await load(['s1'])
    const { useSessionsStore } = await import('./sessions')
    const { useProjectsStore } = await import('./projects')
    const { useFileTreeStore } = await import('./file-tree')
    await Promise.all([useSessionsStore('dev1').load(), useProjectsStore('dev1').load()])
    return { own, remote: useFileTreeStore('dev1') }
  }
  const callsOf = (ch: string) => api.remote.invoke.mock.calls.filter((c) => c[1] === ch).map((c) => [c[0], ...c[2]])

  it('is of that device’s folder, its paths with that system’s separator', async () => {
    const { own, remote } = await loadDevice()
    expect(remote.targetOf('r1')).toEqual({ id: 'r1', root: '/home/me/dev' })
    expect(own.targetOf('r1')).toBeNull()
    expect(remote.separatorOf('/home/me/dev')).toBe('/')
    expect(remote.separatorOf('D:\\work')).toBe('\\')
    // This device's own trees go by its own system.
    expect(own.separatorOf('/home/me/dev')).toBe('\\')
  })

  it('reads and watches the folder there, and follows its changes', async () => {
    const { remote } = await loadDevice()
    const model = remote.hold('/home/me/dev')
    await vi.waitFor(() => expect(model.listings.has('')).toBe(true))
    remote.setExpanded(model, 'src', true)
    await vi.waitFor(() => expect(model.listings.has('src')).toBe(true))
    expect(callsOf(FilesInvoke.list)).toEqual([
      ['dev1', '/home/me/dev'],
      ['dev1', '/home/me/dev/src'],
    ])
    expect(callsOf(FilesInvoke.status)).toEqual([['dev1', '/home/me/dev']])
    await vi.waitFor(() => expect(callsOf(FilesInvoke.watch).at(-1)).toEqual(['dev1', [{ root: '/home/me/dev', dirs: expect.any(Array) }]]))
    // This device's own files stay out of it.
    expect(api.files.list).not.toHaveBeenCalled()
    expect(api.files.watch).not.toHaveBeenCalled()

    remoteEvents('dev1', [{ ch: FilesEvent.changed, args: ['/home/me/dev', ['src'], false, false] }])
    await vi.waitFor(() => expect(callsOf(FilesInvoke.list)).toHaveLength(3))
    // The same folder changing on this device is another one.
    filesChanged('/home/me/dev', ['src'], false, false)
    remoteEvents('other', [{ ch: FilesEvent.changed, args: ['/home/me/dev', ['src'], false, false] }])
    await Promise.resolve()
    expect(callsOf(FilesInvoke.list)).toHaveLength(3)
  })

  it('looks like the trees of this device, but keeps its open folders to itself', async () => {
    const { own, remote } = await loadDevice()
    own.setWidth(420)
    own.open = true
    expect(remote.width).toBe(420)
    expect(remote.open).toBe(true)
    const model = remote.hold('/home/me/dev')
    remote.setExpanded(model, 'src', true)
    remote.release('/home/me/dev')
    expect(own.hold('/home/me/dev').expanded.has('src')).toBe(false)
  })
})
