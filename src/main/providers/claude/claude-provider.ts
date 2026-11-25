import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CommandOption, McpAuthStart, ModelDefaults, ModelOption, PluginInfo, ProviderSettings, ProviderStatus } from '@shared/types'
import { firstLine, isPlainObject } from '@shared/utils'
import { fetchClaudeUsage } from '../../accounts/claude-usage'
import { CliBinary, cliEnv, type ResolvedCommand } from '../cli-binary'
import { appResultOf, claudeServerKey, type McpAppToolResult, type McpToolUi } from '@shared/mcp-apps'
import { claudeMcpServers, claudeToolUis } from '../mcp-servers'
import { byPluginName, claudeAuthStart, claudeManifest, claudePlugins, claudePluginToggleError } from '../plugins'
import type { AccountContext, AgentProvider, AgentRun, McpServerState, RunOptions, RunSink, RunUsage } from '../provider'
import { ClaudeConfig } from './claude-config'
import { claudeCommands, claudeModels, openClaudeControl, probeClaude, type ClaudeControl } from './claude-probe'
import { CLAUDE_MCP_APPS_ENV, ClaudeRun } from './claude-run'

/** The MCP servers of a folder without a running chat are asked again after this. */
const MCP_TTL_MS = 60_000
/** How long the asking process gives the servers to connect before it asks for their state. */
const MCP_CONNECT_MS = 2500
/** An MCP server's sign-in may first look up the server's auth endpoints. */
const AUTH_ANSWER_MS = 30_000
/** How long a process waits for the browser's answer to a sign-in it started. */
const AUTH_WAIT_MS = 5 * 60_000
/** How long the process for the pages of chats that don't run stays without a page asking it something. */
const APP_CONTROL_IDLE_MS = 3 * 60_000

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

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
  readonly config: ClaudeConfig
  /** By account: a plan may offer other models. */
  private readonly modelCache = new Map<string, { models: ModelOption[]; at: number }>()
  private readonly modelsLoading = new Map<string, Promise<ModelOption[]>>()
  /** By account and folder. */
  private readonly commandCache = new Map<string, CachedCommands>()
  /** By account and model. */
  private readonly defaultsCache = new Map<string, { defaults: ModelDefaults; at: number }>()
  /** The usage API answered 429: not asked again for this account before then. */
  private readonly backoff = new Map<string, number>()
  /** By account and folder. */
  private readonly mcpCache = new Map<string, { servers: McpServerState[]; at: number }>()
  private readonly appControls = new Map<string, { control: Promise<ClaudeControl>; timer: ReturnType<typeof setTimeout> | undefined }>()

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
    // Servers changed in the settings: the lists Nexa keeps of them (and the prompts they bring) go.
    this.config = new ClaudeConfig(this.binary, (accountId) => {
      for (const cache of [this.mcpCache, this.commandCache]) {
        for (const key of cache.keys()) if (key.startsWith(`${accountId}\0`)) cache.delete(key)
      }
    })
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
    const models = claudeModels(answers?.[0]?.models)
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

  /**
   * The MCP servers Claude Code starts in a folder, from a short process of its own (no prompt, no
   * tokens) that waits a moment for them to connect. Kept a minute: each one starts the servers.
   */
  async mcpServers(account: AccountContext, cwd: string): Promise<McpServerState[]> {
    const key = `${account.accountId}\0${cwd}`
    const cached = this.mcpCache.get(key)
    if (cached && Date.now() - cached.at < MCP_TTL_MS) return cached.servers
    const answers = await probeClaude(this.binary, account, { cwd, delayMs: MCP_CONNECT_MS, requests: [{ subtype: 'mcp_status' }] })
    if (!answers) return cached?.servers ?? []
    const servers = claudeMcpServers(answers[1])
    this.mcpCache.set(key, { servers, at: Date.now() })
    return servers
  }

  /** Without a chat running there, each look starts the servers anew: the cached one goes. */
  async reconnectMcp(account: AccountContext, cwd: string): Promise<void> {
    this.mcpCache.delete(`${account.accountId}\0${cwd}`)
  }

  /**
   * Starts an MCP server's sign-in in a process of its own. A claude.ai connector signs in on claude.ai
   * and needs nothing more from it; for its own OAuth, Claude Code waits for the browser's redirect, so
   * the process stays until the server is connected or `AUTH_WAIT_MS` have passed.
   */
  async authenticateMcp(account: AccountContext, cwd: string, name: string): Promise<McpAuthStart | null> {
    const control = await openClaudeControl(this.binary, account, cwd)
    let start: McpAuthStart | null
    try {
      // The servers connect after `initialize`; the sign-in needs the server's config loaded.
      await new Promise((resolve) => setTimeout(resolve, MCP_CONNECT_MS))
      start = claudeAuthStart(await control.request({ subtype: 'mcp_authenticate', serverName: name }, AUTH_ANSWER_MS))
    } catch (error) {
      control.stop()
      throw error
    }
    this.mcpCache.delete(`${account.accountId}\0${cwd}`)
    if (!start?.waits) {
      control.stop()
      return start
    }
    void this.awaitSignIn(control, name).finally(() => {
      control.stop()
      this.mcpCache.delete(`${account.accountId}\0${cwd}`)
    })
    return start
  }

  async readMcpResource(account: AccountContext, cwd: string, server: string, uri: string): Promise<unknown> {
    return (await this.appControl(account, cwd)).request({ subtype: 'mcp_read_resource', serverName: server, uri })
  }

  async callMcpTool(account: AccountContext, cwd: string, server: string, tool: string, args: Record<string, unknown>): Promise<McpAppToolResult> {
    const control = await this.appControl(account, cwd)
    return appResultOf(await control.request({ subtype: 'mcp_call', tool: `mcp__${claudeServerKey(server)}__${tool}`, arguments: args, soft_error_result: true }))
  }

  async mcpToolUi(account: AccountContext, cwd: string, server: string, tool: string): Promise<McpToolUi | null> {
    const control = await this.appControl(account, cwd)
    return claudeToolUis(await control.request({ subtype: 'mcp_status' })).get(claudeServerKey(server))?.tools.get(tool) ?? null
  }

  /**
   * A Claude Code process for the pages of chats that don't run (MCP Apps), per account and folder:
   * it holds the servers' connections while a page is used, and ends after a while without one.
   */
  private async appControl(account: AccountContext, cwd: string): Promise<ClaudeControl> {
    const key = `${account.accountId}\0${cwd}`
    let entry = this.appControls.get(key)
    if (!entry) {
      const control = openClaudeControl(this.binary, account, cwd, CLAUDE_MCP_APPS_ENV).then(async (c) => {
        // The servers connect after `initialize`.
        await new Promise((resolve) => setTimeout(resolve, MCP_CONNECT_MS))
        return c
      })
      entry = { control, timer: undefined }
      this.appControls.set(key, entry)
    }
    const current = entry
    clearTimeout(current.timer)
    current.timer = setTimeout(() => {
      if (this.appControls.get(key) === current) this.appControls.delete(key)
      void current.control.then((c) => c.stop()).catch(() => undefined)
    }, APP_CONTROL_IDLE_MS)
    try {
      const control = await current.control
      if (control.alive) return control
    } catch (error) {
      if (this.appControls.get(key) === current) this.appControls.delete(key)
      throw error
    }
    // It ended meanwhile: a new one.
    if (this.appControls.get(key) === current) this.appControls.delete(key)
    clearTimeout(current.timer)
    return this.appControl(account, cwd)
  }

  private async awaitSignIn(control: ClaudeControl, name: string): Promise<void> {
    const until = Date.now() + AUTH_WAIT_MS
    while (control.alive && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const servers = claudeMcpServers(await control.request({ subtype: 'mcp_status' }).catch(() => null))
      if (servers.find((s) => s.name === name)?.status === 'connected') return
    }
  }

  /**
   * The plugins installed for a folder (`claude plugin list --json`, run there with the account), with
   * the description from each one's manifest.
   */
  async plugins(account: AccountContext, cwd: string): Promise<PluginInfo[]> {
    const result = await this.binary.output(['plugin', 'list', '--json'], { cwd, env: cliEnv(account.set, account.unset) })
    let raw: unknown
    try {
      raw = JSON.parse(result.stdout)
    } catch {
      throw new Error(firstLine(result.stderr) || 'Claude Code hat die Plugins nicht genannt.')
    }
    const plugins = await Promise.all(
      claudePlugins(raw, cwd).map(async ({ installPath, ...plugin }): Promise<PluginInfo> => {
        if (!installPath) return plugin
        const manifest = claudeManifest(await readJson(join(installPath, '.claude-plugin', 'plugin.json')))
        return { ...plugin, name: manifest.name ?? plugin.name, description: manifest.description, version: plugin.version ?? manifest.version }
      }),
    )
    return plugins.sort(byPluginName)
  }

  /**
   * Switches a plugin as `/plugin` does (`claude plugin enable|disable`): in the settings of the scope
   * it is installed in, also for Claude Code outside Nexa. The commands and servers it brings come and
   * go with it.
   */
  async setPluginEnabled(account: AccountContext, cwd: string, id: string, enabled: boolean): Promise<void> {
    const result = await this.binary.output(['plugin', enabled ? 'enable' : 'disable', id, '--json'], { cwd, env: cliEnv(account.set, account.unset) })
    const error = claudePluginToggleError(result.stdout)
    if (error) throw new Error(error === 'Claude Code hat nicht geantwortet.' && result.stderr.trim() ? firstLine(result.stderr) : error)
    for (const cache of [this.commandCache, this.mcpCache]) {
      for (const key of cache.keys()) if (key.startsWith(`${account.accountId}\0`)) cache.delete(key)
    }
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
    for (const cache of [this.commandCache, this.defaultsCache, this.mcpCache]) {
      for (const key of cache.keys()) if (key.startsWith(`${accountId}\0`)) cache.delete(key)
    }
  }

  async dispose(): Promise<void> {
    const entries = [...this.appControls.values()]
    this.appControls.clear()
    for (const entry of entries) clearTimeout(entry.timer)
    await Promise.allSettled(entries.map((entry) => entry.control.then((c) => c.stop())))
  }
}

function planName(type: string): string {
  const names: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' }
  return names[type.toLowerCase()] ?? type
}

