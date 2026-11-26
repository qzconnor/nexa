import type { IpcMainInvokeEvent } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FilesInvoke } from '@shared/files-ipc'
import { endRemoteSender } from '../lib/per-window'
import type { FileTreeService } from './file-tree-service'
import { registerFilesIpc } from './files-ipc'
import type { GitService } from './git-service'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, Listener>() }))

// The handlers as `handle` registers them; a call of another device is told apart as `invokeHandler` makes it.
vi.mock('../ipc', () => ({
  handle: (channel: string, listener: Listener) => handlers.set(channel, listener),
  broadcast: () => {},
  remoteCaller: (event: { remote?: boolean; device?: string }) => (event.remote === true ? (event.device ?? '') : null),
}))

const win = path('C:\\dev', '/home/me/dev')
const folders = [win.root, path('C:\\other', '/home/me/other').root]

/** A path of this system, so the folder check sees it as absolute. */
function path(windows: string, posix: string) {
  const root = process.platform === 'win32' ? windows : posix
  const sep = process.platform === 'win32' ? '\\' : '/'
  return { root, in: (...parts: string[]) => [root, ...parts].join(sep) }
}

let files: Record<string, ReturnType<typeof vi.fn>>
let git: Record<string, ReturnType<typeof vi.fn>>

const local = { sender: { id: 1, once: vi.fn() } } as unknown as IpcMainInvokeEvent
const remote = (device: string) => ({ sender: null, remote: true, device }) as unknown as IpcMainInvokeEvent

function call(event: IpcMainInvokeEvent, channel: string, ...args: unknown[]): Promise<unknown> {
  const listener = handlers.get(channel)
  if (!listener) throw new Error(`no handler for ${channel}`)
  return Promise.resolve().then(() => listener(event, ...args))
}

beforeEach(() => {
  handlers.clear()
  const answer = (value: unknown) => vi.fn(async () => value)
  files = {
    list: answer({ entries: [], omitted: 0 }),
    status: answer(null),
    searchList: answer({ paths: [], truncated: false }),
    watch: vi.fn(),
    reviewBase: answer(null),
    diff: answer({ patch: '' }),
    create: answer(undefined),
    rename: answer(undefined),
    trash: answer(undefined),
    grep: answer({ files: [] }),
    stage: answer(undefined),
    unstage: answer(undefined),
    discard: answer(undefined),
    applyHunk: answer(undefined),
    on: vi.fn(),
  }
  git = { branch: answer(null), watch: vi.fn(), webUrl: answer(null), mainWorktree: answer(null), worktreeCheck: answer(null), on: vi.fn() }
  registerFilesIpc(files as unknown as FileTreeService, git as unknown as GitService, async () => [], () => folders)
})

describe('files from another device', () => {
  it('reach only the folders of the chats here', async () => {
    await call(remote('d1'), FilesInvoke.list, win.in('src'))
    expect(files.list).toHaveBeenCalledWith(win.in('src'))
    await call(remote('d1'), FilesInvoke.status, win.root)
    expect(files.status).toHaveBeenCalledWith(win.root)

    const outside = path('C:\\Windows', '/etc').root
    for (const channel of [FilesInvoke.list, FilesInvoke.status, FilesInvoke.searchList, FilesInvoke.reviewBase]) {
      await expect(call(remote('d1'), channel, outside)).rejects.toThrow('gehört zu keinem Chat')
    }
    await expect(call(remote('d1'), FilesInvoke.grep, outside, 'secret')).rejects.toThrow('gehört zu keinem Chat')
    await expect(call(remote('d1'), FilesInvoke.diff, outside, 'a.ts', false, null)).rejects.toThrow('gehört zu keinem Chat')
    await expect(call(remote('d1'), FilesInvoke.trash, outside, 'a.ts')).rejects.toThrow('gehört zu keinem Chat')
    await expect(call(remote('d1'), FilesInvoke.gitBranch, outside)).rejects.toThrow('gehört zu keinem Chat')
    expect(files.searchList).not.toHaveBeenCalled()
    expect(files.trash).not.toHaveBeenCalled()
    expect(git.branch).not.toHaveBeenCalled()
  })

  it("don't climb out of them, nor take a folder beside one with the same start", async () => {
    await expect(call(remote('d1'), FilesInvoke.list, win.in('..', 'secret'))).rejects.toThrow('gehört zu keinem Chat')
    await expect(call(remote('d1'), FilesInvoke.list, `${win.root}-kopie`)).rejects.toThrow('gehört zu keinem Chat')
    // Relative: never resolved against the working folder of the app.
    await expect(call(remote('d1'), FilesInvoke.list, 'dev')).rejects.toThrow('Ungültiger Parameter')
    await expect(call(remote('d1'), FilesInvoke.gitBranch, '.')).rejects.toThrow('Ungültiger Parameter')
    expect(files.list).not.toHaveBeenCalled()
  })

  it('watch only those folders, and only what is asked last until the device stops', async () => {
    await expect(call(remote('d1'), FilesInvoke.watch, [{ root: path('C:\\secret', '/secret').root, dirs: [''] }])).rejects.toThrow('gehört zu keinem Chat')
    expect(files.watch).not.toHaveBeenCalled()

    await call(local, FilesInvoke.watch, [{ root: folders[1], dirs: [''] }])
    await call(remote('d1'), FilesInvoke.watch, [{ root: win.root, dirs: ['', 'src'] }])
    expect(files.watch).toHaveBeenLastCalledWith([
      { root: folders[1], dirs: [''] },
      { root: win.root, dirs: ['', 'src'] },
    ])
    // Another device asks as a window of its own: its list replaces only its own.
    await call(remote('d2'), FilesInvoke.watch, [{ root: win.root, dirs: [''] }])
    await call(remote('d1'), FilesInvoke.watch, [])
    expect(files.watch).toHaveBeenLastCalledWith([
      { root: folders[1], dirs: [''] },
      { root: win.root, dirs: [''] },
    ])
    endRemoteSender('d2')
    await Promise.resolve()
    await Promise.resolve()
    expect(files.watch).toHaveBeenLastCalledWith([{ root: folders[1], dirs: [''] }])
  })

  it("watch the chats' repositories apart from the windows' as well", async () => {
    await call(local, FilesInvoke.gitWatch, ['repo'])
    await call(remote('d3'), FilesInvoke.gitWatch, [win.root])
    expect(git.watch).toHaveBeenLastCalledWith(['repo', win.root])
    await expect(call(remote('d3'), FilesInvoke.gitWatch, [path('C:\\', '/').root])).rejects.toThrow('gehört zu keinem Chat')
    endRemoteSender('d3')
    await Promise.resolve()
    await Promise.resolve()
    expect(git.watch).toHaveBeenLastCalledWith(['repo'])
  })
})

describe('files from a window', () => {
  it('reach any folder, as before', async () => {
    const outside = path('C:\\Windows', '/etc').root
    await call(local, FilesInvoke.list, outside)
    expect(files.list).toHaveBeenCalledWith(outside)
    // A window names a repository as git takes it.
    await call(local, FilesInvoke.gitBranch, 'repo')
    expect(git.branch).toHaveBeenCalledWith('repo')
  })
})
