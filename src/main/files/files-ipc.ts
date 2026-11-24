import { isAbsolute } from 'node:path'
import type { FileTreeWatch, TimedTouch } from '@shared/files'
import { FilesEvent, FilesInvoke } from '@shared/files-ipc'
import { broadcast, handle } from '../ipc'
import { isCommitHash, isTreePath, type FileTreeService } from './file-tree-service'
import type { GitService } from './git-service'

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
 */
export function registerFilesIpc(
  files: FileTreeService,
  git: GitService,
  history: (sessionId: string) => Promise<TimedTouch[]>,
): void {
  handle(FilesInvoke.gitBranch, (_e, cwd: unknown) => git.branch(requireString(cwd, 'cwd')))
  handle(FilesInvoke.gitWatch, (_e, cwds: unknown) => {
    if (!Array.isArray(cwds) || cwds.length > MAX_WATCHED_FOLDERS) throw new Error('Ungültiger Parameter: cwds')
    return git.watch(cwds.map((cwd) => requireString(cwd, 'cwds')))
  })
  handle(FilesInvoke.gitWebUrl, (_e, cwd: unknown) => git.webUrl(requireString(cwd, 'cwd')))
  handle(FilesInvoke.gitMainWorktree, (_e, cwd: unknown) => git.mainWorktree(requireString(cwd, 'cwd')))
  handle(FilesInvoke.gitWorktreeCheck, (_e, cwd: unknown) => git.worktreeCheck(requirePath(cwd, 'cwd')))
  git.on('changed', (cwd, branch) => broadcast(FilesEvent.gitBranchChanged, cwd, branch))

  handle(FilesInvoke.list, (_e, dir: unknown) => files.list(requirePath(dir, 'dir')))
  handle(FilesInvoke.status, (_e, root: unknown) => files.status(requirePath(root, 'root')))
  handle(FilesInvoke.searchList, (_e, root: unknown) => files.searchList(requirePath(root, 'root')))
  handle(FilesInvoke.watch, (_e, trees: unknown) => files.watch(treesOf(trees)))
  handle(FilesInvoke.reviewBase, (_e, root: unknown) => files.reviewBase(requirePath(root, 'root')))
  handle(FilesInvoke.diff, (_e, root: unknown, path: unknown, full: unknown, base: unknown) => {
    // A file of the tree: relative to its folder, never above it.
    if (!isTreeDir(path) || path === '') throw new Error('Ungültiger Parameter: path')
    // A commit's hash, nothing git could take for an option.
    if (base !== null && base !== undefined && !isCommitHash(base)) throw new Error('Ungültiger Parameter: base')
    return files.diff(requirePath(root, 'root'), path, full === true, base ?? null)
  })
  // Entries of an open tree; the service keeps them in it and checks new names.
  handle(FilesInvoke.create, (_e, root: unknown, path: unknown, dir: unknown) =>
    files.create(requirePath(root, 'root'), requireTreeEntry(path, 'path'), dir === true),
  )
  handle(FilesInvoke.rename, (_e, root: unknown, from: unknown, to: unknown) =>
    files.rename(requirePath(root, 'root'), requireTreeEntry(from, 'from'), requireTreeEntry(to, 'to')),
  )
  handle(FilesInvoke.trash, (_e, root: unknown, path: unknown) => files.trash(requirePath(root, 'root'), requireTreeEntry(path, 'path')))
  handle(FilesInvoke.grep, (_e, root: unknown, query: unknown) => {
    if (typeof query !== 'string' || query.trim() === '' || query.length > MAX_GREP_QUERY || /[\0\r\n]/.test(query)) {
      throw new Error('Ungültiger Parameter: query')
    }
    return files.grep(requirePath(root, 'root'), query)
  })
  handle(FilesInvoke.stage, (_e, root: unknown, path: unknown) => files.stage(requirePath(root, 'root'), requireTreeEntry(path, 'path')))
  handle(FilesInvoke.unstage, (_e, root: unknown, path: unknown) => files.unstage(requirePath(root, 'root'), requireTreeEntry(path, 'path')))
  handle(FilesInvoke.discard, (_e, root: unknown, path: unknown) => files.discard(requirePath(root, 'root'), requireTreeEntry(path, 'path')))
  handle(FilesInvoke.hunk, (_e, root: unknown, path: unknown, change: unknown) => {
    const { patch, index, discard } = (change ?? {}) as Record<string, unknown>
    if (typeof patch !== 'string' || patch.length > MAX_HUNK_PATCH || !Number.isInteger(index) || (index as number) < 0) {
      throw new Error('Ungültiger Parameter: change')
    }
    return files.applyHunk(requirePath(root, 'root'), requireTreeEntry(path, 'path'), patch, index as number, discard === true)
  })
  handle(FilesInvoke.history, (_e, sessionId: unknown) => history(requireString(sessionId, 'sessionId')))
  files.on('changed', (root, dirs, gitChanged, repo) => broadcast(FilesEvent.changed, root, dirs, gitChanged, repo))
  files.on('touched', (sessionId, touches) => broadcast(FilesEvent.touched, sessionId, touches))
}
