import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CommandOption, ModelDefaults, ModelOption, ProviderSettings, ProviderStatus } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import { fetchClaudeUsage } from '../../accounts/claude-usage'
import { CliBinary, cliEnv, type ResolvedCommand } from '../cli-binary'
import type { AccountContext, AgentProvider, AgentRun, RunOptions, RunSink, RunUsage } from '../provider'
import { claudeCommands, probeClaude } from './claude-probe'
import { ClaudeRun } from './claude-run'

/** The commands of a folder are asked again after this; skills added meanwhile come then. */
const COMMANDS_TTL_MS = 5 * 60_000
/** How long the process that asked for them waits for the prompts of MCP servers. */
const COMMANDS_WATCH_MS = 20_000

interface CachedCommands {
  commands: CommandOption[]
  at: number
  loading?: Promise<CommandOption[]>
}

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
  /** By account and folder. */
  private readonly commandCache = new Map<string, CachedCommands>()
  /** By account and model. */
  private readonly defaultsCache = new Map<string, { defaults: ModelDefaults; at: number }>()
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

  private async loadModels(account: AccountContext): Promise<ModelOption[]> {
    const answers = await probeClaude(this.binary, account, { cwd: homedir() })
    const models = modelsOf(answers?.[0]?.models)
    if (models?.length) this.modelCache.set(account.accountId, { models, at: Date.now() })
    return models?.length ? models : (this.modelCache.get(account.accountId)?.models ?? FALLBACK_MODELS)
  }

  /**
   * The commands Claude Code offers in a folder: its own, the skills and commands of the user and the
   * project, the prompts of MCP servers. These come once the servers are connected: the process stays
   * a while for them, and the list asked for next has them.
   */
  async commands(account: AccountContext, cwd: string): Promise<CommandOption[]> {
    const key = `${account.accountId}\0${cwd}`
    const cached = this.commandCache.get(key)
    if (cached && Date.now() - cached.at < COMMANDS_TTL_MS) return cached.loading ?? cached.commands
    const entry: CachedCommands = { commands: cached?.commands ?? [], at: Date.now() }
    const keep = (raw: unknown) => {
      const commands = claudeCommands(raw)
      if (commands && this.commandCache.get(key) === entry) entry.commands = commands
    }
    entry.loading = probeClaude(this.binary, account, { cwd, watchMs: COMMANDS_WATCH_MS, onCommands: keep }).then((answers) => {
      entry.loading = undefined
      if (answers) keep(answers[0]?.commands)
      // Failed: asked again next time.
      else entry.at = 0
      return entry.commands
    })
    this.commandCache.set(key, entry)
    return entry.loading
  }

  /**
   * The effort a model runs with when Nexa names none, and whether Ultracode can run with it and is on,
   * as Claude Code's settings make it (`get_settings`). Its own process with the model, as it starts in
   * a chat: switching the model in a running process keeps the effort before.
   */
  async modelDefaults(account: AccountContext, model: string): Promise<ModelDefaults> {
    const key = `${account.accountId}\0${model}`
    const cached = this.defaultsCache.get(key)
    if (cached && Date.now() - cached.at < 30 * 60_000) return cached.defaults
    const answers = await probeClaude(this.binary, account, { cwd: homedir(), args: model ? ['--model', model] : [], requests: [{ subtype: 'get_settings' }] })
    const applied = isPlainObject(answers?.[1]?.applied) ? answers[1].applied : null
    if (!applied) return cached?.defaults ?? {}
    const defaults: ModelDefaults = {
      effort: typeof applied.effort === 'string' ? applied.effort : undefined,
      ultracode: { available: applied.ultracodeAvailable === true, on: applied.ultracode === true },
    }
    this.defaultsCache.set(key, { defaults, at: Date.now() })
    return defaults
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
    for (const cache of [this.commandCache, this.defaultsCache]) {
      for (const key of cache.keys()) if (key.startsWith(`${accountId}\0`)) cache.delete(key)
    }
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
