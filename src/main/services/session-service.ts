import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { systemAccountId } from '@shared/accounts'
import type { ChatItem, InteractionResponse, ProviderId, SessionEvent, SessionRuntime, ToolItem, UserItem } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type {
  AppSettings,
  CliLink,
  SendInput,
  SessionCreateInput,
  SessionDetail,
  SessionMeta,
  SessionUpdateInput,
  ToolSettings,
  UsageDay,
  UsageStats,
} from '@shared/types'
import { firstLine } from '@shared/utils'
import type { AccountService } from '../accounts/account-service'
import { copyClaudeSession, copyCodexThread } from '../accounts/session-transfer'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'
import { TypedEmitter } from '../lib/typed-emitter'
import type { NexaMcpServer } from '../mcp/mcp-server'
import { nexaToolsOn, type NexaToolGrant } from '../mcp/tool-grant'
import type { AgentRun, RunOptions, RunSink } from '../providers/provider'
import { handoffContext, sessionInstructions } from './instructions'
import type { ProjectService } from './project-service'
import type { ProviderService } from './provider-service'
import { TranscriptStore } from './transcript-store'

interface SessionState {
  meta: SessionMeta
  items: ChatItem[] | null
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
}

interface Events extends Record<string, unknown[]> {
  changed: [SessionMeta[]]
  event: [SessionEvent]
  /** A tool item of a run came or changed; `cwd`: the project's folder (for the file panel's activity). */
  tool: [sessionId: string, item: ToolItem, cwd: string]
  /** A run's turn ended: no shell command of it runs any more. */
  turnEnded: [sessionId: string]
}

const IDLE: SessionRuntime = { status: 'idle', connected: false }

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
    return { meta, items: null, index: new Map(), runtime: { ...IDLE }, run: null, runProvider: null, runAccount: null, generation: 0, starting: null, mcpToken: null }
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
      const items = await this.store.load(id)
      if (!s.items) {
        s.items = items
        s.index = new Map(items.map((item, i) => [item.id, i]))
      }
    }
    return s as SessionState & { items: ChatItem[] }
  }

  async create(input: SessionCreateInput): Promise<SessionMeta> {
    const project = this.projects.get(input.projectId)
    if (!project) throw new Error('Das Projekt gibt es nicht mehr.')
    const settings = this.settings()
    const chosen = input.account && this.accounts.has(input.account) ? this.accounts.get(input.account).provider : undefined
    const provider = input.provider ?? chosen ?? settings.defaults.provider
    const now = Date.now()
    const meta: SessionMeta = {
      id: randomUUID(),
      projectId: project.id,
      title: 'Neue Session',
      titleSource: 'auto',
      provider,
      model: input.model ?? settings[provider].model,
      effort: input.effort ?? settings[provider].effort,
      permissionMode: input.permissionMode ?? settings.defaults.permissionMode,
      createdAt: now,
      updatedAt: now,
      cli: {},
      accounts: { [provider]: this.accounts.resolve(provider, input.account, this.providers.defaultAccount(provider)) },
    }
    const s = this.state(meta)
    s.items = []
    this.sessions.set(meta.id, s)
    this.saveSoon()
    return meta
  }

  /** The items of a session with the folder it works in, for what can be derived from its history. */
  async history(id: string): Promise<{ items: readonly ChatItem[]; cwd: string } | null> {
    if (!this.sessions.has(id)) return null
    const s = await this.loaded(id)
    const project = this.projects.get(s.meta.projectId)
    return project ? { items: s.items, cwd: project.path } : null
  }

  async open(id: string): Promise<SessionDetail> {
    const s = await this.loaded(id)
    return { meta: s.meta, items: s.items, runtime: s.runtime }
  }

  async send(id: string, input: SendInput): Promise<void> {
    const s = await this.loaded(id)
    const meta = s.meta
    const project = this.projects.get(meta.projectId)
    if (!project) throw new Error('Das Projekt der Session gibt es nicht mehr.')
    const provider = meta.provider
    if (!this.providers.isReady(provider)) throw new Error(`${PROVIDERS[provider].name} ist nicht installiert.`)
    const text = input.text.trim()
    if (!text && !input.images?.length) return

    const accountId = await this.useAccount(s, provider, project.path)
    // What this CLI hasn't seen of the chat yet (another CLI answered meanwhile).
    const link = meta.cli[provider]
    const unseen = s.items.slice(link?.seenItems ?? 0).filter((i) => i.provider !== provider || !link)
    const context = unseen.length && s.items.length ? handoffContext(unseen, provider) : null

    const user: UserItem = { kind: 'user', id: randomUUID(), ts: Date.now(), provider, text, images: input.images?.length ? input.images : undefined }
    this.put(s, user)
    if (meta.titleSource === 'auto' && s.items.filter((i) => i.kind === 'user').length === 1) meta.title = firstLine(text, 60) || 'Bild'
    meta.preview = firstLine(text, 100)
    meta.updatedAt = Date.now()
    this.saveSoon()
    void this.projects.touch(project.id)

    const run = await this.ensureRun(s, accountId)
    if (context) {
      this.put(s, { kind: 'notice', id: randomUUID(), ts: Date.now(), provider, level: 'info', text: `${PROVIDERS[provider].name} übernimmt die Session`, detail: 'Mit dem bisherigen Verlauf als Kontext' })
    }
    await run.send({ text: context ? `${context}\n\n${text}` : text, images: input.images })
  }

  /** The account a CLI answers this chat with: the chosen one, else the one its conversation lies with, else the default. */
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
    const accountId = this.accountFor(meta, provider)
    const account = this.accounts.get(accountId)
    if (account.kind !== 'system' && account.authState === 'missing') {
      throw new Error(`„${account.name}“ ist nicht angemeldet. Melde dich unter Einstellungen → Accounts an.`)
    }
    meta.accounts = { ...meta.accounts, [provider]: accountId }
    const link = meta.cli[provider]
    const from = link ? (link.accountId ?? systemAccountId(provider)) : null
    if (link && from !== accountId) {
      const moved = await this.transfer(provider, from!, accountId, link, cwd).catch((error) => {
        console.warn('[sessions] conversation could not be copied', error)
        return false
      })
      if (moved) link.accountId = accountId
      else delete meta.cli[provider]
      this.put(s, { kind: 'notice', id: randomUUID(), ts: Date.now(), provider, level: 'info', text: `Weiter mit Account „${account.name}“`, detail: moved ? undefined : 'Mit dem bisherigen Verlauf als Kontext' })
      this.saveSoon()
    }
    return accountId
  }

  /** Copies the CLI's conversation from one account's folder to another's. */
  private async transfer(provider: ProviderId, from: string, to: string, link: CliLink, cwd: string): Promise<boolean> {
    if (!this.accounts.has(from)) return false
    if (provider === 'claude') return copyClaudeSession(this.accounts.claudePaths(from), this.accounts.claudePaths(to), link.sessionId, cwd)
    const path = await copyCodexThread(this.accounts.codexPaths(from).sessionsDir, this.accounts.codexPaths(to).sessionsDir, link.sessionId, link.resumePath)
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
    const generation = ++s.generation
    const current = () => s.generation === generation
    const tools = settings.tools
    let mcp: RunOptions['mcp']
    if (nexaToolsOn(tools) && this.mcp.running) {
      // A token of its own for every run, Claude's and Codex's: it says whose browser the browser tools drive.
      if (s.mcpToken) this.mcp.revoke(s.mcpToken)
      s.mcpToken = this.mcp.grant({ sessionId: meta.id })
      mcp = { url: this.mcp.url, token: s.mcpToken, ...this.toolGrant(tools) }
    }
    const sink: RunSink = {
      item: (item) => {
        this.put(s, item)
        if (item.kind === 'tool') this.emit('tool', meta.id, item, project.path)
        if (item.kind === 'turn') {
          this.emit('turnEnded', meta.id)
          const link = meta.cli[provider]
          if (link) link.seenItems = s.items?.length ?? 0
          meta.updatedAt = Date.now()
          this.saveSoon()
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
        meta.cli[provider] = {
          sessionId,
          seenItems: same ? link.seenItems : (s.items?.length ?? 0),
          accountId,
          ...(same && link.resumePath ? { resumePath: link.resumePath } : {}),
        }
        this.saveSoon()
      },
      usage: (usage) => this.providers.setUsage(accountId, usage),
      exited: (error) => {
        if (!current()) return
        s.run = null
        s.runProvider = null
        s.runAccount = null
        this.setRuntime(s, { status: error ? 'error' : 'idle', connected: false, error })
      },
    }
    try {
      const run = await this.providers.get(provider).start(
        {
          sessionId: meta.id,
          cwd: project.path,
          model: meta.model || undefined,
          effort: meta.effort || undefined,
          permissionMode: meta.permissionMode,
          resumeId: meta.cli[provider]?.sessionId,
          resumePath: meta.cli[provider]?.resumePath,
          account: this.accounts.env(accountId),
          instructions: sessionInstructions({
            renderTools: !!mcp && tools.renderTools,
            browserTools: !!mcp && tools.browserTools,
            projectName: project.name,
          }),
          mcp,
          noChrome: !!mcp && tools.browserTools && tools.noClaudeInChrome,
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
      this.setRuntime(s, { status: 'error', connected: false, error: message })
      throw error
    }
  }

  async interrupt(id: string): Promise<void> {
    await this.get(id).run?.interrupt()
  }

  async respond(id: string, itemId: string, response: InteractionResponse): Promise<void> {
    const s = this.get(id)
    if (!s.run) throw new Error('Die Session läuft nicht mehr, die Frage ist verfallen.')
    await s.run.respond(itemId, response)
  }

  async update(id: string, patch: SessionUpdateInput): Promise<SessionMeta> {
    const s = this.get(id)
    const meta = s.meta
    if (patch.title !== undefined && patch.title.trim()) {
      meta.title = patch.title.trim()
      meta.titleSource = 'user'
    }
    if (patch.pinned !== undefined) meta.pinned = patch.pinned
    if (patch.archived !== undefined) meta.archived = patch.archived
    if (patch.projectId !== undefined && this.projects.get(patch.projectId)) meta.projectId = patch.projectId
    if (patch.account !== undefined && this.accounts.has(patch.account)) {
      const account = this.accounts.get(patch.account)
      if (meta.accounts?.[account.provider] !== account.id) {
        meta.accounts = { ...meta.accounts, [account.provider]: account.id }
        // The next prompt resumes the conversation with the new account (see useAccount).
        if (s.run && s.runProvider === account.provider) await this.stop(id)
      }
    }
    if (patch.provider !== undefined && patch.provider !== meta.provider) {
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
        this.setRuntime(s, { ...IDLE })
      }
    } else if (patch.model !== undefined || patch.effort !== undefined) {
      const effortChanged = patch.effort !== undefined && patch.effort !== meta.effort
      if (patch.model !== undefined) meta.model = patch.model
      if (patch.effort !== undefined) meta.effort = patch.effort
      if (s.run && s.runProvider === 'claude' && effortChanged) {
        // Claude Code takes the effort only at its start; the next prompt resumes with the new one.
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

  async stop(id: string): Promise<void> {
    const s = this.get(id)
    const run = s.run
    s.run = null
    s.runProvider = null
    s.runAccount = null
    s.generation++
    await run?.stop().catch(() => undefined)
    this.setRuntime(s, { ...IDLE })
  }

  async remove(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return
    await this.stop(id).catch(() => undefined)
    if (s.mcpToken) this.mcp.revoke(s.mcpToken)
    this.sessions.delete(id)
    await this.store.remove(id)
    this.saveSoon()
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

  async removeProject(projectId: string): Promise<void> {
    for (const s of [...this.sessions.values()]) if (s.meta.projectId === projectId) await this.remove(s.meta.id)
  }

  async dispose(): Promise<void> {
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
