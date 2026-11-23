import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { systemAccountId, type AccountKind } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import { childFolder, folderKey, innermostFolder, subfolderSegments } from '@shared/folders'
import type { ClaudeManagerFound, ImportAccount, ImportGroup, ImportInput, ImportPreview, ImportProgress, ImportResult } from '@shared/import-ipc'
import type { AppSettings, Project, SessionMeta } from '@shared/types'
import { DEFAULT_SECTION_ID } from '@shared/sections'
import { baseName, firstLine, isPlainObject } from '@shared/utils'
import type { AccountService } from '../accounts/account-service'
import { defaultClaudeConfigDir, defaultCodexHome } from '../accounts/cli-files'
import { pool } from '../lib/pool'
import { TypedEmitter } from '../lib/typed-emitter'
import { summarizeClaudeTranscript, type TranscriptSummary } from '../providers/claude/claude-transcript'
import type { ProjectService } from '../services/project-service'
import { projectToSection } from '../services/project-sections'
import type { SessionService } from '../services/session-service'
import { listTranscripts, type TranscriptFile } from './claude-sessions'

/**
 * Takes over from the Claude Manager, which keeps no sessions of its own: it lists Claude Code's
 * transcripts in the config folders of its accounts and sorts them into its workspaces (folders whose
 * subfolders are projects). Nexa takes the workspaces as separators with their subfolders as projects
 * under them, other folders as projects under the default separator; the accounts with the same folders,
 * so their logins and conversations stay where they are; and every session as a chat that resumes Claude
 * Code's conversation. The Claude Manager's files are only read.
 */

/** An account of the Claude Manager (its `accounts.json`, without the encrypted secret). */
export interface CmAccount {
  id: string
  name: string
  provider: ProviderId
  kind: AccountKind
  color: string
  /** The folder the CLI runs with. */
  configDir: string
}

export interface CmData {
  dir: string
  /** The workspace folders, in the user's order. */
  workspaces: string[]
  accounts: CmAccount[]
  /** Names the user gave sessions in the Claude Manager, by session id in lower case. */
  names: Record<string, string>
  /** Pinned sessions, by session id in lower case. */
  pinned: Set<string>
}

/** The Claude Manager's data folder: `Claude Manager` (older installs), else `Signalbox`. */
export function claudeManagerDir(appData: string): string | null {
  for (const name of ['Claude Manager', 'Signalbox']) {
    const dir = join(appData, name)
    if (existsSync(join(dir, 'accounts.json')) || existsSync(join(dir, 'workspaces.json'))) return dir
  }
  return null
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

const KINDS: readonly AccountKind[] = ['system', 'oauth', 'token', 'apiKey']

/** The accounts of a Claude Manager `accounts.json`, with the folder each runs with. */
export function cmAccounts(file: unknown, dir: string, env: NodeJS.ProcessEnv = process.env): CmAccount[] {
  const list = isPlainObject(file) && Array.isArray(file.accounts) ? file.accounts.filter(isPlainObject) : []
  const accounts: CmAccount[] = []
  for (const raw of list) {
    if (typeof raw.id !== 'string' || !KINDS.includes(raw.kind as AccountKind)) continue
    const provider: ProviderId = raw.provider === 'codex' ? 'codex' : 'claude'
    const kind = raw.kind as AccountKind
    const own = typeof raw.configDir === 'string' && raw.configDir.trim() ? raw.configDir.trim() : null
    const configDir = kind === 'system' ? (provider === 'claude' ? defaultClaudeConfigDir(env) : defaultCodexHome(env)) : (own ?? join(dir, 'profiles', raw.id))
    accounts.push({
      id: raw.id,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Account',
      provider,
      kind,
      color: typeof raw.color === 'string' ? raw.color : '#888888',
      configDir,
    })
  }
  // The Claude Manager always has the standard account of Claude Code, also when its file doesn't list it.
  if (!accounts.some((a) => a.kind === 'system' && a.provider === 'claude')) {
    accounts.unshift({ id: 'system', name: 'Standard (~/.claude)', provider: 'claude', kind: 'system', color: '#888888', configDir: defaultClaudeConfigDir(env) })
  }
  return accounts
}

export async function readClaudeManager(dir: string): Promise<CmData> {
  const [workspaces, accounts, names, marks] = await Promise.all(
    ['workspaces.json', 'accounts.json', 'session-names.json', 'session-marks.json'].map((name) => readJson(join(dir, name))),
  )
  const folders = isPlainObject(workspaces) && Array.isArray(workspaces.folders) ? workspaces.folders.filter((f): f is string => typeof f === 'string' && !!f.trim()) : []
  const named: Record<string, string> = {}
  if (isPlainObject(names) && isPlainObject(names.names)) {
    for (const [id, name] of Object.entries(names.names)) if (typeof name === 'string' && name.trim()) named[id.toLowerCase()] = name.trim()
  }
  const pinned = new Set<string>()
  if (isPlainObject(marks) && isPlainObject(marks.marks)) {
    for (const [id, mark] of Object.entries(marks.marks)) if (isPlainObject(mark) && mark.pinned === true) pinned.add(id.toLowerCase())
  }
  return { dir, workspaces: folders, accounts: cmAccounts(accounts, dir), names: named, pinned }
}

/** A session found in an account's folder, with what its transcript says. */
export interface FoundSession extends TranscriptFile {
  summary: TranscriptSummary
}

export interface PlacedGroup extends ImportGroup {
  sessions: number
  members: FoundSession[]
}

/**
 * Sorts the sessions into what they become, as the Claude Manager places them: the innermost workspace
 * (or project Nexa has) their folder lies in, else a project of their folder's own. The workspaces come
 * along also without sessions, as separators to start projects in.
 */
export function planGroups(
  sessions: readonly FoundSession[],
  workspaces: readonly string[],
  projects: readonly Pick<Project, 'path'>[],
  exists: (path: string) => boolean,
): PlacedGroup[] {
  const roots = [...projects.map((p) => p.path), ...workspaces]
  // A workspace stays one also when Nexa has a project of its folder: it becomes the separator's own.
  const workspaceKeys = new Set(workspaces.map(folderKey))
  const kindOf = (path: string) => (workspaceKeys.has(folderKey(path)) ? 'workspace' : 'project')
  const groups = new Map<string, PlacedGroup>()
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
  const order = (g: PlacedGroup) => (g.kind === 'folder' ? 1 : 0)
  return [...groups.values()].sort((a, b) => order(a) - order(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name, 'de'))
}

/** The project folder of a session in a workspace: the subfolder of the first level it lies in, else the workspace. */
export function projectFolder(cwd: string, workspace: string): string {
  const [first] = subfolderSegments(cwd, workspace)
  return first ? childFolder(workspace, first) : workspace
}

/** The title a session gets: its name in the Claude Manager, its own, its first prompt. */
export function sessionTitle(summary: TranscriptSummary, cmName: string | undefined): { title: string; titleSource: SessionMeta['titleSource'] } {
  if (cmName) return { title: cmName, titleSource: 'user' }
  const title = summary.title ?? (summary.firstPrompt ? firstLine(summary.firstPrompt, 80) : null)
  return { title: title || 'Ohne Titel', titleSource: summary.title ? 'user' : 'auto' }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

interface Scan {
  data: CmData
  groups: PlacedGroup[]
  preview: ImportPreview
}

export class ClaudeManagerImport extends TypedEmitter<{ progress: [ImportProgress] }> {
  private last: Scan | null = null

  constructor(
    private readonly appData: string,
    private readonly projects: ProjectService,
    private readonly sessions: SessionService,
    private readonly accounts: AccountService,
    private readonly settings: () => AppSettings,
  ) {
    super()
  }

  async detect(): Promise<ClaudeManagerFound | null> {
    const dir = claudeManagerDir(this.appData)
    if (!dir) return null
    const data = await readClaudeManager(dir)
    return { dir, workspaces: data.workspaces.length, accounts: data.accounts.filter((a) => a.kind !== 'system').length }
  }

  /** What account of Nexa a Claude Manager account becomes. */
  private accountAction(account: CmAccount): ImportAccount['action'] {
    if (account.kind === 'system') return 'standard'
    if (account.kind !== 'oauth') return 'skip'
    const key = folderKey(account.configDir)
    return this.accounts.list().some((a) => folderKey(a.configDir) === key) ? 'exists' : 'create'
  }

  async scan(): Promise<ImportPreview> {
    const dir = claudeManagerDir(this.appData)
    if (!dir) throw new Error('Nexa hat keine Daten des Claude Managers gefunden.')
    const data = await readClaudeManager(dir)
    // Every folder once, also when two accounts share one; only Claude Code's (Codex sessions stay where they are).
    const folders = new Map<string, string>()
    for (const account of data.accounts) if (account.provider === 'claude') folders.set(folderKey(account.configDir), account.configDir)
    const files = (await Promise.all([...folders.values()].map((folder) => listTranscripts(folder)))).flat()
    // A session copied to another account (when the account changed) counts once: where it went on last.
    const newest = new Map<string, TranscriptFile>()
    for (const file of files) {
      const seen = newest.get(file.id)
      if (!seen || file.mtimeMs > seen.mtimeMs) newest.set(file.id, file)
    }
    const known = this.sessions.knownCliSessions()
    const todo = [...newest.values()].filter((file) => !known.has(file.id))
    const found: FoundSession[] = []
    let done = 0
    let skipped = 0
    this.emit('progress', { done, total: todo.length })
    await pool(todo, 3, async (file) => {
      const text = await readFile(file.file, 'utf8').catch(() => null)
      const summary = text === null ? null : summarizeClaudeTranscript(text)
      if (summary && summary.messages > 0 && summary.cwd) found.push({ ...file, summary })
      else skipped++
      done++
      if (done % 10 === 0 || done === todo.length) this.emit('progress', { done, total: todo.length })
    })
    // What Nexa has already, with nothing new for it, has nothing to take over.
    const groups = planGroups(found, data.workspaces, this.projects.list(), isDirectory).filter(
      (g) => g.sessions > 0 || (g.kind === 'workspace' && !this.projects.sectionByPath(g.path)),
    )
    const preview: ImportPreview = {
      dir,
      accounts: data.accounts.map((a) => ({ name: a.name, provider: a.provider, kind: a.kind, color: a.color, action: this.accountAction(a) })),
      groups: groups.map(({ members: _members, ...group }) => group),
      known: newest.size - todo.length,
      skipped,
    }
    this.last = { data, groups, preview }
    return preview
  }

  async run(input: ImportInput): Promise<ImportResult> {
    const scan = this.last
    if (!scan) throw new Error('Erst die Daten des Claude Managers lesen.')
    const chosen = new Set(input.groups.map(folderKey))
    const groups = scan.groups.filter((g) => chosen.has(folderKey(g.path)) && g.exists)

    // Accounts first: the sessions name the account they go on with.
    const byFolder = new Map<string, string>()
    for (const account of this.accounts.list()) byFolder.set(folderKey(account.configDir), account.id)
    let accounts = 0
    for (const account of scan.data.accounts) {
      const key = folderKey(account.configDir)
      if (account.kind === 'system') {
        byFolder.set(key, systemAccountId(account.provider))
        continue
      }
      if (account.kind !== 'oauth' || byFolder.has(key) || !isDirectory(account.configDir)) continue
      try {
        const created = await this.accounts.create({ provider: account.provider, kind: 'oauth', name: account.name, color: account.color, configDir: account.configDir })
        byFolder.set(key, created.id)
        accounts++
      } catch (error) {
        console.warn('[import] account could not be taken over', error)
      }
    }

    const settings = this.settings()
    const meta = (session: FoundSession, project: Project): Omit<SessionMeta, 'id'> => {
      const { summary } = session
      const cwd = summary.cwd!
      const accountId = byFolder.get(folderKey(session.configDir))
      const { title, titleSource } = sessionTitle(summary, scan.data.names[session.id.toLowerCase()])
      return {
        projectId: project.id,
        title,
        titleSource,
        provider: 'claude',
        model: settings.claude.model,
        effort: settings.claude.effort,
        permissionMode: settings.defaults.permissionMode,
        createdAt: summary.createdAt ?? session.mtimeMs,
        updatedAt: summary.updatedAt ?? session.mtimeMs,
        ...(scan.data.pinned.has(session.id.toLowerCase()) ? { pinned: true } : {}),
        ...(summary.lastPrompt ? { preview: firstLine(summary.lastPrompt, 100) } : {}),
        cli: { claude: { sessionId: session.id, seenItems: 0, configDir: session.configDir, ...(accountId ? { accountId } : {}) } },
        ...(accountId ? { accounts: { claude: accountId } } : {}),
        ...(folderKey(cwd) !== folderKey(project.path) ? { cwd } : {}),
        importedFrom: session.file,
      }
    }

    const metas: Omit<SessionMeta, 'id'>[] = []
    const projectsBefore = this.projects.list().length
    const sectionsBefore = this.projects.sections().length
    const fresh: string[] = []
    // The workspaces in the Claude Manager's order, so their separators come in it.
    const rank = new Map(scan.data.workspaces.map((path, i) => [folderKey(path), i]))
    const rankOf = (g: PlacedGroup) => rank.get(folderKey(g.path)) ?? rank.size
    for (const group of [...groups].sort((a, b) => rankOf(a) - rankOf(b))) {
      // A workspace becomes a separator; a project Nexa has made one already goes on like one.
      let section = this.projects.sectionByPath(group.path)
      if (!section && group.kind === 'workspace') {
        const existing = this.projects.byPath(group.path)
        section = existing
          ? await projectToSection(this.projects, this.sessions, existing.id)
          : await this.projects.createSection({ name: group.name, path: group.path })
        fresh.push(section.id)
      }
      // The latest first: new projects come after those under the separator already, by their activity.
      const members = [...group.members].sort((a, b) => (b.summary.updatedAt ?? b.mtimeMs) - (a.summary.updatedAt ?? a.mtimeMs))
      for (const session of members) {
        const path = section ? projectFolder(session.summary.cwd!, group.path) : group.path
        const project = await this.projects
          .create({ path, sectionId: section?.id ?? DEFAULT_SECTION_ID }, { at: session.summary.updatedAt ?? session.mtimeMs, collapsed: true, end: true })
          .catch(() => null)
        // Its folder is gone: Claude Code couldn't go on there anyway.
        if (project) metas.push(meta(session, project))
      }
    }
    for (const id of fresh) await this.projects.gather(id)
    const sessions = this.sessions.adopt(metas)
    this.last = null
    return { sections: this.projects.sections().length - sectionsBefore, projects: this.projects.list().length - projectsBefore, sessions, accounts }
  }
}
