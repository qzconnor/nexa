import { join } from 'node:path'
import type { ModelOption, ProviderSettings, ProviderStatus, UsageWindow } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import { CliBinary, type ResolvedCommand } from '../cli-binary'
import type { AccountContext, AgentProvider, AgentRun, RunOptions, RunSink, RunUsage } from '../provider'
import { CodexClient, type CodexServerRequest } from './codex-client'
import { CodexRun } from './codex-run'

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

  /** The default model of the account: Codex's own config may name one this plan can't use. */
  private async defaultModel(account: AccountEnv): Promise<string | undefined> {
    const models = await this.models({ ...account, accessToken: null })
    return (models.find((m) => m.isDefault) ?? models[0])?.id
  }

  async start(options: RunOptions, sink: RunSink): Promise<AgentRun> {
    const model = options.model || (await this.defaultModel(options.account))
    const server = this.server(options.account)
    const run = new CodexRun(server.client, { ...options, model }, sink, {
      add: (threadId, r) => this.routes.set(threadId, r),
      remove: (r) => {
        for (const [threadId, routed] of this.routes) if (routed === r) this.routes.delete(threadId)
        server.runs.delete(r)
      },
    })
    server.runs.add(run)
    try {
      await run.connect()
    } catch (error) {
      server.runs.delete(run)
      throw error
    }
    return run
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
