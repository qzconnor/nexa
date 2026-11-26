import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Project, SessionMeta } from '@shared/types'

/**
 * The folders another device may reach with the file panel (Remote Control): those of this device's
 * chats, as the user and their agents chose them. Projects, the folders chats work in (worktrees too),
 * the folders added to them; nothing else of the disk.
 */
export function chatFolders(projects: readonly Project[], sessions: readonly SessionMeta[]): string[] {
  const folders = new Set<string>()
  for (const project of projects) folders.add(project.path)
  for (const meta of sessions) {
    if (meta.cwd) folders.add(meta.cwd)
    if (meta.worktree?.path) folders.add(meta.worktree.path)
    for (const dir of meta.dirs ?? []) folders.add(dir)
  }
  return [...folders].filter((folder) => typeof folder === 'string' && isAbsolute(folder))
}

/**
 * Whether `path` is one of `folders` or lies in one. Compared once `..` and `.` are resolved, so a path
 * that only starts like a folder (`F:\app\..\Windows`) doesn't count; on Windows without regard to
 * case, as its file systems do (path.relative).
 */
export function inFolders(path: string, folders: readonly string[]): boolean {
  if (!isAbsolute(path) || path.includes('\0')) return false
  const target = resolve(path)
  return folders.some((folder) => {
    const rel = relative(resolve(folder), target)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  })
}
