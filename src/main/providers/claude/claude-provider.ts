import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ModelOption, ProviderSettings, ProviderStatus } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import { fetchClaudeUsage } from '../../accounts/claude-usage'
import { CliBinary, cliEnv, type ResolvedCommand } from '../cli-binary'
import { JsonlProcess } from '../jsonl-process'
import type { AccountContext, AgentProvider, AgentRun, RunOptions, RunSink, RunUsage } from '../provider'
import { ClaudeRun } from './claude-run'

const FALLBACK_MODELS: ModelOption[] = [
  { id: '', label: 'Standard', description: 'Das Modell aus den Einstellungen von Claude Code', isDefault: true },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
]

export class ClaudeProvider implements AgentProvider {
  readonly id = 'claude' as const
  readonly binary: CliBinary
  /** By account: a plan may offer other models. */
  private readonly modelCache = new Map<string, { models: ModelOption[]; at: number }>()
  private readonly modelsLoading = new Map<string, Promise<ModelOption[]>>()
  /** The usage API answered 429: not asked again for this account before then. */
  private readonly backoff = new Map<string, number>()

  constructor(private readonly settings: () => ProviderSettings) {
    this.binary = new CliBinary(
      {
        names: { win32: ['claude.exe', 'claude.cmd'], posix: ['claude'] },
        installDirs: (home, isWin) => [
          join(home, '.local', 'bin'),
          join(home, '.claude', 'local'),
          ...(isWin && process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []),
        ],
        notFound: 'Claude Code wurde nicht gefunden. Installiere es oder trage den Pfad unter Einstellungen → Claude Code ein.',
      },
      () => this.settings().path,
    )
  }

  async detect(account: AccountContext): Promise<ProviderStatus> {
    this.binary.invalidate()
    const path = this.binary.resolve()
    const base: ProviderStatus = { id: 'claude', name: 'Claude Code', installed: !!path, path: path ?? undefined, loggedIn: null, checkedAt: Date.now() }
    if (!path) return base
    const [version, auth] = await Promise.all([this.binary.version(), this.binary.run(['auth', 'status', '--json'], 15_000, cliEnv(account.set, account.unset))])
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = auth ? (JSON.parse(auth) as Record<string, unknown>) : null
    } catch {
      parsed = null
    }
    return {
      ...base,
      version: version ?? undefined,
      loggedIn: parsed ? parsed.loggedIn === true : null,
      account: parsed
        ? {
            email: typeof parsed.email === 'string' ? parsed.email : undefined,
            organization: typeof parsed.orgName === 'string' ? parsed.orgName : undefined,
            plan: typeof parsed.subscriptionType === 'string' ? planName(parsed.subscriptionType) : undefined,
            authMode: typeof parsed.authMethod === 'string' ? parsed.authMethod : undefined,
          }
        : undefined,
    }
  }

  /**
   * The models Claude Code offers this account, from the answer to `initialize`: a short process that
   * gets no prompt, so it costs no tokens.
   */
  async models(account: AccountContext): Promise<ModelOption[]> {
    const cached = this.modelCache.get(account.accountId)
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.models
    let loading = this.modelsLoading.get(account.accountId)
    if (!loading) {
      loading = this.loadModels(account).finally(() => this.modelsLoading.delete(account.accountId))
      this.modelsLoading.set(account.accountId, loading)
    }
    return loading
  }

  private loadModels(account: AccountContext): Promise<ModelOption[]> {
    return new Promise((resolve) => {
      let proc: JsonlProcess
      const id = randomUUID()
      const done = (models: ModelOption[] | null) => {
        clearTimeout(timer)
        if (models?.length) this.modelCache.set(account.accountId, { models, at: Date.now() })
        resolve(models?.length ? models : (this.modelCache.get(account.accountId)?.models ?? FALLBACK_MODELS))
        if (proc?.alive) void proc.stop(1000)
      }
      const timer = setTimeout(() => done(null), 20_000)
      try {
        proc = new JsonlProcess(
          this.binary.command(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence']),
          {
            cwd: homedir(),
            env: cliEnv(account.set, account.unset),
            onMessage: (m) => {
              if (!isPlainObject(m) || m.type !== 'control_response' || !isPlainObject(m.response) || m.response.request_id !== id) return
              const response = isPlainObject(m.response.response) ? m.response.response : {}
              done(modelsOf(response.models))
            },
            onExit: () => done(null),
          },
        )
        proc.write({ type: 'control_request', request_id: id, request: { subtype: 'initialize' } })
      } catch {
        done(null)
      }
    })
  }

  async start(options: RunOptions, sink: RunSink): Promise<AgentRun> {
    return new ClaudeRun(this.binary, { ...options, extraArgs: [...this.settings().extraArgs, ...options.extraArgs] }, sink)
  }

  /**
   * The limits of a browser login from Anthropic's usage API. Setup tokens and API keys aren't
   * allowed to ask; their limits come with the next turn (`rate_limit_event`).
   */
  async usage(account: AccountContext): Promise<RunUsage | null> {
    if (!account.accessToken || (this.backoff.get(account.accountId) ?? 0) > Date.now()) return null
    const result = await fetchClaudeUsage(account.accessToken)
    if (!result.ok) {
      if (result.retryAfterMs) this.backoff.set(account.accountId, Date.now() + result.retryAfterMs)
      return { provider: 'claude', windows: [], updatedAt: Date.now(), source: 'api', message: result.message }
    }
    return { provider: 'claude', windows: result.windows, limited: result.limited, updatedAt: Date.now(), source: 'api' }
  }

  loginCommand(): ResolvedCommand {
    return this.binary.command(['auth', 'login'])
  }

  async forget(accountId: string): Promise<void> {
    this.modelCache.delete(accountId)
  }

  async dispose(): Promise<void> {}
}

function planName(type: string): string {
  const names: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' }
  return names[type.toLowerCase()] ?? type
}

function modelsOf(raw: unknown): ModelOption[] | null {
  if (!Array.isArray(raw)) return null
  const models: ModelOption[] = []
  for (const m of raw) {
    if (!isPlainObject(m) || typeof m.value !== 'string') continue
    models.push({
      id: m.value === 'default' ? '' : m.value,
      label: typeof m.displayName === 'string' ? m.displayName.replace(/\s*\(recommended\)/i, '') : m.value,
      description: typeof m.description === 'string' ? m.description : undefined,
      efforts: Array.isArray(m.supportedEffortLevels) ? m.supportedEffortLevels.filter((e): e is string => typeof e === 'string') : undefined,
      isDefault: m.value === 'default',
    })
  }
  return models
}
