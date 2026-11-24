import { join, resolve } from 'node:path'
import type { ChatItem } from '@shared/chat'
import type { CommandOption, ConnectorSettings, McpAuthStart, ModelDefaults, ModelOption, PluginInfo, ProviderSettings, ProviderStatus, UsageWindow } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import { defaultCodexHome } from '../../accounts/cli-files'
import { CliBinary, type ResolvedCommand } from '../cli-binary'
import { codexMcpServers } from '../mcp-servers'
import { byPluginName, codexAuthStart, codexPlugins } from '../plugins'
import type { AccountContext, AgentProvider, AgentRun, CliSessionInfo, McpServerState, RunOptions, RunSink, RunUsage } from '../provider'
import { CodexClient, type CodexServerRequest } from './codex-client'
import { codexThreadItems } from './codex-items'
import { CodexRun } from './codex-run'

/** Pages of `thread/list` read at most: 5,000 threads, more than anyone keeps. */
const MAX_THREAD_PAGES = 50

type Json = Record<string, unknown>

function windowLabel(minutes: number | null | undefined): string {
  if (!minutes) return 'Limit'
  if (minutes === 300) return '5 Stunden'
  if (minutes === 10080) return 'Woche'
  if (minutes >= 40000 && minutes <= 45000) return 'Monat'
  if (minutes % 1440 === 0) return `${minutes / 1440} Tage`
  return minutes % 60 === 0 ? `${minutes / 60} Stunden` : `${minutes} min`
}

/** Codex's rate limit snapshot as Nexa's usage. */
export function usageOfSnapshot(snapshot: unknown, source: RunUsage['source']): RunUsage | null {
  if (!isPlainObject(snapshot)) return null
  const windows: UsageWindow[] = []
  for (const key of ['primary', 'secondary'] as const) {
    const w = snapshot[key]
    if (!isPlainObject(w) || typeof w.usedPercent !== 'number') continue
    const minutes = typeof w.windowDurationMins === 'number' ? w.windowDurationMins : undefined
    windows.push({
      key,
      label: windowLabel(minutes),
      usedPercent: w.usedPercent,
      resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : undefined,
      windowMinutes: minutes,
    })
  }
  return {
    provider: 'codex',
    windows,
    plan: typeof snapshot.planType === 'string' ? snapshot.planType : undefined,
    limited: snapshot.rateLimitReachedType != null || snapshot.spendControlReached === true,
    updatedAt: Date.now(),
    source,
  }
}

/** The app-server of one account (its CODEX_HOME), with the runs it serves. */
interface AccountServer {
  client: CodexClient
  runs: Set<CodexRun>
}

/**
 * Codex through its app-server. Every account has a server of its own, started with the account's
 * CODEX_HOME when it is first needed: a server only knows the login of its folder. Notifications
 * reach the runs by thread id.
 */
export class CodexProvider implements AgentProvider {
  readonly id = 'codex' as const
  readonly binary: CliBinary
  private readonly servers = new Map<string, AccountServer>()
  private readonly routes = new Map<string, CodexRun>()
  private modelCache: { models: ModelOption[]; at: number } | null = null
  /** By account and folder. */
  private readonly skillCache = new Map<string, { skills: CommandOption[]; at: number }>()
  /** Limits a server reported on its own, with the account they belong to. */
  onUsage: ((accountId: string, usage: RunUsage) => void) | null = null

  constructor(private readonly settings: () => ProviderSettings) {
    this.binary = new CliBinary(
      {
        names: { win32: ['codex.exe', 'codex.cmd'], posix: ['codex'] },
        installDirs: (home, isWin) => [
          ...(isWin && process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin')] : []),
          ...(isWin && process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []),
          join(home, '.local', 'bin'),
        ],
        notFound: 'Codex wurde nicht gefunden. Installiere es oder trage den Pfad unter Einstellungen → CLIs ein.',
      },
      () => this.settings().path,
    )
  }

  /** The server of an account, created (not started yet) when it has none. */
  private server(account: AccountEnv): AccountServer {
    const existing = this.servers.get(account.accountId)
    if (existing) return existing
    const runs = new Set<CodexRun>()
    const client: CodexClient = new CodexClient(
      this.binary,
      {
        notification: (method, params) => this.onNotification(account.accountId, method, params),
        request: (request) => this.onRequest(client, request),
        exited: (error) => {
          for (const run of runs) run.serverExited(error)
          for (const [threadId, run] of this.routes) if (runs.has(run)) this.routes.delete(threadId)
          runs.clear()
        },
      },
      () => this.settings().extraArgs,
      // Nexa's MCP token goes with each thread (codexMcpConfig), not with the server, which serves all of them.
      () => ({ ...account.set }),
      account.unset,
    )
    const server = { client, runs }
    this.servers.set(account.accountId, server)
    return server
  }

  async detect(account: AccountContext): Promise<ProviderStatus> {
    this.binary.invalidate()
    const path = this.binary.resolve()
    const base: ProviderStatus = { id: 'codex', name: 'Codex', installed: !!path, path: path ?? undefined, loggedIn: null, checkedAt: Date.now() }
    if (!path) return base
    const version = await this.binary.version()
    try {
      const response = await this.server(account).client.request('account/read', { refreshToken: false })
      const info = isPlainObject(response.account) ? response.account : null
      return {
        ...base,
        version: version ?? undefined,
        loggedIn: info !== null,
        account: info
          ? {
              email: typeof info.email === 'string' ? info.email : undefined,
              plan: typeof info.planType === 'string' ? info.planType : undefined,
              organization: typeof info.workspaceName === 'string' ? info.workspaceName : undefined,
              authMode: typeof info.type === 'string' ? info.type : undefined,
            }
          : undefined,
      }
    } catch (error) {
      return { ...base, version: version ?? undefined, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async models(account: AccountContext): Promise<ModelOption[]> {
    if (this.modelCache && Date.now() - this.modelCache.at < 30 * 60_000) return this.modelCache.models
    try {
      const response = await this.server(account).client.request('model/list', {})
      const data = Array.isArray(response.data) ? response.data.filter(isPlainObject) : []
      const models: ModelOption[] = data
        .filter((m) => m.hidden !== true && typeof m.id === 'string')
        .map((m) => ({
          id: m.id as string,
          label: typeof m.displayName === 'string' ? m.displayName : (m.id as string),
          description: typeof m.description === 'string' ? m.description : undefined,
          efforts: Array.isArray(m.supportedReasoningEfforts)
            ? m.supportedReasoningEfforts.filter(isPlainObject).map((e) => String(e.reasoningEffort))
            : undefined,
          defaultEffort: typeof m.defaultReasoningEffort === 'string' ? m.defaultReasoningEffort : undefined,
          isDefault: m.isDefault === true,
        }))
      if (models.length) this.modelCache = { models, at: Date.now() }
      return models
    } catch {
      return this.modelCache?.models ?? []
    }
  }

  /** Codex names each model's default effort in its list; Ultracode is Claude Code's. */
  async modelDefaults(account: AccountContext, model: string): Promise<ModelDefaults> {
    const models = await this.models(account)
    const found = models.find((m) => m.id === model) ?? (model ? undefined : models.find((m) => m.isDefault))
    return { effort: found?.defaultEffort }
  }

  /** The skills Codex finds for a folder (the user's, the repository's, its own), offered after `/` and `$`. */
  async commands(account: AccountContext, cwd: string): Promise<CommandOption[]> {
    const key = `${account.accountId}\0${cwd}`
    const cached = this.skillCache.get(key)
    if (cached && Date.now() - cached.at < 60_000) return cached.skills
    try {
      const response = await this.server(account).client.request('skills/list', { cwds: [cwd] })
      const entries = Array.isArray(response.data) ? response.data.filter(isPlainObject) : []
      const skills = entries
        .flatMap((entry) => (Array.isArray(entry.skills) ? entry.skills.filter(isPlainObject) : []))
        .filter((s) => s.enabled !== false && typeof s.name === 'string' && typeof s.path === 'string')
        .map((s): CommandOption => {
          const face = isPlainObject(s.interface) ? s.interface : {}
          const short = [face.shortDescription, s.shortDescription, s.description].find((d) => typeof d === 'string' && d)
          return { name: s.name as string, description: short as string | undefined, kind: 'skill', insert: `$${s.name as string}`, path: s.path as string }
        })
      this.skillCache.set(key, { skills, at: Date.now() })
      return skills
    } catch {
      return cached?.skills ?? []
    }
  }

  /** The MCP servers of the account's config, as its app-server runs them (the same for every folder). */
  async mcpServers(account: AccountContext): Promise<McpServerState[]> {
    return codexMcpServers(await this.server(account).client.request('mcpServerStatus/list', {}))
  }

  /** Codex reads its MCP servers' config again and connects them anew, for all threads of the account. */
  async reconnectMcp(account: AccountContext): Promise<void> {
    await this.server(account).client.request('config/mcpServer/reload', {})
  }

  /**
   * The app-server signs in to the server itself: it opens a local callback and takes the browser's
   * answer (`mcpServer/oauthLogin/completed`), after which the servers connect anew.
   */
  async authenticateMcp(account: AccountContext, _cwd: string, name: string): Promise<McpAuthStart | null> {
    return codexAuthStart(await this.server(account).client.request('mcpServer/oauth/login', { name }))
  }

  /** Codex keeps its MCP servers in the account's `config.toml`. */
  connectorSettings(account: AccountContext): ConnectorSettings {
    const home = account.set.CODEX_HOME ? resolve(account.set.CODEX_HOME) : defaultCodexHome()
    return { path: join(home, 'config.toml') }
  }

  /** The installed plugins, from the marketplaces of the account and of the folder's repository. */
  async plugins(account: AccountContext, cwd: string): Promise<PluginInfo[]> {
    return codexPlugins(await this.server(account).client.request('plugin/installed', { cwds: [cwd] })).sort(byPluginName)
  }

  /**
   * `[plugins."<id>"] enabled` in the account's `config.toml`, as Codex writes it when installing.
   * Merged into the table, so the plugin's other keys stay; threads take it at their next start.
   */
  async setPluginEnabled(account: AccountContext, _cwd: string, id: string, enabled: boolean): Promise<void> {
    await this.server(account).client.request('config/value/write', { keyPath: 'plugins', value: { [id]: { enabled } }, mergeStrategy: 'upsert' })
    for (const key of this.skillCache.keys()) if (key.startsWith(`${account.accountId}\0`)) this.skillCache.delete(key)
  }

  /** The default model of the account: Codex's own config may name one this plan can't use. */
  private async defaultModel(account: AccountEnv): Promise<string | undefined> {
    const models = await this.models({ ...account, accessToken: null })
    return (models.find((m) => m.isDefault) ?? models[0])?.id
  }

  async start(options: RunOptions, sink: RunSink): Promise<AgentRun> {
    const model = options.model || (await this.defaultModel(options.account))
    const server = this.server(options.account)
    const run = new CodexRun(
      server.client,
      { ...options, model },
      sink,
      {
        add: (threadId, r) => this.routes.set(threadId, r),
        remove: (r) => {
          for (const [threadId, routed] of this.routes) if (routed === r) this.routes.delete(threadId)
          server.runs.delete(r)
        },
      },
      () => this.commands({ ...options.account, accessToken: null }, options.cwd),
    )
    server.runs.add(run)
    try {
      await run.connect()
    } catch (error) {
      server.runs.delete(run)
      throw error
    }
    return run
  }

  /**
   * The threads saved in the account's folder that a person started (in the terminal, the IDE, the
   * desktop app, an app-server like Nexa), not those of subagents or `codex exec`.
   */
  async sessions(account: AccountContext): Promise<CliSessionInfo[]> {
    const client = this.server(account).client
    const found: CliSessionInfo[] = []
    let cursor: string | null = null
    for (let page = 0; page < MAX_THREAD_PAGES; page++) {
      const response: Record<string, unknown> = await client.request('thread/list', { limit: 100, cursor, sourceKinds: ['cli', 'vscode', 'appServer'] })
      for (const thread of Array.isArray(response.data) ? response.data.filter(isPlainObject) : []) {
        if (typeof thread.id !== 'string' || typeof thread.cwd !== 'string' || thread.ephemeral === true || thread.parentThreadId) continue
        const seconds = (v: unknown) => (typeof v === 'number' ? v * 1000 : null)
        found.push({
          id: thread.id,
          cwd: thread.cwd,
          title: typeof thread.name === 'string' && thread.name.trim() ? thread.name.trim() : null,
          firstPrompt: typeof thread.preview === 'string' && thread.preview.trim() ? thread.preview : null,
          createdAt: seconds(thread.createdAt),
          updatedAt: seconds(thread.updatedAt),
        })
      }
      cursor = typeof response.nextCursor === 'string' ? response.nextCursor : null
      if (!cursor) break
    }
    return found
  }

  /**
   * A thread's chat as Codex keeps it, with every turn. Codex reads it from the account's own records:
   * a rollout only copied into the folder (another account's thread) has none there.
   */
  async history(account: AccountContext, sessionId: string): Promise<ChatItem[]> {
    const response = await this.server(account).client.request('thread/read', { threadId: sessionId, includeTurns: true })
    return isPlainObject(response.thread) ? codexThreadItems(response.thread) : []
  }

  async usage(account: AccountContext, wake: boolean): Promise<RunUsage | null> {
    if (!this.binary.resolve()) return null
    if (!wake && !this.servers.get(account.accountId)?.client.alive) return null
    try {
      const response = await this.server(account).client.request('account/rateLimits/read', {})
      return usageOfSnapshot(response.rateLimits, 'api')
    } catch {
      return null
    }
  }

  loginCommand(): ResolvedCommand {
    return this.binary.command(['login'])
  }

  /** The server of a removed account ends, with what still runs on it. */
  async forget(accountId: string): Promise<void> {
    for (const key of this.skillCache.keys()) if (key.startsWith(`${accountId}\0`)) this.skillCache.delete(key)
    const server = this.servers.get(accountId)
    if (!server) return
    this.servers.delete(accountId)
    await server.client.stop()
  }

  /** After a new login in the account's folder: a server without runs starts again, so it uses it. */
  async relogged(accountId: string): Promise<void> {
    const server = this.servers.get(accountId)
    if (server && !server.runs.size) await this.forget(accountId)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.servers.values()].map((s) => s.client.stop()))
    this.servers.clear()
  }

  private onNotification(accountId: string, method: string, params: Json): void {
    if (method === 'account/rateLimits/updated') {
      const usage = usageOfSnapshot(params.rateLimits, 'session')
      if (usage) this.onUsage?.(accountId, usage)
      return
    }
    // A sign-in Nexa started is through: the server connects with the new login.
    if (method === 'mcpServer/oauthLogin/completed' && params.success === true) {
      void this.servers.get(accountId)?.client.request('config/mcpServer/reload', {}).catch(() => undefined)
      return
    }
    const threadId = typeof params.threadId === 'string' ? params.threadId : null
    if (!threadId) return
    this.routes.get(threadId)?.notification(method, params)
  }

  private onRequest(client: CodexClient, request: CodexServerRequest): void {
    const threadId = typeof request.params.threadId === 'string' ? request.params.threadId : null
    const run = threadId ? this.routes.get(threadId) : undefined
    if (run) run.request(request)
    else client.respondError(request.id, 'Kein Thread von Nexa.')
  }
}
