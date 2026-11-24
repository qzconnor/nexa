import { readFile } from 'node:fs/promises'
import type { Account } from '@shared/accounts'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { folderKey } from '@shared/folders'
import type { CliImportGroup, CliImportPreview, CliImportResult, ImportInput, ImportProgress } from '@shared/import-ipc'
import { PROVIDERS } from '@shared/providers'
import { DEFAULT_SECTION_ID } from '@shared/sections'
import type { AppSettings, SessionMeta } from '@shared/types'
import type { AccountService } from '../accounts/account-service'
import { pool } from '../lib/pool'
import { TypedEmitter } from '../lib/typed-emitter'
import { summarizeClaudeTranscript } from '../providers/claude/claude-transcript'
import type { ProjectService } from '../services/project-service'
import type { ProviderService } from '../services/provider-service'
import type { SessionService } from '../services/session-service'
import { listTranscripts } from './claude-sessions'
import { importedSessionMeta, isDirectory, planGroups, type CliSession, type PlacedGroup } from './import-plan'

/**
 * Takes over the sessions the CLIs saved in the folders of Nexa's accounts (from the terminal, an IDE,
 * their own apps): each becomes a chat in the project of its folder (one Nexa has, else a new one under
 * „Projekte“) that goes on with the CLI's conversation. Claude Code's are its transcripts, Codex's its
 * app-server lists; the CLIs' files are only read.
 */
export class CliSessionImport extends TypedEmitter<{ progress: [ImportProgress] }> {
  private last: PlacedGroup<CliSession>[] | null = null

  constructor(
    private readonly projects: ProjectService,
    private readonly sessions: SessionService,
    private readonly accounts: AccountService,
    private readonly providers: ProviderService,
    private readonly settings: () => AppSettings,
  ) {
    super()
  }

  /** The accounts of a CLI in use, one per config folder (two accounts may share one). */
  private accountsOf(provider: ProviderId): { account: Account; configDir: string }[] {
    if (!this.settings()[provider].enabled || !this.providers.isReady(provider)) return []
    const seen = new Set<string>()
    const found: { account: Account; configDir: string }[] = []
    for (const account of this.accounts.list()) {
      if (account.provider !== provider) continue
      const configDir = provider === 'claude' ? this.accounts.claudePaths(account.id).configDir : this.accounts.codexPaths(account.id).configDir
      const key = folderKey(configDir)
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ account, configDir })
    }
    return found
  }

  async scan(): Promise<CliImportPreview> {
    const known = this.sessions.knownCliSessions()
    const claude = this.accountsOf('claude')
    const codex = this.accountsOf('codex')
    const failed: string[] = []
    const label = (account: Account) => `${PROVIDERS[account.provider].name} (${account.name})`

    // Claude Code: the transcripts in every account's folder.
    const files = (
      await Promise.all(claude.map(({ account, configDir }) => listTranscripts(configDir).then((list) => list.map((file) => ({ ...file, accountId: account.id })))))
    ).flat()
    // A session copied to another account (when the account changed) counts once: where it went on last.
    const newest = new Map<string, (typeof files)[number]>()
    for (const file of files) {
      const seen = newest.get(file.id)
      if (!seen || file.mtimeMs > seen.mtimeMs) newest.set(file.id, file)
    }
    const todo = [...newest.values()].filter((file) => !known.has(file.id))
    let knownCount = newest.size - todo.length
    let skipped = 0
    const found: CliSession[] = []
    const total = todo.length + codex.length
    let done = 0
    const tick = () => {
      done++
      if (done % 10 === 0 || done === total) this.emit('progress', { done, total })
    }
    this.emit('progress', { done, total })
    await pool(todo, 3, async (file) => {
      const text = await readFile(file.file, 'utf8').catch(() => null)
      const summary = text === null ? null : summarizeClaudeTranscript(text)
      if (summary && summary.messages > 0 && summary.cwd) found.push({ provider: 'claude', ...file, summary })
      else skipped++
      tick()
    })

    // Codex: the threads its app-server lists for every account's folder.
    const threads = new Map<string, CliSession>()
    for (const { account, configDir } of codex) {
      try {
        for (const thread of (await this.providers.sessions('codex', account.id)) ?? []) {
          if (known.has(thread.id)) {
            knownCount++
            continue
          }
          const { id, cwd, title, firstPrompt, createdAt, updatedAt } = thread
          const session: CliSession = { provider: 'codex', id, configDir, accountId: account.id, mtimeMs: updatedAt ?? createdAt ?? 0, summary: { cwd, title, firstPrompt, lastPrompt: null, createdAt, updatedAt } }
          const seen = threads.get(id)
          if (!seen || session.mtimeMs > seen.mtimeMs) threads.set(id, session)
        }
      } catch (error) {
        failed.push(`${label(account)}: ${error instanceof Error ? error.message : String(error)}`)
      }
      tick()
    }
    found.push(...threads.values())

    const groups = planGroups(found, [], this.projects.list(), isDirectory).filter((g) => g.sessions > 0)
    this.last = groups
    return {
      groups: groups.map(({ members, ...group }): CliImportGroup => ({
        ...group,
        kind: group.kind === 'project' ? 'project' : 'folder',
        counts: Object.fromEntries(PROVIDER_IDS.map((p) => [p, members.filter((m) => m.provider === p).length])) as Record<ProviderId, number>,
      })),
      known: knownCount,
      skipped,
      failed,
    }
  }

  async run(input: ImportInput): Promise<CliImportResult> {
    const scanned = this.last
    if (!scanned) throw new Error('Erst die Sessions der CLIs lesen.')
    const chosen = new Set(input.groups.map(folderKey))
    const settings = this.settings()
    const projectsBefore = this.projects.list().length
    const metas: Omit<SessionMeta, 'id'>[] = []
    for (const group of scanned) {
      if (!chosen.has(folderKey(group.path)) || !group.exists) continue
      // Its folder is gone meanwhile: the CLI couldn't go on there anyway.
      const project = await this.projects
        .create({ path: group.path, sectionId: DEFAULT_SECTION_ID }, { at: group.updatedAt ?? undefined, collapsed: true, end: true })
        .catch(() => null)
      if (!project) continue
      for (const session of group.members) metas.push(importedSessionMeta(session, project, settings))
    }
    const sessions = this.sessions.adopt(metas)
    this.last = null
    return { projects: this.projects.list().length - projectsBefore, sessions }
  }
}
