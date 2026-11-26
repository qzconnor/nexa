import { isAbsolute } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import type { FileTreeWatch, TimedTouch } from '@shared/files'
import { FilesEvent, FilesInvoke } from '@shared/files-ipc'
import { broadcast, handle, remoteCaller } from '../ipc'
import { perWindow, remoteSender, type WindowSender } from '../lib/per-window'
import { isCommitHash, isTreePath, type FileTreeService } from './file-tree-service'
import type { GitService } from './git-service'
import { inFolders } from './remote-roots'

/** Longer paths exist on no file system the app runs on. */
const MAX_PATH_LENGTH = 32_767
/** The most folders whose repositories are watched for checkouts at once. */
const MAX_WATCHED_FOLDERS = 500
/** The most file trees watched at once, and open folders per tree. */
const MAX_FILE_TREES = 64
const MAX_TREE_DIRS = 2000
/** The longest text the content search of a tree takes. */
const MAX_GREP_QUERY = 200
/** The longest patch a section of changes is checked against (the diff view shows no longer one). */
const MAX_HUNK_PATCH = 4 * 1024 * 1024

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Ungültiger Parameter: ${name}`)
  return value
}

/** An absolute path from the window. */
function requirePath(value: unknown, name: string): string {
  const path = requireString(value, name)
  if (path.length > MAX_PATH_LENGTH || !isAbsolute(path) || path.includes('\0')) throw new Error(`Ungültiger Parameter: ${name}`)
  return path
}

/** A folder of a tree relative to its root: `/`-separated, without `..` and empty parts. */
function isTreeDir(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_PATH_LENGTH && isTreePath(value)
}

/** An entry of a tree, not its folder itself. */
function requireTreeEntry(value: unknown, name: string): string {
  if (!isTreeDir(value) || value === '') throw new Error(`Ungültiger Parameter: ${name}`)
  return value
}

function treesOf(value: unknown): FileTreeWatch[] {
  if (!Array.isArray(value) || value.length > MAX_FILE_TREES) throw new Error('Ungültiger Parameter: trees')
  return value.map((tree: { root?: unknown; dirs?: unknown } | null) => {
    const dirs = tree?.dirs
    if (!Array.isArray(dirs) || dirs.length > MAX_TREE_DIRS || !dirs.every(isTreeDir)) throw new Error('Ungültiger Parameter: dirs')
    return { root: requirePath(tree?.root, 'root'), dirs }
  })
}

/**
 * The channels of the file panel beside the chat, as in the Claude Manager. Paths come from the
 * window and are checked here: absolute folders, entries relative to them that never lead out.
 * Another device (Remote Control) reaches only the folders of this device's chats (`chatFolders`),
 * whatever it asks for; what it watches is its own, apart from the windows', until it stops watching.
 */
export function registerFilesIpc(
  files: FileTreeService,
  git: GitService,
  history: (sessionId: string) => Promise<TimedTouch[]>,
  chatFolders: () => string[],
): void {
  // Each window (the main one, chats in their own) watches what it shows; the services watch all of it.
  const watchGit = perWindow((cwds: string[]) => git.watch(cwds))
  const watchTrees = perWindow((trees: FileTreeWatch[]) => files.watch(trees))

  /** Who watches: the window, or the other device as a window of its own. */
  function senderOf(event: IpcMainInvokeEvent): WindowSender {
    const device = remoteCaller(event)
    return device === null ? event.sender : remoteSender(device)
  }

  /** A folder or file the caller may reach: for another device only in the folders of the chats here. */
  function reach(event: IpcMainInvokeEvent, path: string): string {
    if (remoteCaller(event) !== null && !inFolders(path, chatFolders())) throw new Error('Der Ordner gehört zu keinem Chat auf diesem Gerät.')
    return path
  }

  /** The folder of a repository: from another device absolute and in the chats' folders; a window may name it as git does. */
  function repoDir(event: IpcMainInvokeEvent, value: unknown, name: string): string {
    return remoteCaller(event) === null ? requireString(value, name) : reach(event, requirePath(value, name))
  }

  /** An absolute path from the caller that it may reach. */
  const pathOf = (event: IpcMainInvokeEvent, value: unknown, name: string) => reach(event, requirePath(value, name))

  handle(FilesInvoke.gitBranch, (e, cwd: unknown) => git.branch(repoDir(e, cwd, 'cwd')))
  handle(FilesInvoke.gitWatch, (event, cwds: unknown) => {
    if (!Array.isArray(cwds) || cwds.length > MAX_WATCHED_FOLDERS) throw new Error('Ungültiger Parameter: cwds')
    return watchGit(senderOf(event), cwds.map((cwd) => repoDir(event, cwd, 'cwds')))
  })
  handle(FilesInvoke.gitWebUrl, (e, cwd: unknown) => git.webUrl(repoDir(e, cwd, 'cwd')))
  handle(FilesInvoke.gitMainWorktree, (e, cwd: unknown) => git.mainWorktree(repoDir(e, cwd, 'cwd')))
  handle(FilesInvoke.gitWorktreeCheck, (e, cwd: unknown) => git.worktreeCheck(pathOf(e, cwd, 'cwd')))
  git.on('changed', (cwd, branch) => broadcast(FilesEvent.gitBranchChanged, cwd, branch))

  handle(FilesInvoke.list, (e, dir: unknown) => files.list(pathOf(e, dir, 'dir')))
  handle(FilesInvoke.status, (e, root: unknown) => files.status(pathOf(e, root, 'root')))
  handle(FilesInvoke.searchList, (e, root: unknown) => files.searchList(pathOf(e, root, 'root')))
  handle(FilesInvoke.watch, (event, trees: unknown) => {
    const list = treesOf(trees)
    for (const tree of list) reach(event, tree.root)
    return watchTrees(senderOf(event), list)
  })
  handle(FilesInvoke.reviewBase, (e, root: unknown) => files.reviewBase(pathOf(e, root, 'root')))
  handle(FilesInvoke.diff, (e, root: unknown, path: unknown, full: unknown, base: unknown) => {
    // A file of the tree: relative to its folder, never above it.
    if (!isTreeDir(path) || path === '') throw new Error('Ungültiger Parameter: path')
    // A commit's hash, nothing git could take for an option.
    if (base !== null && base !== undefined && !isCommitHash(base)) throw new Error('Ungültiger Parameter: base')
    return files.diff(pathOf(e, root, 'root'), path, full === true, base ?? null)
  })
  // Entries of an open tree; the service keeps them in it and checks new names.
  handle(FilesInvoke.create, (e, root: unknown, path: unknown, dir: unknown) =>
    files.create(pathOf(e, root, 'root'), requireTreeEntry(path, 'path'), dir === true),
  )
  handle(FilesInvoke.rename, (e, root: unknown, from: unknown, to: unknown) =>
    files.rename(pathOf(e, root, 'root'), requireTreeEntry(from, 'from'), requireTreeEntry(to, 'to')),
  )
  handle(FilesInvoke.trash, (e, root: unknown, path: unknown) => files.trash(pathOf(e, root, 'root'), requireTreeEntry(path, 'path')))
  handle(FilesInvoke.grep, (e, root: unknown, query: unknown) => {
    if (typeof query !== 'string' || query.trim() === '' || query.length > MAX_GREP_QUERY || /[\0\r\n]/.test(query)) {
      throw new Error('Ungültiger Parameter: query')
    }
    return files.grep(pathOf(e, root, 'root'), query)
  })
  handle(FilesInvoke.stage, (e, root: unknown, path: unknown) => files.stage(pathOf(e, root, 'root'), requireTreeEntry(path, 'path')))
  handle(FilesInvoke.unstage, (e, root: unknown, path: unknown) => files.unstage(pathOf(e, root, 'root'), requireTreeEntry(path, 'path')))
  handle(FilesInvoke.discard, (e, root: unknown, path: unknown) => files.discard(pathOf(e, root, 'root'), requireTreeEntry(path, 'path')))
  handle(FilesInvoke.hunk, (e, root: unknown, path: unknown, change: unknown) => {
    const { patch, index, discard } = (change ?? {}) as Record<string, unknown>
    if (typeof patch !== 'string' || patch.length > MAX_HUNK_PATCH || !Number.isInteger(index) || (index as number) < 0) {
      throw new Error('Ungültiger Parameter: change')
    }
    return files.applyHunk(pathOf(e, root, 'root'), requireTreeEntry(path, 'path'), patch, index as number, discard === true)
  })
  handle(FilesInvoke.history, (_e, sessionId: unknown) => history(requireString(sessionId, 'sessionId')))
  files.on('changed', (root, dirs, gitChanged, repo) => broadcast(FilesEvent.changed, root, dirs, gitChanged, repo))
  files.on('touched', (sessionId, touches) => broadcast(FilesEvent.touched, sessionId, touches))
}
