import { folderKey, subfolderSegments } from '@shared/folders'
import type { Project, SessionMeta } from '@shared/types'

/** A folder in a project that chats work in, as the sidebar shows it under the project. */
export interface FolderNode {
  /** Unique in the sidebar: the project and the folder. */
  id: string
  path: string
  /** Its name; `a/b` when `a` has no chats of its own and only `b` in it, so the tree stays flat. */
  name: string
  /** A worktree (`.claude/worktrees/<name>`, or a folder of one in `name`): named by itself, without those two levels. */
  worktree: boolean
  folders: FolderNode[]
  /** Its own chats: pinned first, then the latest. */
  sessions: SessionMeta[]
  /** Chats in it and in the folders below. */
  count: number
  /** The latest of them, ms. */
  updatedAt: number
}

export interface ProjectTree {
  folders: FolderNode[]
  /** The chats in the project's own folder. */
  sessions: SessionMeta[]
}

/** A project as the sidebar shows it. */
export interface ProjectEntry {
  project: Project
  /** Its chats (those the search finds while searching). */
  count: number
  tree: ProjectTree
}

const bySession = (a: SessionMeta, b: SessionMeta) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt

function childPath(parent: string, name: string): string {
  const separator = parent.includes('\\') || /^[a-z]:/i.test(parent) ? '\\' : '/'
  return /[\\/]$/.test(parent) ? `${parent}${name}` : `${parent}${separator}${name}`
}

interface Bucket {
  path: string
  name: string
  worktree: boolean
  folders: Map<string, Bucket>
  sessions: SessionMeta[]
}

/**
 * The chats of a project by the folders they work in, as the Claude Manager shows a project: every
 * level between the project and a chat's folder is a folder of its own, folders first, the latest on
 * top. A worktree (`.claude/worktrees/<name>`, Claude Code's and Nexa's) is one level, by its name. A
 * chat whose folder lies outside the project is one of the project's own.
 */
export function projectTree(projectId: string, projectPath: string, sessions: readonly SessionMeta[]): ProjectTree {
  const root: Bucket = { path: projectPath, name: '', worktree: false, folders: new Map(), sessions: [] }
  for (const meta of sessions) {
    let bucket = root
    const segments = meta.cwd ? subfolderSegments(meta.cwd, projectPath) : []
    for (let i = 0; i < segments.length; i++) {
      const worktree = segments[i] === '.claude' && segments[i + 1] === 'worktrees' && i + 2 < segments.length
      const segment = worktree ? segments[i + 2]! : segments[i]!
      const path = worktree ? childPath(childPath(childPath(bucket.path, '.claude'), 'worktrees'), segment) : childPath(bucket.path, segment)
      if (worktree) i += 2
      const key = folderKey(path)
      let next = bucket.folders.get(key)
      if (!next) {
        next = { path, name: segment, worktree, folders: new Map(), sessions: [] }
        bucket.folders.set(key, next)
      }
      bucket = next
    }
    bucket.sessions.push(meta)
  }

  const toNode = (bucket: Bucket): FolderNode => {
    let current = bucket
    let name = bucket.name
    let worktree = bucket.worktree
    // A folder with nothing but one folder in it shows as one level: `packages/core`.
    while (current.sessions.length === 0 && current.folders.size === 1) {
      current = current.folders.values().next().value!
      name = `${name}/${current.name}`
      worktree ||= current.worktree
    }
    const folders = [...current.folders.values()].map(toNode).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'de'))
    const own = [...current.sessions].sort(bySession)
    return {
      id: `${projectId}\n${folderKey(current.path)}`,
      path: current.path,
      name,
      worktree,
      folders,
      sessions: own,
      count: own.length + folders.reduce((sum, f) => sum + f.count, 0),
      updatedAt: Math.max(0, ...own.map((s) => s.updatedAt), ...folders.map((f) => f.updatedAt)),
    }
  }

  return {
    folders: [...root.folders.values()].map(toNode).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'de')),
    sessions: [...root.sessions].sort(bySession),
  }
}

/**
 * The chats for „Angeheftet“ on top of the sidebar, as in the Claude Manager: the pinned ones of the
 * projects shown, the latest first. They stay in their projects too, so pinning moves nothing away.
 */
export function pinnedChats(sessions: readonly SessionMeta[], projectIds: ReadonlySet<string>): SessionMeta[] {
  return sessions.filter((m) => m.pinned && !m.archived && projectIds.has(m.projectId)).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** The chats of a project or folder with those in the folders below. */
export function chatsIn(node: ProjectTree): SessionMeta[] {
  return [...node.sessions, ...node.folders.flatMap(chatsIn)]
}

/** The ids of the folders down to the one a chat works in, to open them when it is shown. */
export function foldersOf(tree: ProjectTree, sessionId: string): string[] {
  const search = (folders: readonly FolderNode[]): string[] | null => {
    for (const folder of folders) {
      if (folder.sessions.some((s) => s.id === sessionId)) return [folder.id]
      const below = search(folder.folders)
      if (below) return [folder.id, ...below]
    }
    return null
  }
  return search(tree.folders) ?? []
}
