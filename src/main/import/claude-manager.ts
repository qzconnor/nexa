import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { sameLogin, systemAccountId, type Account, type AccountIdentity, type AccountKind } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import { folderKey } from '@shared/folders'
import type { ClaudeManagerFound, ImportAccount, ImportInput, ImportPreview, ImportProgress, ImportResult } from '@shared/import-ipc'
import type { AppSettings, Project, SessionMeta } from '@shared/types'
import { DEFAULT_SECTION_ID } from '@shared/sections'
import { parseThemeFile } from '@shared/themes/file'
import { isPlainObject } from '@shared/utils'
import type { AccountService } from '../accounts/account-service'
import { defaultClaudeConfigDir, defaultCodexHome } from '../accounts/cli-files'
import { pool } from '../lib/pool'
import { TypedEmitter } from '../lib/typed-emitter'
import { summarizeClaudeTranscript, type TranscriptSummary } from '../providers/claude/claude-transcript'
import { readFolderPrompt, writeFolderPrompt } from '../services/folder-prompts'
import type { ProjectService } from '../services/project-service'
import { projectToSection } from '../services/project-sections'
import type { SessionService } from '../services/session-service'
import type { ThemeService } from '../services/theme-service'
import { listTranscripts, type TranscriptFile } from './claude-sessions'
import { planExtras, type CmTheme, type PlannedExtra } from './cm-extras'
import { importedSessionMeta, isDirectory, planGroups, projectFolder, sessionTitle, type PlacedGroup } from './import-plan'

/**
 * Takes over from the Claude Manager, which keeps no sessions of its own: it lists Claude Code's
 * transcripts in the config folders of its accounts and sorts them into its workspaces (folders whose
 * subfolders are projects). Nexa takes the workspaces as separators with their subfolders as projects
 * under them, other folders as projects under the default separator; the accounts with the same folders,
 * so their logins and conversations stay where they are; and every session as a chat that resumes Claude
 * Code's conversation. Besides, the workspaces' prompts, its own themes and the names and pins of
 * sessions (cm-extras.ts). The Claude Manager's files are only read.
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
  /** The workspaces' prompts (`cm_prompts.md` in their folders), those with text only. */
  prompts: { path: string; text: string }[]
  /** Its own themes, a JSON file each in `themes`. */
  themeFiles: string[]
}

/** Where the Claude Manager keeps a workspace's prompt, in its folder. */
export const CM_PROMPT_FILE = 'cm_prompts.md'

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
  const prompts = (
    await Promise.all(
      folders.map(async (path) => ({ path, text: (await readFile(join(path, CM_PROMPT_FILE), 'utf8').catch(() => '')).replace(/^﻿/, '').trim() })),
    )
  ).filter((p) => p.text)
  const themeDir = join(dir, 'themes')
  const themeFiles = (await readdir(themeDir).catch(() => [] as string[])).filter((name) => extname(name).toLowerCase() === '.json').map((name) => join(themeDir, name))
  return { dir, workspaces: folders, accounts: cmAccounts(accounts, dir), names: named, pinned, prompts, themeFiles }
}

/** The Claude Manager's themes that can be read, with their names. */
async function readCmThemes(files: readonly string[]): Promise<CmTheme[]> {
  const themes = await Promise.all(
    files.map(async (file) => {
      try {
        return { file, name: parseThemeFile(await readJson(file), basename(file, extname(file))).name }
      } catch {
        return null
      }
    }),
  )
  return themes.filter((t): t is CmTheme => t !== null)
}

/** A session found in an account's folder, with what its transcript says. */
export interface FoundSession extends TranscriptFile {
  summary: TranscriptSummary
}

interface Scan {
  data: CmData
  groups: PlacedGroup<FoundSession>[]
  extras: PlannedExtra[]
  preview: ImportPreview
}

/** A login an account brings: one of Nexa's (`id`), or one of the Claude Manager's this import adds. */
export interface KnownLogin {
  provider: ProviderId
  identity: AccountIdentity
  name: string
  id?: string
  added?: CmAccount
}

/** What becomes of a Claude Manager account (`ImportAccount.action`); `into`: the login it joins. */
export interface AccountPlan {
  account: CmAccount
  action: ImportAccount['action']
  into?: KnownLogin
}

/**
 * What account of Nexa each Claude Manager account becomes. A login Nexa has already in another
 * folder (or that an account before it in the list brings) isn't added twice: its sessions go on with
 * that account, which copies their conversations over when they go on. `identityAt`: who is signed in
 * in a folder.
 */
export function planAccounts(
  list: readonly CmAccount[],
  existing: readonly Pick<Account, 'id' | 'name' | 'provider' | 'kind' | 'configDir' | 'identity'>[],
  identityAt: (provider: ProviderId, configDir: string) => AccountIdentity,
): AccountPlan[] {
  const folders = new Set(existing.map((a) => folderKey(a.configDir)))
  const logins: KnownLogin[] = existing
    .filter((a) => a.kind !== 'system')
    .map((a) => ({ provider: a.provider, identity: a.identity, name: a.name, id: a.id }))
  return list.map((account): AccountPlan => {
    if (account.kind === 'system') return { account, action: 'standard' }
    if (account.kind !== 'oauth') return { account, action: 'skip' }
    const key = folderKey(account.configDir)
    if (folders.has(key)) return { account, action: 'exists' }
    const login = { provider: account.provider, identity: identityAt(account.provider, account.configDir) }
    const twin = logins.find((known) => sameLogin(known, login))
    if (twin) return { account, action: 'merge', into: twin }
    folders.add(key)
    logins.push({ ...login, name: account.name, added: account })
    return { account, action: 'create' }
  })
}

export class ClaudeManagerImport extends TypedEmitter<{ progress: [ImportProgress] }> {
  private last: Scan | null = null

  constructor(
    private readonly appData: string,
    private readonly projects: ProjectService,
    private readonly sessions: SessionService,
    private readonly accounts: AccountService,
    private readonly themes: Pick<ThemeService, 'list' | 'importFrom'>,
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

  private planAccounts(list: readonly CmAccount[]): AccountPlan[] {
    return planAccounts(list, this.accounts.list(), (provider, dir) => this.accounts.identityAt(provider, dir))
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
    const extras = planExtras({
      prompts: await Promise.all(data.prompts.map(async (p) => ({ ...p, current: await readFolderPrompt(p.path) }))),
      themes: await readCmThemes(data.themeFiles),
      nexaThemes: (await this.themes.list()).flatMap((entry) => (entry.theme ? [entry.theme.name] : [])),
      names: data.names,
      pinned: data.pinned,
      chats: this.sessions.list(),
    })
    const preview: ImportPreview = {
      dir,
      accounts: this.planAccounts(data.accounts).map(({ account: a, action, into }) => ({
        name: a.name,
        provider: a.provider,
        kind: a.kind,
        color: a.color,
        action,
        ...(into ? { into: into.name } : {}),
      })),
      groups: groups.map(({ members: _members, ...group }) => group),
      extras: extras.map((p) => p.extra),
      known: newest.size - todo.length,
      skipped,
    }
    this.last = { data, groups, extras, preview }
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
    const added = new Map<CmAccount, string>()
    for (const { account, action, into } of this.planAccounts(scan.data.accounts)) {
      const key = folderKey(account.configDir)
      if (action === 'standard') {
        byFolder.set(key, systemAccountId(account.provider))
      } else if (action === 'merge' && into) {
        // The same login in another folder: the sessions saved here go on with the account Nexa has.
        const id = into.id ?? (into.added && added.get(into.added))
        if (id) byFolder.set(key, id)
      } else if (action === 'create' && isDirectory(account.configDir)) {
        try {
          const created = await this.accounts.create({ provider: account.provider, kind: 'oauth', name: account.name, color: account.color, configDir: account.configDir })
          byFolder.set(key, created.id)
          added.set(account, created.id)
          accounts++
        } catch (error) {
          console.warn('[import] account could not be taken over', error)
        }
      }
    }

    const settings = this.settings()
    const meta = (session: FoundSession, project: Project): Omit<SessionMeta, 'id'> => {
      const key = session.id.toLowerCase()
      const accountId = byFolder.get(folderKey(session.configDir))
      return importedSessionMeta({ ...session, provider: 'claude', accountId }, project, settings, {
        ...sessionTitle(session.summary, scan.data.names[key]),
        ...(scan.data.pinned.has(key) ? { pinned: true } : {}),
      })
    }

    const metas: Omit<SessionMeta, 'id'>[] = []
    const projectsBefore = this.projects.list().length
    const sectionsBefore = this.projects.sections().length
    const fresh: string[] = []
    // The workspaces in the Claude Manager's order, so their separators come in it.
    const rank = new Map(scan.data.workspaces.map((path, i) => [folderKey(path), i]))
    const rankOf = (g: PlacedGroup<FoundSession>) => rank.get(folderKey(g.path)) ?? rank.size
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
    const extras = await this.takeExtras(scan.extras, new Set(input.extras ?? []))
    this.last = null
    return { sections: this.projects.sections().length - sectionsBefore, projects: this.projects.list().length - projectsBefore, sessions, accounts, ...extras }
  }

  /** The extras chosen; one that fails leaves the others be. */
  private async takeExtras(planned: readonly PlannedExtra[], chosen: ReadonlySet<string>): Promise<Pick<ImportResult, 'prompts' | 'themes' | 'names' | 'pins'>> {
    const done = { prompts: 0, themes: 0, names: 0, pins: 0 }
    /** How many of the chats changed; one deleted since the scan is left out. */
    const each = async <T,>(items: readonly T[], change: (item: T) => Promise<unknown>) => {
      let changed = 0
      for (const item of items) if (await change(item).then(() => true, () => false)) changed++
      return changed
    }
    for (const { extra, task } of planned) {
      if (!task || !chosen.has(extra.id)) continue
      try {
        if (task.kind === 'prompt') {
          // Not over a prompt written in Nexa since the scan.
          if ((await readFolderPrompt(task.path)).trim()) continue
          await writeFolderPrompt(task.path, task.text)
          done.prompts++
        } else if (task.kind === 'theme') {
          done.themes += (await this.themes.importFrom([task.file])).imported.length
        } else if (task.kind === 'names') {
          done.names += await each(task.renames, (r) => this.sessions.update(r.id, { title: r.title }))
        } else {
          done.pins += await each(task.ids, (id) => this.sessions.update(id, { pinned: true }))
        }
      } catch (error) {
        console.warn('[import] could not be taken over', extra.id, error)
      }
    }
    return done
  }
}
