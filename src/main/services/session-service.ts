import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { systemAccountId } from '@shared/accounts'
import { artifactChatMap, artifactLinks, type ArtifactMentions } from '@shared/artifacts'
import { folderKey, inFolder } from '@shared/folders'
import {
  PROVIDER_IDS,
  type ChatItem,
  type ContextDetail,
  type InteractionRequest,
  type InteractionResponse,
  type ProviderId,
  type SessionEvent,
  type SessionRuntime,
  type ToolItem,
  type UserItem,
} from '@shared/chat'
import { chatMarkdown, lastAnswer, markdownFileName, turnAnswer } from '@shared/chat-markdown'
import { enabledProviders, PROVIDERS } from '@shared/providers'
import { redactSecrets } from '@shared/redact'
import { plainOutput } from '@shared/terminal'
import type {
  AppSettings,
  CliLink,
  ConnectorSettings,
  McpAuthStart,
  McpServerInfo,
  PluginInfo,
  Project,
  SendInput,
  SessionCreateInput,
  SessionDetail,
  SessionMeta,
  SessionMoveInput,
  SessionRemoveResult,
  SessionSearchHit,
  SessionStorage,
  SessionUpdateInput,
  ShellOutput,
  ToolSettings,
  UsageDay,
  UsageStats,
} from '@shared/types'
import { firstLine, searchTerms } from '@shared/utils'
import type { AccountService } from '../accounts/account-service'
import { claudePaths, codexPaths } from '../accounts/cli-files'
import { claudeSessionFiles, codexRollouts, codexThreadFiles, diskSize } from '../accounts/conversation-files'
import { relocateClaudeSession } from '../accounts/session-move'
import { copyClaudeSession, copyCodexThread, ensureClaudeSession, ensureCodexThread, findClaudeTranscript } from '../accounts/session-transfer'
import { readClaudeChat, readClaudeChatSince } from '../import/claude-sessions'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'
import { pool } from '../lib/pool'
import { TypedEmitter } from '../lib/typed-emitter'
import type { NexaMcpServer } from '../mcp/mcp-server'
import { nexaToolsOn, type NexaToolGrant } from '../mcp/tool-grant'
import { claudeOpenElsewhere } from '../providers/claude/claude-presence'
import { forkPoint } from '../providers/claude/claude-transcript'
import type { AgentRun, RunOptions, RunSink } from '../providers/provider'
import { folderPromptText } from './folder-prompts'
import { handoffContext, sessionInstructions, userShellContext } from './instructions'
import type { ProjectService } from './project-service'
import type { ProviderService } from './provider-service'
import { chatTexts, findInChat, type ChatText } from './session-search'
import { TranscriptStore } from './transcript-store'
import { shellLaunch, UserShells, type ShellLaunch } from './user-shells'

interface SessionState {
  meta: SessionMeta
  items: ChatItem[] | null
  /** While the chat is read (an imported one is built from Claude Code's transcript the first time). */
  loading: Promise<ChatItem[]> | null
  index: Map<string, number>
  runtime: SessionRuntime
  run: AgentRun | null
  runProvider: ProviderId | null
  /** The account the run was started with. */
  runAccount: string | null
  /** Counts the starts of a run: reports of an older run don't change the runtime any more. */
  generation: number
  starting: Promise<AgentRun> | null
  mcpToken: string | null
  /** The CLI takes a change only at its start (Codex's MCP servers): it ends after the turn that runs. */
  restartAfterTurn?: boolean
  /** Claude Code's transcript as last read for what came from outside (its mtime): unchanged, it isn't read again. */
  syncedMtime?: number
  /** While one look at the transcript runs, the next asks for the same. */
  syncing?: Promise<number>
  /** The last turns taken in from outside: their note, how many prompts it counts, their last item. */
  outside?: { noticeId: string; prompts: number; lastId: string }
}

interface Events extends Record<string, unknown[]> {
  changed: [SessionMeta[]]
  event: [SessionEvent]
  /** A tool item of a run came or changed; `cwd`: the project's folder (for the file panel's activity). */
  tool: [sessionId: string, item: ToolItem, cwd: string]
  /** A run's turn ended: no shell command of it runs any more. */
  turnEnded: [sessionId: string]
  /** A run needs the user: its turn ended, it asks something, or it stopped at a limit (notifications). */
  attention: [sessionId: string, attention: Attention]
}

/** Why a chat's run needs the user now; only from Nexa's own runs, never from what came from outside. */
export type Attention =
  | {
      kind: 'done'
      provider: ProviderId
      /** How long the agent worked on the turn (ms). */
      busyMs: number
      /** What it said last in the turn, if anything. */
      answer: string | null
      /** The turn failed with this. */
      error?: string
    }
  | { kind: 'limit'; provider: ProviderId; accountId: string; message: string | null }
  | { kind: 'input'; provider: ProviderId; request: InteractionRequest }

/** Where one deletion or size count looks for conversation files; Codex's folders are read once each. */
interface ConversationLookup {
  /** Also in Claude Code's other project folders (for deleting; sizes take the direct path only). */
  search: boolean
  codex(configDir: string): Promise<Map<string, string[]>>
}

function conversationLookup(search: boolean): ConversationLookup {
  const indexes = new Map<string, Promise<Map<string, string[]>>>()
  return {
    search,
    codex(configDir) {
      const key = folderKey(configDir)
      let index = indexes.get(key)
      if (!index) indexes.set(key, (index = codexRollouts(configDir)))
      return index
    },
  }
}

const IDLE: SessionRuntime = { status: 'idle', connected: false }
/** Chats a search returns at most; with more, another word narrows it down better than scrolling. */
const MAX_SEARCH_HITS = 200
/** The tool name of the commands the user runs with `!`: Nexa's, no CLI's. */
const USER_SHELL_TOOL = 'NexaShell'
/** Output of a `!` command the chat keeps: its end (a server logging for hours would fill the transcript). */
const MAX_USER_SHELL_OUTPUT = 100_000


/**
 * The sessions of all projects: their chat (kept by TranscriptStore), the run of the CLI that
 * answers, and moving a session between CLIs and accounts. A session's CLI starts with its first
 * prompt and resumes its own conversation afterwards; a CLI joining later gets what it missed as
 * context. Another account of the same CLI gets a copy of the conversation's files.
 */
export class SessionService extends TypedEmitter<Events> {
  private readonly file: string
  private readonly store: TranscriptStore
  private readonly sessions = new Map<string, SessionState>()
  /** The commands the user runs with `!` in the composer. */
  private readonly userShells = new UserShells()
  /** The prompts and answers of every chat for the search, by session, while `stamp` says the chat is unchanged. */
  private readonly searchCache = new Map<string, { stamp: string; texts: Promise<ChatText[]> }>()
  /** The artifacts each saved chat names, by session, while `stamp` says it is unchanged. */
  private readonly artifactCache = new Map<string, { stamp: string; mentions: Promise<ArtifactMentions> }>()
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    dataDir: string,
    private readonly projects: ProjectService,
    private readonly providers: ProviderService,
    private readonly accounts: AccountService,
    private readonly mcp: NexaMcpServer,
    private readonly settings: () => AppSettings,
    /** Which of Nexa's MCP tools a run uses without asking (mcp/nexa-tools.ts). */
    private readonly toolGrant: (tools: ToolSettings) => NexaToolGrant,
    /** Moves a file or folder into the recycle bin (Electron's shell, a fake in tests). */
    private readonly trash: (path: string) => Promise<void>,
  ) {
    super()
    this.file = join(dataDir, 'sessions.json')
    this.store = new TranscriptStore(dataDir)
    const saved = readJsonGuardedSync<{ sessions?: SessionMeta[] }>(this.file)
    for (const meta of Array.isArray(saved?.sessions) ? saved.sessions : []) {
      this.sessions.set(meta.id, this.state({ ...meta, cli: meta.cli ?? {} }))
    }
  }

  private state(meta: SessionMeta): SessionState {
    const runtime: SessionRuntime = { ...IDLE, ...(meta.context ? { context: meta.context } : {}) }
    return { meta, items: null, loading: null, index: new Map(), runtime, run: null, runProvider: null, runAccount: null, generation: 0, starting: null, mcpToken: null }
  }

  /** The runtime of a chat whose CLI is gone: at rest, with the context as last counted and where else it is open. */
  private atRest(s: SessionState, patch: Partial<SessionRuntime> = {}): SessionRuntime {
    const { context, openElsewhere } = s.runtime
    return { ...IDLE, ...(context ? { context } : {}), ...(openElsewhere ? { openElsewhere } : {}), ...patch }
  }

  /** The folder a session's agent works in: its own folder in the project, else the project's. */
  private cwdOf(meta: SessionMeta, project: Project): string {
    return meta.cwd ?? project.path
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()].map((s) => s.meta).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private get(id: string): SessionState {
    const s = this.sessions.get(id)
    if (!s) throw new Error('Die Session gibt es nicht mehr.')
    return s
  }

  private async loaded(id: string): Promise<SessionState & { items: ChatItem[] }> {
    const s = this.get(id)
    if (!s.items) {
      s.loading ??= this.read(s).finally(() => (s.loading = null))
      const items = await s.loading
      if (!s.items) {
        s.items = items
        s.index = new Map(items.map((item, i) => [item.id, i]))
      }
    }
    return s as SessionState & { items: ChatItem[] }
  }

  /** The saved chat; for a session taken over from a CLI, its history read once into one. */
  private async read(s: SessionState): Promise<ChatItem[]> {
    const items = await this.store.load(s.meta.id)
    const source = s.meta.importedFrom
    if (items.length || !source) return items
    const meta = s.meta
    // Imported sessions have the one CLI they came from.
    const provider: ProviderId = meta.cli.codex && !meta.cli.claude ? 'codex' : 'claude'
    const notice = (text: string, detail: string): ChatItem => ({ kind: 'notice', id: randomUUID(), ts: Date.now(), provider, level: 'warning', text, detail })
    let imported: ChatItem[]
    try {
      imported = provider === 'codex' ? await this.codexHistory(meta) : await readClaudeChat(source)
      // The CLI has seen all of it: the next prompt resumes its conversation without context.
      const link = meta.cli[provider]
      if (link) {
        link.seenItems = imported.length
        if (provider === 'claude') link.synced = Date.now()
      }
      if (!imported.length) imported = [notice('Den Verlauf dieser Session gab die CLI nicht heraus', 'Sie geht trotzdem dort weiter, wo sie aufgehört hat.')]
    } catch (error) {
      console.warn('[sessions] history could not be read', error)
      imported = [
        provider === 'codex'
          ? notice('Der Verlauf dieser Session ließ sich nicht lesen', error instanceof Error ? error.message : String(error))
          : notice('Der Verlauf dieser Session ist nicht mehr da', 'Claude Code hat sein Transkript gelöscht oder es liegt nicht mehr am alten Ort.'),
      ]
    }
    delete meta.importedFrom
    await this.store.rewrite(meta.id, imported)
    this.saveSoon()
    return imported
  }

  async create(input: SessionCreateInput): Promise<SessionMeta> {
    const project = this.projects.get(input.projectId)
    if (!project) throw new Error('Das Projekt gibt es nicht mehr.')
    const cwd = input.cwd ? await this.subfolder(project, input.cwd) : undefined
    const settings = this.settings()
    const chosen = input.account && this.accounts.has(input.account) ? this.accounts.get(input.account).provider : undefined
    const asked = input.provider ?? chosen
    if (asked) this.requireEnabled(asked)
    // The default may be off (settings edited by hand): then the first CLI that is on.
    const provider = asked ?? (settings[settings.defaults.provider].enabled ? settings.defaults.provider : (enabledProviders(settings)[0] ?? settings.defaults.provider))
    const now = Date.now()
    const meta: SessionMeta = {
      id: randomUUID(),
      projectId: project.id,
      title: 'Neue Session',
      titleSource: 'auto',
      provider,
      model: input.model ?? settings[provider].model,
      effort: input.effort ?? settings[provider].effort,
      ...(provider === 'claude' && typeof input.ultracode === 'boolean' ? { ultracode: input.ultracode } : {}),
      permissionMode: input.permissionMode ?? settings.defaults.permissionMode,
      createdAt: now,
      updatedAt: now,
      cli: {},
      accounts: { [provider]: this.accounts.resolve(provider, input.account, this.providers.defaultAccount(provider)) },
      ...(cwd ? { cwd } : {}),
    }
    const s = this.state(meta)
    s.items = []
    this.sessions.set(meta.id, s)
    this.saveSoon()
    return meta
  }

  /**
   * A new chat that goes on from where this one is now, while this one stays as it is (Claude Code's
   * `/branch`): its items and settings, and each CLI's conversation, which the new chat's next prompt
   * forks at the chat's last answer (`CliLink.fork`).
   */
  async fork(id: string): Promise<SessionMeta> {
    const s = await this.loaded(id)
    this.requireAtRest(s, 'abzweigen')
    // What was said in a terminal meanwhile belongs to what the new chat goes on from.
    await this.syncCli(id).catch((error) => console.warn('[sessions] transcript could not be compared', error))
    const from = s.meta
    const project = this.projects.get(from.projectId)
    if (!project) throw new Error('Das Projekt der Session gibt es nicht mehr.')
    const cli: SessionMeta['cli'] = {}
    for (const provider of Object.keys(from.cli) as ProviderId[]) {
      const link = from.cli[provider]!
      // A chat branched off and not yet used: the same point of the same conversation.
      const at = link.fork ? link.fork.at : await this.forkPointOf(s, provider, link, this.cwdOf(from, project)).catch(() => null)
      cli[provider] = { ...link, fork: at ? { at } : {} }
    }
    const now = Date.now()
    // The conversations from before a `/clear` stay the old chat's: deleting the new one leaves them.
    const { pinned: _pinned, archived: _archived, importedFrom: _imported, earlierCli: _earlier, ...rest } = from
    const meta: SessionMeta = {
      ...structuredClone(rest),
      id: randomUUID(),
      title: `${from.title} (Abzweig)`,
      createdAt: now,
      updatedAt: now,
      cli,
    }
    const items: ChatItem[] = [
      ...structuredClone(s.items),
      { kind: 'notice', id: randomUUID(), ts: now, provider: meta.provider, level: 'info', text: `Abgezweigt von „${from.title}“` },
    ]
    await this.store.rewrite(meta.id, items)
    const fork = this.state(meta)
    fork.items = items
    fork.index = new Map(items.map((item, i) => [item.id, i]))
    this.sessions.set(meta.id, fork)
    this.saveSoon()
    return meta
  }

  /**
   * Sends a prompt of the chat anew, changed: the chat goes on from before it, and what came after it
   * (answers, tools, later prompts) is gone. Each CLI branches its conversation off at its last answer
   * before the prompt, as `fork` does, into a new one at its next start; the old one stays the chat's
   * (`earlierCli`) and goes along when the chat is deleted. Files the agent changed stay as they are.
   */
  async edit(id: string, itemId: string, input: SendInput): Promise<void> {
    const s = await this.loaded(id)
    this.requireAtRest(s, 'bearbeiten')
    const meta = s.meta
    const project = this.projects.get(meta.projectId)
    if (!project) throw new Error('Das Projekt der Session gibt es nicht mehr.')
    const at = s.index.get(itemId)
    if (at === undefined || s.items[at]?.kind !== 'user') throw new Error('Diesen Prompt gibt es im Chat nicht mehr.')
    // Above a `/clear` no CLI knows the chat any more.
    if (at < (meta.contextFrom ?? 0)) throw new Error('Prompts über „Kontext geleert“ lassen sich nicht mehr bearbeiten.')
    if (!input.text.trim() && !input.images?.length) return
    // What would stop the prompt, before the chat loses anything.
    this.requireEnabled(meta.provider)
    if (!this.providers.isReady(meta.provider)) throw new Error(`${PROVIDERS[meta.provider].name} ist nicht installiert.`)
    this.requireSignedIn(meta, meta.provider)

    // Its process holds the conversation as it was.
    if (s.run) await this.stop(id)
    const before = s.items.slice(0, at)
    const cwd = this.cwdOf(meta, project)
    for (const provider of PROVIDER_IDS) {
      const link = meta.cli[provider]
      if (!link) continue
      const point = await this.editPoint(s, provider, link, before, cwd).catch(() => null)
      // One not forked yet is still the other chat's.
      if (!link.fork) meta.earlierCli = [...(meta.earlierCli ?? []), { [provider]: structuredClone(link) }]
      const { synced: _synced, ...kept } = link
      // Without an answer of the CLI before the prompt, it starts anew, with the chat as context.
      if (point) meta.cli[provider] = { ...kept, fork: { at: point.at }, seenItems: Math.min(link.seenItems, point.seen) }
      else delete meta.cli[provider]
    }
    for (const item of s.items.splice(at)) s.index.delete(item.id)
    s.outside = undefined
    delete meta.context
    await this.store.rewrite(id, s.items)
    this.emit('event', { type: 'truncated', sessionId: id, length: at })
    this.setRuntime(s, { ...IDLE })
    await this.send(id, input)
  }

  /**
   * Where a CLI's conversation goes on from when the chat goes on from `before`: Codex's last turn in
   * it, Claude Code's last answer in it; `seen`, how many of the chat's items the CLI knows then.
   */
  private async editPoint(s: SessionState, provider: ProviderId, link: CliLink, before: ChatItem[], cwd: string): Promise<{ at: string; seen: number } | null> {
    if (provider === 'codex') {
      const end = before.findLastIndex((i) => i.kind === 'turn' && i.provider === 'codex' && i.id.startsWith('turn:'))
      return end < 0 ? null : { at: before[end]!.id.slice('turn:'.length), seen: end + 1 }
    }
    // Its answers are `<message id>:<block>`, the message's id is in the transcript.
    const answer = before.findLastIndex((i) => i.kind === 'assistant' && i.provider === 'claude' && !i.parentId && i.id.includes(':'))
    if (answer < 0) return null
    const id = before[answer]!.id
    const paths = link.configDir ? claudePaths(link.configDir, true) : this.accounts.claudePaths(this.accountFor(s.meta, 'claude'))
    const transcript = await findClaudeTranscript(paths.projectsDir, link.sessionId, cwd)
    const at = transcript ? forkPoint(await readFile(transcript, 'utf8'), id.slice(0, id.lastIndexOf(':'))) : null
    if (!at) return null
    const end = before.findIndex((i, n) => n > answer && i.kind === 'turn')
    return { at, seen: end < 0 ? before.length : end + 1 }
  }

  /** Where a fork of the chat's conversation with a CLI ends: Claude Code's last answer, Codex's last turn. */
  private async forkPointOf(s: SessionState & { items: ChatItem[] }, provider: ProviderId, link: CliLink, cwd: string): Promise<string | null> {
    if (provider === 'codex') {
      const turn = s.items.findLast((i) => i.kind === 'turn' && i.provider === 'codex' && i.id.startsWith('turn:'))
      return turn ? turn.id.slice('turn:'.length) : null
    }
    const paths = link.configDir ? claudePaths(link.configDir, true) : this.accounts.claudePaths(this.accountFor(s.meta, 'claude'))
    const transcript = await findClaudeTranscript(paths.projectsDir, link.sessionId, cwd)
    return transcript ? forkPoint(await readFile(transcript, 'utf8')) : null
  }

  /** A folder in the project for a chat to work in; undefined for the project's own. */
  private async subfolder(project: Project, path: string): Promise<string | undefined> {
    const folder = resolve(path)
    if (!inFolder(folder, project.path)) throw new Error(`„${folder}“ liegt nicht im Projekt „${project.name}“.`)
    const isDirectory = await stat(folder).then(
      (st) => st.isDirectory(),
      () => false,
    )
    if (!isDirectory) throw new Error(`Den Ordner „${folder}“ gibt es nicht.`)
    return folderKey(folder) === folderKey(project.path) ? undefined : folder
  }

  /**
   * Sessions taken over from elsewhere (the Claude Manager), with the CLI's conversation each continues;
   * their chats are read from it when they are opened first. Those whose conversation Nexa knows already are left out.
   */
  adopt(metas: readonly Omit<SessionMeta, 'id'>[]): number {
    const known = this.knownCliSessions()
    let added = 0
    for (const partial of metas) {
      const ids = Object.values(partial.cli).map((link) => link.sessionId)
      if (ids.some((id) => known.has(id)) || !this.projects.get(partial.projectId)) continue
      ids.forEach((id) => known.add(id))
      const meta: SessionMeta = { ...partial, id: randomUUID() }
      this.sessions.set(meta.id, this.state(meta))
      added++
    }
    if (added) this.saveSoon()
    return added
  }

  /**
   * Moves chats to other projects, each keeping the folder it works in (`cwd`, absolute): the CLI goes
   * on where it was, only the sidebar shows it elsewhere.
   */
  relocate(moves: readonly { id: string; projectId: string; cwd: string }[]): void {
    let moved = 0
    for (const move of moves) {
      const s = this.sessions.get(move.id)
      const project = this.projects.get(move.projectId)
      if (!s || !project) continue
      s.meta.projectId = project.id
      if (folderKey(move.cwd) === folderKey(project.path)) delete s.meta.cwd
      else s.meta.cwd = move.cwd
      moved++
    }
    if (moved) this.saveSoon()
  }

  /**
   * Moves a chat to another project or folder: from its next prompt on, its agent works there with
   * its conversation, as after `/cd` in Claude Code. Claude Code resumes a session only from the
   * project folder of its working directory, so its transcript moves along; Codex gets the folder
   * with every `thread/resume`. A chat whose CLI is at work stays where it is.
   */
  async move(id: string, target: SessionMoveInput): Promise<SessionMeta> {
    const s = await this.loaded(id)
    const meta = s.meta
    // Before anything else: "another folder" may make a project.
    this.requireAtRest(s)
    const { project, cwd } = await this.moveTarget(target)
    const from = this.projects.get(meta.projectId)
    const before = from ? this.cwdOf(meta, from) : null
    const after = cwd ?? project.path
    const sameFolder = before !== null && folderKey(before) === folderKey(after)
    if (meta.projectId === project.id && sameFolder) return meta
    if (!sameFolder) {
      if (s.run) await this.stop(id)
      await this.moveClaudeSession(meta, before ?? after, after)
    }
    meta.projectId = project.id
    if (cwd) meta.cwd = cwd
    else delete meta.cwd
    if (!sameFolder) {
      this.put(s, { kind: 'notice', id: randomUUID(), ts: Date.now(), provider: meta.provider, level: 'info', text: `Verschoben nach „${project.name}“`, detail: after })
    }
    this.saveSoon()
    return meta
  }

  /** The project and the folder in it (undefined: its own) a chat moves to; a folder outside every project gets one. */
  private async moveTarget(target: SessionMoveInput): Promise<{ project: Project; cwd: string | undefined }> {
    if ('folder' in target) {
      const folder = resolve(target.folder)
      const project = this.projects.containing(folder) ?? (await this.projects.create({ path: folder }))
      return { project, cwd: await this.subfolder(project, folder) }
    }
    const project = this.projects.get(target.projectId)
    if (!project) throw new Error('Das Projekt gibt es nicht mehr.')
    return { project, cwd: target.cwd ? await this.subfolder(project, target.cwd) : undefined }
  }

  /** Whether the chat's CLI is at rest: no turn, question, shell or agent of it that still runs. */
  private requireAtRest(s: SessionState, action: 'verschieben' | 'abzweigen' | 'leeren' | 'bearbeiten' = 'verschieben'): void {
    const status = s.runtime.status
    if (status === 'running' || status === 'starting' || status === 'waiting') {
      throw new Error(`Der Chat arbeitet gerade. Sobald er fertig ist, lässt er sich ${action}.`)
    }
    // Only a CLI that still runs has them; after a restart a state left on "running" means nothing.
    const background = s.run?.alive && s.items?.some((i) => (i.kind === 'tool' && i.shell?.background && i.shell.status === 'running') || (i.kind === 'agent' && i.status === 'running'))
    if (background) throw new Error(`Im Hintergrund läuft noch eine Shell oder ein Agent des Chats. Sobald sie fertig sind, lässt er sich ${action}.`)
  }

  /** Claude Code's transcript of the chat into the project folder of `to`; without one there is nothing to move. */
  private async moveClaudeSession(meta: SessionMeta, from: string, to: string): Promise<void> {
    const link = meta.cli.claude
    if (!link) return
    if (link.fork) {
      // The transcript is still the other chat's, which stays where it is: Claude Code gets the chat as
      // context in the new folder instead.
      delete meta.cli.claude
      return
    }
    const paths = link.configDir ? claudePaths(link.configDir, true) : this.accounts.claudePaths(this.accountFor(meta, 'claude'))
    const transcript = await findClaudeTranscript(paths.projectsDir, link.sessionId, from)
    if (transcript && !(await relocateClaudeSession(paths.projectsDir, transcript, link.sessionId, to))) {
      console.warn('[sessions] a copy of the conversation lies in the new folder already, Claude Code resumes that one', meta.id)
    }
  }

  /** The CLI conversations Nexa's sessions continue, to tell which are taken over already. */
  knownCliSessions(): Set<string> {
    return new Set([...this.sessions.values()].flatMap((s) => Object.values(s.meta.cli).map((link) => link.sessionId)))
  }

  /** The items of a session with the folder it works in, for what can be derived from its history. */
  async history(id: string): Promise<{ items: readonly ChatItem[]; cwd: string } | null> {
    if (!this.sessions.has(id)) return null
    const s = await this.loaded(id)
    const project = this.projects.get(s.meta.projectId)
    return project ? { items: s.items, cwd: this.cwdOf(s.meta, project) } : null
  }

  /** The chat as a Markdown document, with the name its file gets (see `chatMarkdown`). */
  async markdown(id: string, branchOf: (cwd: string) => Promise<string | null>): Promise<{ markdown: string; fileName: string }> {
    const s = this.get(id)
    const meta = s.meta
    // One not opened isn't loaded into the session for this: it may stay out of memory.
    const items = s.items ?? (await this.savedItems(s))
    const project = this.projects.get(meta.projectId)
    const cwd = project ? this.cwdOf(meta, project) : undefined
    const cli = Object.fromEntries(Object.entries(meta.cli).map(([provider, link]) => [provider, link.sessionId]))
    const info = {
      title: meta.title,
      cwd,
      branch: cwd ? await branchOf(cwd).catch(() => null) : null,
      model: meta.model || undefined,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      cli,
    }
    return { markdown: chatMarkdown(info, items), fileName: markdownFileName(meta.title) }
  }

  /** What the agent said last in the chat's main thread; null when it hasn't said anything yet. */
  async lastAnswer(id: string): Promise<string | null> {
    const s = this.get(id)
    return lastAnswer(s.items ?? (await this.savedItems(s)))
  }

  /**
   * Has the chat's CLI compact its conversation now (Codex `thread/compact/start`; Claude Code takes
   * `/compact` as a prompt). Not while it works, and not before it has a conversation.
   */
  async compact(id: string): Promise<void> {
    const s = await this.loaded(id)
    const meta = s.meta
    const project = this.projects.get(meta.projectId)
    if (!project) throw new Error('Das Projekt der Session gibt es nicht mehr.')
    const provider = meta.provider
    if (!meta.cli[provider]) throw new Error(`${PROVIDERS[provider].name} hat in diesem Chat noch nichts, was sich zusammenfassen ließe.`)
    const status = s.runtime.status
    if (s.run?.alive && (status === 'running' || status === 'waiting' || status === 'starting')) {
      throw new Error('Der Agent arbeitet gerade. Fasse den Kontext zusammen, wenn er fertig ist.')
    }
    this.requireEnabled(provider)
    const accountId = await this.useAccount(s, provider, this.cwdOf(meta, project))
    const run = await this.ensureRun(s, accountId)
    if (!run.compact) {
      await run.send({ id: randomUUID(), text: '/compact' })
      return
    }
    await run.compact()
  }

  /**
   * Empties the context and keeps the chat with its name, pin and place (Claude Code's `/clear`, which
   * starts a new conversation, here in the same chat): the next prompt starts a new conversation with
   * the CLI, and what was said so far stays readable above a notice but goes to no CLI any more. The
   * old conversations stay the chat's (`earlierCli`), to go along when it is deleted.
   */
  async clear(id: string): Promise<SessionMeta> {
    const s = await this.loaded(id)
    this.requireAtRest(s, 'leeren')
    const meta = s.meta
    // Cleared just now and nothing said since: a second notice would say nothing new.
    const said = s.items.slice(meta.contextFrom ?? 0).some((i) => i.kind === 'user' || i.kind === 'assistant')
    if (!said && !Object.keys(meta.cli).length) return meta
    // Its process holds the old conversation.
    await this.stop(id)
    if (Object.keys(meta.cli).length) meta.earlierCli = [...(meta.earlierCli ?? []), meta.cli]
    meta.cli = {}
    delete meta.context
    this.put(s, {
      kind: 'notice',
      id: randomUUID(),
      ts: Date.now(),
      provider: meta.provider,
      level: 'info',
      text: 'Kontext geleert',
      detail: 'Was darüber steht, kennt der Agent nicht mehr.',
      cleared: true,
    })
    meta.contextFrom = s.items.length
    meta.updatedAt = Date.now()
    // A new conversation has no context yet, and isn't open anywhere else.
    this.setRuntime(s, { ...IDLE })
    this.saveSoon()
    return meta
  }

  async open(id: string): Promise<SessionDetail> {
    const s = await this.loaded(id)
    // With what was written to it outside Nexa since the chat was last open.
    await this.syncCli(id).catch((error) => console.warn('[sessions] transcript could not be compared', error))
    return { meta: s.meta, items: s.items, runtime: s.runtime }
  }

  /**
   * Takes into the chat what Claude Code's conversation gained outside Nexa (`claude --resume` in a
   * terminal, Claude Desktop) since the chat last held it, finished turns only, and notes where else it
   * is open now. Nexa's own CLI of the chat, idle, holds the conversation as it was: it ends, and the
   * next prompt resumes with what came. The number of items added.
   */
  syncCli(id: string): Promise<number> {
    const s = this.get(id)
    s.syncing ??= this.readOutside(s).finally(() => (s.syncing = undefined))
    return s.syncing
  }

  private async readOutside(s: SessionState): Promise<number> {
    await this.loaded(s.meta.id)
    const meta = s.meta
    const link = meta.cli.claude
    const project = this.projects.get(meta.projectId)
    // A conversation not forked yet is the other chat's: what comes to it there isn't this chat's.
    if (!link || link.fork || !project || !s.items) return 0
    // Not into a turn at work, of either CLI: its items would come between the turn's.
    const busy = () => {
      const status = s.runtime.status
      return !!s.run?.alive && (status === 'running' || status === 'waiting' || status === 'starting')
    }
    const paths = link.configDir ? claudePaths(link.configDir, true) : this.accounts.claudePaths(this.accountFor(meta, 'claude'))
    const own = s.run?.alive && s.runProvider === 'claude' ? s.run.pid : undefined
    const elsewhere = (await claudeOpenElsewhere(paths.configDir, link.sessionId, own))?.where
    if (elsewhere !== s.runtime.openElsewhere) {
      const { openElsewhere: _, ...rest } = s.runtime
      this.setRuntime(s, elsewhere ? { ...rest, openElsewhere: elsewhere } : rest)
    }
    if (busy()) return 0

    const transcript = await findClaudeTranscript(paths.projectsDir, link.sessionId, this.cwdOf(meta, project))
    const info = transcript ? await stat(transcript).catch(() => null) : null
    // Sessions from before the mark: the chat's newest item, which came after what Claude Code wrote for it.
    const since = link.synced ?? s.items.reduce((max, item) => Math.max(max, item.ts), 0)
    if (!transcript || !info || !since || info.mtimeMs <= since || info.mtimeMs === s.syncedMtime) return 0
    s.syncedMtime = info.mtimeMs
    const added = await readClaudeChatSince(transcript, since, s.items)
    if (!added || busy()) return 0
    const fresh = added.items.filter((item) => !s.index.has(item.id))
    if (fresh.length && s.run?.alive && s.runProvider === 'claude') await this.stop(meta.id)
    if (fresh.length) {
      // Turn after turn from a terminal next to Nexa: one note over all of them, as long as nothing
      // came in Nexa between.
      const earlier = s.outside && s.items.at(-1)?.id === s.outside.lastId ? s.items[s.index.get(s.outside.noticeId) ?? -1] : undefined
      const prompts = (earlier ? s.outside!.prompts : 0) + fresh.filter((i) => i.kind === 'user').length
      const noticeId = earlier?.id ?? randomUUID()
      this.put(s, {
        kind: 'notice',
        id: noticeId,
        ts: earlier?.ts ?? fresh[0]!.ts,
        provider: 'claude',
        level: 'info',
        text: 'Außerhalb von Nexa weitergeführt',
        detail:
          prompts === 0
            ? 'Antworten aus Claude Code übernommen'
            : prompts === 1
              ? 'Ein Prompt mit Antwort aus Claude Code übernommen'
              : `${prompts} Prompts mit Antworten aus Claude Code übernommen`,
      })
      s.outside = { noticeId, prompts, lastId: fresh.at(-1)!.id }
    }
    for (const item of added.items) this.put(s, item)
    // seenItems stays: Claude Code's own items don't count as unseen anyway, and what Codex said
    // before them still has to reach it with the next prompt.
    link.synced = added.last
    const answer = fresh.findLast((i) => i.kind === 'assistant' && !i.parentId && i.text.trim())
    if (answer?.kind === 'assistant') meta.preview = firstLine(answer.text, 100)
    if (fresh.length) meta.updatedAt = Date.now()
    this.saveSoon()
    return fresh.length
  }

  /**
   * The chats whose prompts and answers hold every word of `query`, newest first. An empty query only
   * reads the chats ahead, so the first word typed into the quick open finds them at once.
   */
  async search(query: string): Promise<SessionSearchHit[]> {
    const terms = searchTerms(query)
    const states = [...this.sessions.values()].sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
    for (const id of this.searchCache.keys()) if (!this.sessions.has(id)) this.searchCache.delete(id)
    const hits: SessionSearchHit[] = []
    await pool(states, 4, async (s) => {
      try {
        const texts = await this.searchTexts(s)
        const hit = terms.length ? findInChat(texts, terms) : null
        if (hit) hits.push({ sessionId: s.meta.id, ...hit })
      } catch (error) {
        console.warn('[sessions] chat could not be searched', s.meta.id, error)
      }
    })
    const order = new Map(states.map((s, i) => [s.meta.id, i]))
    return hits.sort((a, b) => order.get(a.sessionId)! - order.get(b.sessionId)!).slice(0, MAX_SEARCH_HITS)
  }

  /** A chat's prompts and answers for the search: read once, again only after it changed. */
  private searchTexts(s: SessionState): Promise<ChatText[]> {
    const items = s.items
    const last = items?.at(-1)
    // An open chat grows while it runs; one that isn't open changes only through `updatedAt`.
    const stamp = items
      ? `open:${items.length}:${last?.kind === 'assistant' || last?.kind === 'user' ? last.text.length : 0}:${s.meta.updatedAt}`
      : `saved:${s.meta.updatedAt}`
    const cached = this.searchCache.get(s.meta.id)
    if (cached?.stamp === stamp) return cached.texts
    const texts = items ? Promise.resolve(chatTexts(items)) : this.savedItems(s).then(chatTexts)
    const entry = { stamp, texts }
    this.searchCache.set(s.meta.id, entry)
    // A failed read is tried again with the next search.
    texts.catch(() => this.searchCache.get(s.meta.id) === entry && this.searchCache.delete(s.meta.id))
    return texts
  }

  /** The chat each artifact came from, by the id in its link (see `artifactChatMap`). */
  async artifactChats(): Promise<Record<string, string>> {
    const states = [...this.sessions.values()].sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
    for (const id of this.artifactCache.keys()) if (!this.sessions.has(id)) this.artifactCache.delete(id)
    const none: ArtifactMentions = { published: [], named: [] }
    const found = new Map<string, ArtifactMentions>()
    await pool(states, 4, async (s) => {
      found.set(s.meta.id, await this.artifactsOf(s).catch(() => none))
    })
    return artifactChatMap(states.map((s) => ({ id: s.meta.id, mentions: found.get(s.meta.id) ?? none })))
  }

  /** The artifacts a chat links to: an open one as it is now, a saved one read once until it changes. */
  private artifactsOf(s: SessionState): Promise<ArtifactMentions> {
    if (s.items) return Promise.resolve(artifactLinks(s.items))
    const stamp = `saved:${s.meta.updatedAt}`
    const cached = this.artifactCache.get(s.meta.id)
    if (cached?.stamp === stamp) return cached.mentions
    const mentions = this.savedItems(s).then((items) => artifactLinks(items))
    const entry = { stamp, mentions }
    this.artifactCache.set(s.meta.id, entry)
    mentions.catch(() => this.artifactCache.get(s.meta.id) === entry && this.artifactCache.delete(s.meta.id))
    return mentions
  }

  /** A Codex thread's chat, read through the app-server of the account whose folder keeps it. */
  private async codexHistory(meta: SessionMeta): Promise<ChatItem[]> {
    const link = meta.cli.codex
    if (!link) return []
    const saved = link.accountId ?? systemAccountId('codex')
    const accountId = this.accounts.has(saved) ? saved : this.accountFor(meta, 'codex')
    return (await this.providers.history('codex', accountId, link.sessionId)) ?? []
  }

  /** The chat as saved, without loading it into the session; an imported one not opened yet from its CLI's history. */
  private async savedItems(s: SessionState): Promise<ChatItem[]> {
    // No rewrite of the file: the session may load and write to it meanwhile.
    const items = await this.store.load(s.meta.id, { compact: false })
    const source = s.meta.importedFrom
    if (items.length || !source) return items
    try {
      return s.meta.cli.codex && !s.meta.cli.claude ? await this.codexHistory(s.meta) : await readClaudeChat(source)
    } catch {
      return []
    }
  }

  async send(id: string, input: SendInput): Promise<void> {
    const s = await this.loaded(id)
    const meta = s.meta
    const project = this.projects.get(meta.projectId)
    if (!project) throw new Error('Das Projekt der Session gibt es nicht mehr.')
    const provider = meta.provider
    this.requireEnabled(provider)
    if (!this.providers.isReady(provider)) throw new Error(`${PROVIDERS[provider].name} ist nicht installiert.`)
    const text = input.text.trim()
    if (!text && !input.images?.length) return

    const accountId = await this.useAccount(s, provider, this.cwdOf(meta, project))
    // The commands the user ran with `!` since their last prompt go with this one, as in Claude Code's bash mode.
    const since = Math.max(meta.contextFrom ?? 0, s.items.findLastIndex((i) => i.kind === 'user') + 1)
    const shells = s.items.slice(since).filter((i): i is ToolItem => i.kind === 'tool' && !!i.byUser)
    const shellContext = userShellContext(shells)
    // What this CLI hasn't seen of the chat yet (another CLI answered meanwhile); nothing from before a `/clear`.
    const link = meta.cli[provider]
    const unseen = s.items
      .slice(Math.max(link?.seenItems ?? 0, meta.contextFrom ?? 0))
      .filter((i) => (i.provider !== provider || !link) && !shells.includes(i as ToolItem))
    const context = unseen.length && s.items.length ? handoffContext(unseen, provider) : null

    // Into a turn of the same CLI that still runs: it doesn't wait for the answer to end.
    const status = s.runtime.status
    const steer = !!s.run?.alive && s.runProvider === provider && (status === 'running' || status === 'waiting')
    const user: UserItem = {
      kind: 'user',
      id: randomUUID(),
      ts: Date.now(),
      provider,
      text,
      images: input.images?.length ? input.images : undefined,
      ...(steer ? { steer: true } : {}),
    }
    // Into the chat where the CLI takes it up (`taken`), as in the CLIs: until then it waits below.
    if (steer) this.setRuntime(s, { ...s.runtime, queued: [...(s.runtime.queued ?? []), user] })
    else this.put(s, user)
    // The first line stands until the model's title comes (autoTitle), or for good when that's off.
    // After a `/clear` the chat is about something new: its first prompt names it again, unless the user did.
    const first = meta.titleSource === 'auto' && s.items.slice(meta.contextFrom ?? 0).filter((i) => i.kind === 'user').length === 1
    if (first) meta.title = firstLine(text, 60) || 'Bild'
    meta.preview = firstLine(text, 100)
    meta.updatedAt = Date.now()
    this.saveSoon()
    void this.projects.touch(project.id)

    const run = await this.ensureRun(s, accountId)
    if (context) {
      this.put(s, { kind: 'notice', id: randomUUID(), ts: Date.now(), provider, level: 'info', text: `${PROVIDERS[provider].name} übernimmt die Session`, detail: 'Mit dem bisherigen Verlauf als Kontext' })
    }
    try {
      await run.send({ id: user.id, text: [context, shellContext, text].filter(Boolean).join('\n\n'), images: input.images })
    } catch (error) {
      // It never reached the CLI: it stays in the chat as written, as any prompt that failed.
      this.takeQueued(s, user.id)
      throw error
    }
    if (first && text && this.settings().chat.autoTitles) void this.autoTitle(s, run, text)
  }

  /**
   * The title the CLI gives the chat by its first prompt, in place of the prompt's first line; it
   * keeps it as the conversation's name too. Not when the chat was named meanwhile.
   */
  private async autoTitle(s: SessionState, run: AgentRun, prompt: string): Promise<void> {
    if (!run.title) return
    const placeholder = s.meta.title
    const title = await run.title(prompt).catch((error: unknown) => {
      console.warn('[sessions] no title from the model', error)
      return null
    })
    const meta = s.meta
    if (!title || meta.titleSource !== 'auto' || meta.title !== placeholder || this.sessions.get(meta.id) !== s) return
    meta.title = title
    this.saveSoon()
  }

  /** A prompt sent while the CLI worked joins the chat where the CLI took it up. */
  private takeQueued(s: SessionState, id: string): void {
    const queued = s.runtime.queued
    const user = queued?.find((u) => u.id === id)
    if (!user) return
    this.put(s, { ...user, ts: Date.now() })
    const rest = queued!.filter((u) => u !== user)
    const { queued: _, ...runtime } = s.runtime
    this.setRuntime(s, rest.length ? { ...runtime, queued: rest } : runtime)
  }

  /** Prompts the CLI never took up (it ended): into the chat as written, the user's words aren't lost. */
  private releaseQueued(s: SessionState): void {
    const queued = s.runtime.queued
    if (!queued?.length) return
    const { queued: _, ...runtime } = s.runtime
    s.runtime = runtime
    for (const user of queued) this.put(s, user)
  }

  /** The account a CLI answers this chat with: the chosen one, else the one its conversation lies with, else the default. */
  private requireEnabled(provider: ProviderId): void {
    if (!this.settings()[provider].enabled) throw new Error(`${PROVIDERS[provider].name} ist in den Einstellungen ausgeschaltet (Einstellungen › CLIs).`)
  }

  /** The account the chat's next prompt to a CLI goes with, if it is signed in. */
  private requireSignedIn(meta: SessionMeta, provider: ProviderId): string {
    const accountId = this.accountFor(meta, provider)
    const account = this.accounts.get(accountId)
    if (account.kind !== 'system' && account.authState === 'missing') {
      throw new Error(`„${account.name}“ ist nicht angemeldet. Melde dich unter Einstellungen → Accounts an.`)
    }
    return accountId
  }

  private accountFor(meta: SessionMeta, provider: ProviderId): string {
    const link = meta.cli[provider]
    const chosen = meta.accounts?.[provider] ?? (link ? (link.accountId ?? systemAccountId(provider)) : undefined)
    return this.accounts.resolve(provider, chosen, this.providers.defaultAccount(provider))
  }

  /**
   * Settles the account of the next prompt. A conversation that lies with another account is
   * copied to it first; when that isn't possible the CLI starts anew with the chat as context.
   */
  private async useAccount(s: SessionState, provider: ProviderId, cwd: string): Promise<string> {
    const meta = s.meta
    const accountId = this.requireSignedIn(meta, provider)
    meta.accounts = { ...meta.accounts, [provider]: accountId }
    const link = meta.cli[provider]
    const from = link ? (link.accountId ?? systemAccountId(provider)) : null
    if (link && from !== accountId) {
      const moved = await this.transfer(provider, from!, accountId, link, cwd).catch((error) => {
        console.warn('[sessions] conversation could not be copied', error)
        return false
      })
      if (moved) {
        link.accountId = accountId
        link.configDir = this.configDirOf(provider, accountId)
      } else delete meta.cli[provider]
      this.put(s, { kind: 'notice', id: randomUUID(), ts: Date.now(), provider, level: 'info', text: `Weiter mit Account „${this.accounts.get(accountId).name}“`, detail: moved ? undefined : 'Mit dem bisherigen Verlauf als Kontext' })
      this.saveSoon()
    }
    // Before the CLI starts with `--resume` (or `thread/resume`), it must find the conversation; when it
    // is gone, the chat goes on with its history as context instead of failing.
    const kept = meta.cli[provider]
    const running = s.run?.alive && s.runProvider === provider && s.runAccount === accountId
    if (kept && !running && !(await this.locate(provider, accountId, kept, cwd).catch(() => true))) {
      delete meta.cli[provider]
      this.put(s, { kind: 'notice', id: randomUUID(), ts: Date.now(), provider, level: 'info', text: `Unterhaltung von ${PROVIDERS[provider].name} nicht gefunden`, detail: 'Weiter mit dem bisherigen Verlauf als Kontext' })
      this.saveSoon()
    }
    return accountId
  }

  /** The config folder the account's CLI starts with: where it saves and looks for conversations. */
  private configDirOf(provider: ProviderId, accountId: string): string {
    return provider === 'claude' ? this.accounts.claudePaths(accountId).configDir : this.accounts.codexPaths(accountId).configDir
  }

  /** Whether the account's CLI finds the conversation of `link`, copied from the folder it was saved in if need be. */
  private async locate(provider: ProviderId, accountId: string, link: CliLink, cwd: string): Promise<boolean> {
    if (provider === 'claude') return ensureClaudeSession(this.accounts.claudePaths(accountId), link.configDir, link.sessionId, cwd)
    const { found, copiedTo } = await ensureCodexThread(this.accounts.codexPaths(accountId), link.configDir, link.sessionId, link.resumePath)
    if (copiedTo) link.resumePath = copiedTo
    return found
  }

  /** Copies the CLI's conversation from one account's folder (or the one it was saved in) to another's. */
  private async transfer(provider: ProviderId, from: string, to: string, link: CliLink, cwd: string): Promise<boolean> {
    if (!this.accounts.has(from) && !link.configDir) return false
    if (provider === 'claude') {
      const source = link.configDir ? claudePaths(link.configDir, true) : this.accounts.claudePaths(from)
      return copyClaudeSession(source, this.accounts.claudePaths(to), link.sessionId, cwd)
    }
    const source = link.configDir ? codexPaths(link.configDir).sessionsDir : this.accounts.codexPaths(from).sessionsDir
    const path = await copyCodexThread(source, this.accounts.codexPaths(to).sessionsDir, link.sessionId, link.resumePath)
    if (!path) return false
    link.resumePath = path
    return true
  }

  private async ensureRun(s: SessionState, accountId: string): Promise<AgentRun> {
    const provider = s.meta.provider
    if (s.run?.alive && s.runProvider === provider && s.runAccount === accountId) return s.run
    if (s.starting) return s.starting
    if (s.run) {
      const old = s.run
      s.run = null
      await old.stop().catch(() => undefined)
    }
    s.starting = this.startRun(s, provider, accountId).finally(() => (s.starting = null))
    return s.starting
  }

  private async startRun(s: SessionState, provider: ProviderId, accountId: string): Promise<AgentRun> {
    const meta = s.meta
    const project = this.projects.get(meta.projectId)
    if (!project) throw new Error('Das Projekt der Session gibt es nicht mehr.')
    const settings = this.settings()
    const cwd = this.cwdOf(meta, project)
    const generation = ++s.generation
    const current = () => s.generation === generation
    const tools = settings.tools
    const savedIn = this.configDirOf(provider, accountId)
    let mcp: RunOptions['mcp']
    if (nexaToolsOn(tools) && this.mcp.running) {
      // A token of its own for every run, Claude's and Codex's: it says whose browser the browser tools drive.
      if (s.mcpToken) this.mcp.revoke(s.mcpToken)
      s.mcpToken = this.mcp.grant({ sessionId: meta.id })
      mcp = { url: this.mcp.url, token: s.mcpToken, ...this.toolGrant(tools) }
    }
    const sink: RunSink = {
      item: (item) => {
        const fresh = !s.index.has(item.id)
        // Before the turn's own runtime report, which clears when it started.
        const busyMs = item.kind === 'turn' ? (item.durationMs ?? (s.runtime.turnStartedAt ? Date.now() - s.runtime.turnStartedAt : 0)) : 0
        this.put(s, item)
        if (item.kind === 'tool') this.emit('tool', meta.id, item, cwd)
        if (item.kind === 'interaction' && item.state === 'pending' && fresh && current()) {
          this.emit('attention', meta.id, { kind: 'input', provider, request: item.request })
        }
        if (item.kind === 'turn') {
          this.emit('turnEnded', meta.id)
          if (current() && item.status !== 'interrupted') {
            if (item.limit) this.emit('attention', meta.id, { kind: 'limit', provider, accountId, message: item.error ?? null })
            // Prompts wait: the CLI goes on with them right away, it isn't done.
            else if (!s.runtime.queued?.length) {
              this.emit('attention', meta.id, { kind: 'done', provider, busyMs, answer: turnAnswer(s.items ?? []), ...(item.error ? { error: item.error } : {}) })
            }
          }
          const link = meta.cli[provider]
          if (link) {
            link.seenItems = s.items?.length ?? 0
            // What Claude Code wrote to its transcript up to here is in the chat already.
            if (provider === 'claude') link.synced = Date.now()
          }
          meta.updatedAt = Date.now()
          this.saveSoon()
          // Not while prompts wait: the CLI starts on them right away, a restart would lose them.
          if (s.restartAfterTurn && current() && !s.runtime.queued?.length) {
            s.restartAfterTurn = false
            // After the turn's own reports: the next prompt resumes with what changed.
            setTimeout(() => void this.stop(meta.id).catch(() => undefined), 0)
          }
        } else if (item.kind === 'assistant' && !item.streaming && !item.parentId && item.text.trim()) {
          meta.preview = firstLine(item.text, 100)
        }
      },
      delta: (itemId, field, text) => this.delta(s, itemId, field, text),
      runtime: (patch) => {
        if (current()) this.setRuntime(s, { ...s.runtime, ...patch })
      },
      cliSession: (sessionId) => {
        const link = meta.cli[provider]
        const same = link?.sessionId === sessionId
        // The fork of another chat's conversation has seen what that one had seen.
        const forked = !!link?.fork && !same
        meta.cli[provider] = {
          sessionId,
          seenItems: same || forked ? link!.seenItems : (s.items?.length ?? 0),
          accountId,
          configDir: savedIn,
          ...(same && link.resumePath ? { resumePath: link.resumePath } : {}),
          ...(same && link.synced ? { synced: link.synced } : {}),
        }
        this.saveSoon()
      },
      usage: (usage) => this.providers.setUsage(accountId, usage),
      taken: (promptId) => {
        if (current()) this.takeQueued(s, promptId)
      },
      exited: (error) => {
        if (!current()) return
        // A turn cut off by the end of the process: what it wrote is Nexa's own, not from outside.
        const status = s.runtime.status
        const link = meta.cli[provider]
        if (provider === 'claude' && link && (status === 'running' || status === 'waiting' || status === 'starting')) link.synced = Date.now()
        s.run = null
        s.runProvider = null
        s.runAccount = null
        this.releaseQueued(s)
        this.setRuntime(s, this.atRest(s, { status: error ? 'error' : 'idle', error }))
      },
    }
    try {
      const run = await this.providers.get(provider).start(
        {
          sessionId: meta.id,
          cwd,
          model: meta.model || undefined,
          effort: meta.effort || undefined,
          ultracode: provider === 'claude' ? meta.ultracode : undefined,
          permissionMode: meta.permissionMode,
          resumeId: meta.cli[provider]?.sessionId,
          resumePath: meta.cli[provider]?.resumePath,
          fork: meta.cli[provider]?.fork,
          account: this.accounts.env(accountId),
          instructions: [
            sessionInstructions({
              renderTools: !!mcp && tools.renderTools,
              browserTools: !!mcp && tools.browserTools,
              projectName: project.name,
            }),
            // The user's own for the project and the separators around it (`prompts.md`).
            folderPromptText(await this.projects.promptsFor(project.id)),
          ]
            .filter(Boolean)
            .join('\n\n'),
          mcp,
          noChrome: !!mcp && tools.browserTools && tools.noClaudeInChrome,
          mcpOff: project.mcpOff?.[provider],
          dirs: meta.dirs,
          extraArgs: this.accounts.extraArgs(accountId),
        },
        sink,
      )
      s.run = run
      s.runProvider = provider
      s.runAccount = accountId
      return run
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.releaseQueued(s)
      this.setRuntime(s, { status: 'error', connected: false, error: message })
      throw error
    }
  }

  async interrupt(id: string): Promise<void> {
    await this.get(id).run?.interrupt()
  }

  /** The end of what a shell of the chat wrote, as its CLI still keeps it. */
  async shellOutput(id: string, itemId: string): Promise<ShellOutput> {
    const { run, taskId } = this.shellOf(id, itemId)
    if (!run?.shellOutput) throw new Error('Die Ausgabe ist nicht mehr abrufbar: Die CLI dieses Chats läuft nicht mehr.')
    return run.shellOutput(taskId)
  }

  async stopShell(id: string, itemId: string): Promise<void> {
    if (this.userShells.has(itemId)) return this.userShells.stop(itemId)
    const { run, taskId } = this.shellOf(id, itemId)
    if (!run?.stopShell) throw new Error('Die Shell lässt sich nicht beenden: Die CLI dieses Chats läuft nicht mehr.')
    await run.stopShell(taskId)
  }

  /**
   * Runs a command the user typed after `!`, in the chat's folder with the shell of the settings. Nexa
   * runs it, not the CLI: the chat keeps it with its secrets masked, and the next prompt hands it on.
   */
  async runShell(id: string, command: string): Promise<void> {
    const s = await this.loaded(id)
    const meta = s.meta
    const project = this.projects.get(meta.projectId)
    if (!project) throw new Error('Das Projekt der Session gibt es nicht mehr.')
    const typed = command.trim()
    if (!typed) return
    const shown = redactSecrets(typed)
    const item: ToolItem = {
      kind: 'tool',
      id: randomUUID(),
      ts: Date.now(),
      provider: meta.provider,
      parentId: null,
      tool: 'bash',
      name: USER_SHELL_TOOL,
      title: 'Shell',
      detail: shown.text,
      input: { command: shown.text },
      status: 'running',
      byUser: true,
      startedAt: Date.now(),
    }
    meta.updatedAt = Date.now()
    this.saveSoon()
    let launch: ShellLaunch
    try {
      launch = shellLaunch(this.settings().chat.shell, typed)
    } catch (error) {
      this.put(s, { ...item, status: 'error', output: error instanceof Error ? error.message : String(error), endedAt: Date.now() })
      return
    }
    item.title = launch.name
    this.put(s, item)

    // What the chat shows of the output: its end, secrets masked. Live only on screen; on disk once it ended.
    const view = (raw: string) => {
      const text = plainOutput(raw)
      if (text.length <= MAX_USER_SHELL_OUTPUT) return redactSecrets(text).text
      // Cut at a line's start: half a key at the cut wouldn't look like one any more.
      const from = text.length - MAX_USER_SHELL_OUTPUT
      return redactSecrets(`…\n${text.slice(text.indexOf('\n', from) + 1 || from)}`).text
    }
    let last = ''
    this.userShells.run(id, item.id, launch, this.cwdOf(meta, project), {
      output: (raw) => {
        last = raw
        const at = s.index.get(item.id)
        const current = at === undefined ? undefined : s.items?.[at]
        if (current?.kind !== 'tool' || current.status !== 'running' || this.sessions.get(id) !== s) return
        const live: ToolItem = { ...current, output: view(raw) }
        s.items![at!] = live
        this.emit('event', { type: 'item', sessionId: id, item: live })
      },
      exit: ({ code, stopped, error }) => {
        if (this.sessions.get(id) !== s) return
        this.put(s, {
          ...item,
          status: stopped ? 'denied' : code === 0 && !error ? 'done' : 'error',
          output: view(error ? [last.trimEnd(), error].filter(Boolean).join('\n') : last),
          exitCode: stopped ? undefined : code,
          endedAt: Date.now(),
        })
      },
    })
  }

  /**
   * The MCP servers of the chat's CLI, each on or off for its project: from the running CLI, else from
   * one asked for the folder.
   */
  async mcpServers(id: string): Promise<McpServerInfo[]> {
    const { provider, accountId, cwd, live, project } = this.cliTarget(id)
    const list = (live?.mcpServers ? await live.mcpServers().catch(() => null) : null) ?? (await this.providers.mcpServers(provider, accountId, cwd))
    const off = new Set(project.mcpOff?.[provider] ?? [])
    return list.map((server) => ({ ...server, enabled: !off.has(server.name) }))
  }

  /**
   * Switches an MCP server on or off for the chat's project: its chats that run take it at once where
   * the CLI can (Claude Code), the others with their next prompt (Codex starts the thread anew).
   */
  async setMcpEnabled(id: string, name: string, enabled: boolean): Promise<void> {
    const s = this.get(id)
    const provider = s.meta.provider
    const projectId = s.meta.projectId
    await this.projects.setMcpEnabled(projectId, provider, name, enabled)
    for (const other of this.sessions.values()) {
      const run = other.run
      if (other.meta.projectId !== projectId || other.runProvider !== provider || !run?.alive) continue
      if (await run.setMcpEnabled?.(name, enabled).catch(() => false)) continue
      await this.restartForChange(other)
    }
  }

  /** The CLI, account and folder a chat's connectors and plugins belong to, with its run if that is the CLI's. */
  private cliTarget(id: string): { provider: ProviderId; accountId: string; cwd: string; live: AgentRun | null; project: Project } {
    const s = this.get(id)
    const meta = s.meta
    const project = this.projects.get(meta.projectId)
    if (!project) throw new Error('Das Projekt der Session gibt es nicht mehr.')
    const provider = meta.provider
    return {
      provider,
      accountId: this.accountFor(meta, provider),
      cwd: this.cwdOf(meta, project),
      live: s.run?.alive && s.runProvider === provider ? s.run : null,
      project,
    }
  }

  /** Connects an MCP server anew: in the chat's running CLI, else the next look at the servers starts it anew. */
  async reconnectMcp(id: string, name: string): Promise<void> {
    const { provider, accountId, cwd, live } = this.cliTarget(id)
    if (live?.reconnectMcp) await live.reconnectMcp(name)
    else await this.providers.reconnectMcp(provider, accountId, cwd, name)
  }

  /** Starts an MCP server's sign-in, in the chat's running CLI if there is one; null when it needs none. */
  async authenticateMcp(id: string, name: string): Promise<McpAuthStart | null> {
    const { provider, accountId, cwd, live } = this.cliTarget(id)
    if (live?.authenticateMcp) return live.authenticateMcp(name)
    return this.providers.authenticateMcp(provider, accountId, cwd, name)
  }

  /** Where the connectors of the chat's CLI are set up. */
  connectorSettings(id: string): ConnectorSettings {
    const { provider, accountId } = this.cliTarget(id)
    return this.providers.connectorSettings(provider, accountId)
  }

  /** The plugins the chat's CLI has installed for its folder, each on or off. */
  async plugins(id: string): Promise<PluginInfo[]> {
    const { provider, accountId, cwd } = this.cliTarget(id)
    return this.providers.plugins(provider, accountId, cwd)
  }

  /**
   * Switches a plugin in the settings of the chat's CLI. Its running chats with the same account load
   * the plugins anew where the CLI can (Claude Code), the others with their next prompt.
   */
  async setPluginEnabled(id: string, pluginId: string, enabled: boolean): Promise<void> {
    const { provider, accountId, cwd } = this.cliTarget(id)
    await this.providers.setPluginEnabled(provider, accountId, cwd, pluginId, enabled)
    for (const other of this.sessions.values()) {
      const run = other.run
      if (other.runProvider !== provider || other.runAccount !== accountId || !run?.alive) continue
      if (await run.reloadPlugins?.().catch(() => false)) continue
      await this.restartForChange(other)
    }
  }

  /** A change the CLI takes only at its start: it ends now, or after the turn that runs; the next prompt resumes it. */
  private async restartForChange(s: SessionState): Promise<void> {
    const status = s.runtime.status
    if (status === 'running' || status === 'waiting' || status === 'starting') s.restartAfterTurn = true
    else await this.stop(s.meta.id)
  }

  /** What fills the chat's context, by kind, as its CLI counts it; null when it can't (not running, Codex). */
  async contextDetail(id: string): Promise<ContextDetail | null> {
    const run = this.get(id).run
    return (await run?.contextDetail?.()) ?? null
  }

  private shellOf(id: string, itemId: string): { run: AgentRun | null; taskId: string } {
    const s = this.get(id)
    const item = s.items?.[s.index.get(itemId) ?? -1]
    if (item?.kind !== 'tool' || !item.shell) throw new Error('Diese Shell gibt es in dem Chat nicht.')
    return { run: s.run, taskId: item.shell.taskId }
  }

  async respond(id: string, itemId: string, response: InteractionResponse): Promise<void> {
    const s = this.get(id)
    if (!s.run) throw new Error('Die Session läuft nicht mehr, die Frage ist verfallen.')
    await s.run.respond(itemId, response)
  }

  async update(id: string, patch: SessionUpdateInput): Promise<SessionMeta> {
    const s = this.get(id)
    const meta = s.meta
    const newDirs = Array.isArray(patch.dirs) ? [...new Set(patch.dirs.filter((d) => typeof d === 'string' && d.trim()).map((d) => resolve(d)))] : []
    // A folder typed after `/add-dir` may not be there, and the CLI wouldn't start with it: checked
    // before anything changes.
    for (const dir of newDirs) {
      if (meta.dirs?.includes(dir)) continue
      const info = await stat(dir).catch(() => null)
      if (!info?.isDirectory()) throw new Error(`Den Ordner „${dir}“ gibt es nicht.`)
    }
    if (patch.title !== undefined && patch.title.trim()) {
      meta.title = patch.title.trim()
      meta.titleSource = 'user'
    }
    if (patch.pinned !== undefined) meta.pinned = patch.pinned
    if (patch.archived !== undefined) meta.archived = patch.archived
    if (Array.isArray(patch.dirs)) {
      const dirs = newDirs
      if (dirs.join('\n') !== (meta.dirs ?? []).join('\n')) {
        if (dirs.length) meta.dirs = dirs
        else delete meta.dirs
        // The CLIs take their folders at the start: the next prompt resumes with them.
        if (s.run) await this.restartForChange(s)
      }
    }
    if (patch.account !== undefined && this.accounts.has(patch.account)) {
      const account = this.accounts.get(patch.account)
      if (meta.accounts?.[account.provider] !== account.id) {
        meta.accounts = { ...meta.accounts, [account.provider]: account.id }
        // The next prompt resumes the conversation with the new account (see useAccount).
        if (s.run && s.runProvider === account.provider) await this.stop(id)
      }
    }
    if (patch.provider !== undefined && patch.provider !== meta.provider) {
      this.requireEnabled(patch.provider)
      meta.provider = patch.provider
      const settings = this.settings()
      meta.model = patch.model ?? settings[patch.provider].model
      meta.effort = patch.effort ?? settings[patch.provider].effort
      if (s.run) {
        const old = s.run
        s.run = null
        s.runProvider = null
        s.runAccount = null
        s.generation++
        await old.stop().catch(() => undefined)
      }
      // The other CLI counts its own context: none until it has answered.
      delete meta.context
      this.releaseQueued(s)
      this.setRuntime(s, { ...IDLE })
    } else if (patch.model !== undefined || patch.effort !== undefined || typeof patch.ultracode === 'boolean') {
      const effortChanged = patch.effort !== undefined && patch.effort !== meta.effort
      const ultracodeChanged = typeof patch.ultracode === 'boolean' && patch.ultracode !== meta.ultracode
      if (patch.model !== undefined) meta.model = patch.model
      if (patch.effort !== undefined) meta.effort = patch.effort
      if (typeof patch.ultracode === 'boolean') meta.ultracode = patch.ultracode
      if (s.run && s.runProvider === 'claude' && (effortChanged || ultracodeChanged)) {
        // Claude Code takes the effort and Ultracode only at its start; the next prompt resumes with the new ones.
        await this.stop(id)
      } else {
        await s.run?.setModel(meta.model || undefined, meta.effort || undefined).catch(() => undefined)
      }
    }
    if (patch.permissionMode !== undefined && patch.permissionMode !== meta.permissionMode) {
      meta.permissionMode = patch.permissionMode
      await s.run?.setPermissionMode(patch.permissionMode).catch(() => undefined)
    }
    this.saveSoon()
    return meta
  }

  /**
   * The chats of an account that goes (merged into another with the same login) go on with `to`. Their
   * conversations stay where they were saved; the next prompt copies them over (see useAccount), and a
   * run that works now finishes its turn with the old folder.
   */
  reassignAccount(provider: ProviderId, from: string, to: string): number {
    let moved = 0
    for (const s of this.sessions.values()) {
      const meta = s.meta
      if ((meta.accounts?.[provider] ?? meta.cli[provider]?.accountId) !== from) continue
      meta.accounts = { ...meta.accounts, [provider]: to }
      moved++
    }
    if (moved) this.saveSoon()
    return moved
  }

  async stop(id: string): Promise<void> {
    const s = this.get(id)
    const run = s.run
    // Stopped in the middle of a turn: what it wrote to the transcript is Nexa's own (see `exited`).
    const link = s.meta.cli.claude
    const status = s.runtime.status
    if (run && s.runProvider === 'claude' && link && (status === 'running' || status === 'waiting' || status === 'starting')) link.synced = Date.now()
    s.run = null
    s.runProvider = null
    s.runAccount = null
    s.generation++
    await run?.stop().catch(() => undefined)
    this.releaseQueued(s)
    this.setRuntime(s, this.atRest(s))
  }

  /**
   * Deletes chats: their history in Nexa, and (setting `chat.deleteCliConversations`) their CLIs'
   * conversations into the recycle bin, in every account with a copy. A conversation stays that
   * another chat still goes on with (a fork that hasn't run yet), or that a CLI outside Nexa has open.
   */
  async remove(ids: readonly string[]): Promise<SessionRemoveResult> {
    const result: SessionRemoveResult = { removed: [], trashed: 0, bytes: 0, openElsewhere: [], failed: 0 }
    const targets = [...new Set(ids)].map((id) => this.sessions.get(id)).filter((s): s is SessionState => !!s)
    const going = new Set(targets.map((s) => s.meta.id))
    const shared = new Set<string>()
    for (const s of this.sessions.values()) {
      if (going.has(s.meta.id)) continue
      for (const provider of PROVIDER_IDS) {
        const link = s.meta.cli[provider]
        if (link) shared.add(`${provider}:${link.sessionId}`)
      }
    }
    const withCli = this.settings().chat.deleteCliConversations
    const lookup = conversationLookup(true)
    const handled = new Set<string>()
    for (const s of targets) {
      const id = s.meta.id
      // The CLI ends first (stop waits for its process): it would write its conversation again.
      await this.stop(id).catch(() => undefined)
      this.userShells.stopAll(id)
      let files: string[] = []
      if (withCli) {
        const found = await this.conversationFiles(s.meta, lookup, shared)
        if (found.openElsewhere) result.openElsewhere.push(id)
        files = found.files
      }
      if (s.mcpToken) this.mcp.revoke(s.mcpToken)
      this.sessions.delete(id)
      await this.store.remove(id)
      result.removed.push(id)
      for (const file of files) {
        // Two chats of one conversation (a fork that ran on with it) name the same files.
        if (handled.has(file)) continue
        handled.add(file)
        const size = await diskSize(file)
        try {
          await this.trash(file)
          result.trashed++
          result.bytes += size
        } catch (error) {
          result.failed++
          result.error ??= error instanceof Error ? error.message : String(error)
        }
      }
    }
    if (result.removed.length > 0) this.saveSoon()
    return result
  }

  /** What each chat takes on disk: its history in Nexa and what deleting it takes along of its CLIs. */
  async storage(): Promise<SessionStorage[]> {
    const withCli = this.settings().chat.deleteCliConversations
    const lookup = conversationLookup(false)
    const result: SessionStorage[] = []
    await pool([...this.sessions.values()], 8, async (s) => {
      let bytes = await this.store.size(s.meta.id)
      if (withCli) {
        const { files } = await this.conversationFiles(s.meta, lookup, new Set())
        for (const file of files) bytes += await diskSize(file)
      }
      result.push({ id: s.meta.id, bytes })
    })
    return result
  }

  /**
   * The files of a chat's CLI conversations, in the config folder of every account of the CLI (and the
   * one it was saved in). Not those of a fork that hasn't run yet (they are the other chat's), nor
   * those another chat goes on with (`shared`, `<provider>:<id>`), nor those of a Claude Code session
   * open outside Nexa (`openElsewhere`; it would write them again).
   */
  private async conversationFiles(
    meta: SessionMeta,
    lookup: ConversationLookup,
    shared: ReadonlySet<string>,
  ): Promise<{ files: string[]; openElsewhere: boolean }> {
    const cwd = meta.cwd ?? this.projects.get(meta.projectId)?.path ?? ''
    const files: string[] = []
    let openElsewhere = false
    // The conversations from before a `/clear` are the chat's too.
    const links = [meta.cli, ...(meta.earlierCli ?? [])].flatMap((cli) => PROVIDER_IDS.map((provider) => [provider, cli[provider]] as const))
    for (const [provider, link] of links) {
      if (!link || link.fork || shared.has(`${provider}:${link.sessionId}`)) continue
      for (const dir of this.conversationDirs(provider, link)) {
        if (provider === 'codex') {
          files.push(...codexThreadFiles(await lookup.codex(dir), link.sessionId))
          continue
        }
        const found = await claudeSessionFiles(dir, link.sessionId, cwd, lookup.search)
        if (found.length > 0 && lookup.search && (await claudeOpenElsewhere(dir, link.sessionId).catch(() => null))) {
          openElsewhere = true
          continue
        }
        files.push(...found)
      }
    }
    return { files: [...new Set(files)], openElsewhere }
  }

  /** The config folders that may hold a copy of a conversation, each once. */
  private conversationDirs(provider: ProviderId, link: CliLink): string[] {
    const dirs = [link.configDir, ...this.accounts.list().filter((a) => a.provider === provider).map((a) => this.configDirOf(provider, a.id))]
    const seen = new Set<string>()
    return dirs.filter((dir): dir is string => {
      if (!dir) return false
      const key = folderKey(dir)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  /** Turns of all chats per day, from their transcripts (sessions not opened aren't kept in memory). */
  async stats(days: number): Promise<UsageStats> {
    const key = (ms: number) => {
      const d = new Date(ms)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (days - 1))
    const since = start.getTime()
    const byDay = new Map<string, UsageDay>()
    for (let i = 0; i < days; i++) {
      const date = key(since + i * 86_400_000 + 3_600_000)
      byDay.set(date, { date, tokens: {}, costUsd: {}, turns: {} })
    }
    const totals: UsageStats['totals'] = {}
    for (const s of this.sessions.values()) {
      if (s.meta.updatedAt < since) continue
      const items = s.items ?? (await this.store.load(s.meta.id))
      for (const item of items) {
        if (item.kind !== 'turn' || item.ts < since) continue
        const day = byDay.get(key(item.ts))
        if (!day) continue
        const p = item.provider
        const tokens = (item.inputTokens ?? 0) + (item.outputTokens ?? 0)
        day.tokens[p] = (day.tokens[p] ?? 0) + tokens
        day.costUsd[p] = (day.costUsd[p] ?? 0) + (item.costUsd ?? 0)
        day.turns[p] = (day.turns[p] ?? 0) + 1
        const total = (totals[p] ??= { turns: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 })
        total.turns++
        total.inputTokens += item.inputTokens ?? 0
        total.outputTokens += item.outputTokens ?? 0
        total.costUsd += item.costUsd ?? 0
      }
    }
    return { days: [...byDay.values()], totals }
  }

  async removeProject(projectId: string): Promise<SessionRemoveResult> {
    return this.remove([...this.sessions.values()].filter((s) => s.meta.projectId === projectId).map((s) => s.meta.id))
  }

  async dispose(): Promise<void> {
    this.userShells.stopAll()
    await Promise.all([...this.sessions.values()].map((s) => s.run?.stop().catch(() => undefined)))
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      await this.save()
    }
  }

  // ------------------------------------------------------------------------------------------

  private put(s: SessionState, item: ChatItem): void {
    if (!s.items) s.items = []
    const at = s.index.get(item.id)
    if (at === undefined) {
      s.index.set(item.id, s.items.length)
      s.items.push(item)
    } else {
      s.items[at] = item
    }
    this.emit('event', { type: 'item', sessionId: s.meta.id, item })
    const streaming = (item.kind === 'assistant' || item.kind === 'thinking') && item.streaming
    if (!streaming) this.store.append(s.meta.id, item)
  }

  private delta(s: SessionState, itemId: string, field: 'text' | 'output', text: string): void {
    const at = s.index.get(itemId)
    if (at === undefined || !s.items) return
    const item = s.items[at]
    if (field === 'text' && (item.kind === 'assistant' || item.kind === 'thinking')) s.items[at] = { ...item, text: item.text + text }
    else if (field === 'output' && item.kind === 'tool') s.items[at] = { ...item, output: (item.output ?? '') + text }
    else return
    this.emit('event', { type: 'delta', sessionId: s.meta.id, itemId, field, text })
  }

  private setRuntime(s: SessionState, runtime: SessionRuntime): void {
    s.runtime = runtime
    // Saved with the next save of the session (a turn's end at the latest), not on every count.
    if (runtime.context) s.meta.context = runtime.context
    this.emit('event', { type: 'runtime', sessionId: s.meta.id, runtime })
  }

  private saveSoon(): void {
    this.emit('changed', this.list())
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, 400)
  }

  private save(): Promise<void> {
    return writeJsonAtomic(this.file, { version: 1, sessions: [...this.sessions.values()].map((s) => s.meta) }, { guarded: true }).catch((error) =>
      console.error('[sessions] save failed', error),
    )
  }
}
