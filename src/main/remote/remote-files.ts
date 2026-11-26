import type { FileTouch, FileTreeWatch } from '@shared/files'
import { FilesEvent, FilesInvoke } from '@shared/files-ipc'
import type { RemoteEvent } from '@shared/remote'

/**
 * The file panel of another device's window over Remote Control: which of this device's file events
 * it gets, and how they wait for its next bundle. A folder changes in bursts (a build, `npm install`),
 * so its changes go together, and only for the folders that device has on screen.
 */

/** The events of the file panel. */
export const FILES_EVENTS: ReadonlySet<string> = new Set<string>([FilesEvent.changed, FilesEvent.touched, FilesEvent.gitBranchChanged])

/** What a device watches of this device's files. */
export interface FilesWatch {
  /** The folders of its trees (`files:watch`), as it names them: the service reports them so. */
  trees: ReadonlySet<string>
  /** The folders whose repository's branch it follows (`git:watch`). */
  repos: ReadonlySet<string>
}

export const NO_FILES_WATCH: FilesWatch = { trees: new Set(), repos: new Set() }

/** What a watch call the host answered sets, replacing what it set before; null for other calls. */
export function watchedBy(channel: string, args: readonly unknown[]): Partial<FilesWatch> | null {
  const list: unknown[] = Array.isArray(args[0]) ? args[0] : []
  if (channel === FilesInvoke.watch) {
    return { trees: new Set(list.map((tree) => (tree as Partial<FileTreeWatch> | null)?.root).filter((root): root is string => typeof root === 'string')) }
  }
  if (channel === FilesInvoke.gitWatch) return { repos: new Set(list.filter((cwd): cwd is string => typeof cwd === 'string')) }
  return null
}

/** Whether a file event is the device's: of a folder it watches, or of the agent of a chat it has open (`chats`). */
export function isFilesEventFor(channel: string, args: readonly unknown[], watch: FilesWatch, chats: ReadonlySet<string>): boolean {
  const key = args[0] as string
  switch (channel) {
    case FilesEvent.changed:
      return watch.trees.has(key)
    case FilesEvent.gitBranchChanged:
      return watch.repos.has(key)
    case FilesEvent.touched:
      return chats.has(key)
    default:
      return false
  }
}

/**
 * A file event into a device's next bundle, after what waits there: the changes of a folder join those
 * still waiting for it (each folder once), the files an agent touched join its waiting ones, a newer
 * branch replaces the waiting one.
 */
export function queueFilesEvent(queue: readonly RemoteEvent[], channel: string, args: unknown[]): RemoteEvent[] {
  const waiting = queue.find((e): e is { ch: string; args: unknown[] } => e.ch === channel && 'args' in e && e.args[0] === args[0])
  const rest = waiting ? queue.filter((e) => e !== waiting) : [...queue]
  if (!waiting) return [...rest, { ch: channel, args }]
  const before = waiting.args
  switch (channel) {
    case FilesEvent.changed: {
      const dirs = [...new Set([...(before[1] as string[]), ...(args[1] as string[])])]
      return [...rest, { ch: channel, args: [args[0], dirs, before[2] === true || args[2] === true, before[3] === true || args[3] === true] }]
    }
    case FilesEvent.touched:
      return [...rest, { ch: channel, args: [args[0], [...(before[1] as FileTouch[]), ...(args[1] as FileTouch[])]] }]
    default:
      return [...rest, { ch: channel, args }]
  }
}
