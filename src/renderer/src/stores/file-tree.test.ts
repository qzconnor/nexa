import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { FileTouch, TimedTouch } from '@shared/files'
import type { SessionMeta } from '@shared/types'

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

const api = {
  platform: 'win32',
  settings: { onChanged: () => () => {} },
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
