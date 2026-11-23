import { folderKey, subfolderSegments } from '@shared/folders'
import type { Project, SessionMeta } from '@shared/types'

/** A folder in a project that chats work in, as the sidebar shows it under the project. */
export interface FolderNode {
  /** Unique in the sidebar: the project and the folder. */
  id: string
  path: string
  /** Its name; `a/b` when `a` has no chats of its own and only `b` in it, so the tree stays flat. */
  name: string
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
  folders: Map<string, Bucket>
  sessions: SessionMeta[]
}

/**
 * The chats of a project by the folders they work in, as the Claude Manager shows a project: every
 * level between the project and a chat's folder is a folder of its own, folders first, the latest on
 * top. A chat whose folder lies outside the project is one of the project's own.
 */
export function projectTree(projectId: string, projectPath: string, sessions: readonly SessionMeta[]): ProjectTree {
  const root: Bucket = { path: projectPath, name: '', folders: new Map(), sessions: [] }
  for (const meta of sessions) {
    let bucket = root
    for (const segment of meta.cwd ? subfolderSegments(meta.cwd, projectPath) : []) {
      const path = childPath(bucket.path, segment)
      const key = folderKey(path)
      let next = bucket.folders.get(key)
      if (!next) {
        next = { path, name: segment, folders: new Map(), sessions: [] }
        bucket.folders.set(key, next)
      }
      bucket = next
    }
    bucket.sessions.push(meta)
  }

  const toNode = (bucket: Bucket): FolderNode => {
    let current = bucket
    let name = bucket.name
    // A folder with nothing but one folder in it shows as one level: `packages/core`.
    while (current.sessions.length === 0 && current.folders.size === 1) {
      current = current.folders.values().next().value!
      name = `${name}/${current.name}`
    }
    const folders = [...current.folders.values()].map(toNode).sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, 'de'))
    const own = [...current.sessions].sort(bySession)
    return {
      id: `${projectId}\n${folderKey(current.path)}`,
      path: current.path,
      name,
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
