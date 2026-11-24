import { statSync } from 'node:fs'
import type { ProviderId } from '@shared/chat'
import { childFolder, folderKey, innermostFolder, subfolderSegments } from '@shared/folders'
import type { ImportGroup } from '@shared/import-ipc'
import type { AppSettings, Project, SessionMeta } from '@shared/types'
import { baseName, firstLine } from '@shared/utils'
import type { TranscriptSummary } from '../providers/claude/claude-transcript'

/**
 * What taking sessions over (from the Claude Manager, or from the CLIs' own folders) has in common:
 * which project each goes to, and the chat it becomes.
 */

/** What a list of a CLI's sessions tells of one, as far as an import needs it. */
export type SessionSummary = Pick<TranscriptSummary, 'cwd' | 'title' | 'firstPrompt' | 'lastPrompt' | 'createdAt' | 'updatedAt'>

/** A conversation of a CLI, found in a config folder, that is to become a chat. */
export interface CliSession {
  provider: ProviderId
  id: string
  /** The config folder that keeps it. */
  configDir: string
  /** Nexa's account with that folder, if it has one. */
  accountId?: string
  /** Claude Code: its transcript. */
  file?: string
  /** When it was written to last, for sessions whose summary doesn't say. */
  mtimeMs: number
  summary: SessionSummary
}

export interface PlacedGroup<T> extends ImportGroup {
  sessions: number
  members: T[]
}

/**
 * Sorts the sessions into what they become, as the Claude Manager places them: the innermost workspace
 * (or project Nexa has) their folder lies in, else a project of their folder's own. The workspaces come
 * along also without sessions, as separators to start projects in.
 */
export function planGroups<T extends { summary: Pick<SessionSummary, 'cwd' | 'updatedAt'> }>(
  sessions: readonly T[],
  workspaces: readonly string[],
  projects: readonly Pick<Project, 'path'>[],
  exists: (path: string) => boolean,
): PlacedGroup<T>[] {
  const roots = [...projects.map((p) => p.path), ...workspaces]
  // A workspace stays one also when Nexa has a project of its folder: it becomes the separator's own.
  const workspaceKeys = new Set(workspaces.map(folderKey))
  const kindOf = (path: string) => (workspaceKeys.has(folderKey(path)) ? 'workspace' : 'project')
  const groups = new Map<string, PlacedGroup<T>>()
  const group = (path: string, kind: ImportGroup['kind']) => {
    const key = folderKey(path)
    let found = groups.get(key)
    if (!found) {
      found = { path, name: baseName(path) || path, kind, exists: exists(path), sessions: 0, inSubfolders: 0, updatedAt: null, members: [] }
      groups.set(key, found)
    }
    return found
  }
  for (const workspace of workspaces) group(workspace, 'workspace')
  for (const session of sessions) {
    const cwd = session.summary.cwd
    if (!cwd) continue
    const root = innermostFolder(cwd, roots, (path) => path)
    const target = root ? group(root, kindOf(root)) : group(cwd, 'folder')
    target.members.push(session)
    target.sessions++
    if (folderKey(cwd) !== folderKey(target.path)) target.inSubfolders++
    const at = session.summary.updatedAt
    if (at !== null && (target.updatedAt === null || at > target.updatedAt)) target.updatedAt = at
  }
  for (const g of groups.values()) {
    if (g.kind === 'workspace') g.projects = new Set(g.members.map((m) => projectFolder(m.summary.cwd!, g.path).toLowerCase())).size
  }
  const order = (g: PlacedGroup<T>) => (g.kind === 'folder' ? 1 : 0)
  return [...groups.values()].sort((a, b) => order(a) - order(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name, 'de'))
}

/** The project folder of a session in a workspace: the subfolder of the first level it lies in, else the workspace. */
export function projectFolder(cwd: string, workspace: string): string {
  const [first] = subfolderSegments(cwd, workspace)
  return first ? childFolder(workspace, first) : workspace
}

/** The title a session gets: the name the user gave it elsewhere, its own, its first prompt. */
export function sessionTitle(summary: Pick<SessionSummary, 'title' | 'firstPrompt'>, givenName: string | undefined): { title: string; titleSource: SessionMeta['titleSource'] } {
  if (givenName) return { title: givenName, titleSource: 'user' }
  const title = summary.title ?? (summary.firstPrompt ? firstLine(summary.firstPrompt, 80) : null)
  return { title: title || 'Ohne Titel', titleSource: summary.title ? 'user' : 'auto' }
}

/**
 * The chat a session becomes: it goes on with the CLI's conversation where it left off, in the folder
 * it ran in; its history comes in when it is opened first (`importedFrom`).
 */
export function importedSessionMeta(session: CliSession, project: Project, settings: AppSettings, extra: Partial<SessionMeta> = {}): Omit<SessionMeta, 'id'> {
  const { summary, provider, accountId } = session
  const cwd = summary.cwd!
  const prompt = summary.lastPrompt ?? summary.firstPrompt
  return {
    projectId: project.id,
    ...sessionTitle(summary, undefined),
    provider,
    model: settings[provider].model,
    effort: settings[provider].effort,
    permissionMode: settings.defaults.permissionMode,
    createdAt: summary.createdAt ?? session.mtimeMs,
    updatedAt: summary.updatedAt ?? session.mtimeMs,
    ...(prompt ? { preview: firstLine(prompt, 100) } : {}),
    cli: { [provider]: { sessionId: session.id, seenItems: 0, configDir: session.configDir, ...(accountId ? { accountId } : {}) } },
    ...(accountId ? { accounts: { [provider]: accountId } } : {}),
    ...(folderKey(cwd) !== folderKey(project.path) ? { cwd } : {}),
    importedFrom: session.file ?? session.id,
    ...extra,
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
