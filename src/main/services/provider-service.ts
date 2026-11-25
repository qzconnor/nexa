import { canLogin, type AccountLoginState, type LoginRenewResult } from '@shared/accounts'
import { PROVIDER_IDS, type ChatItem, type ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type {
  AppSettings,
  CommandOption,
  McpAuthStart,
  ModelDefaults,
  ModelOption,
  PluginInfo,
  ProviderStatus,
  ProviderUsage,
} from '@shared/types'
import { AccountLogins } from '../accounts/account-login'
import type { AccountService } from '../accounts/account-service'
import { LoginRenewal } from '../accounts/login-renewal'
import { TypedEmitter } from '../lib/typed-emitter'
import { ClaudeProvider } from '../providers/claude/claude-provider'
import { CodexProvider } from '../providers/codex/codex-provider'
import { GeminiProvider } from '../providers/gemini/gemini-provider'
import type { AccountContext, AgentProvider, CliSessionInfo, McpServerState, RunUsage } from '../providers/provider'
import { UsageSamples } from './usage-samples'

const USAGE_POLL_MS = 5 * 60_000

interface Events extends Record<string, unknown[]> {
  status: [ProviderStatus[]]
  usage: [ProviderUsage[]]
  login: [AccountLoginState]
}

/**
 * The agent CLIs Nexa knows: which are installed and logged in (checked at the start), their models,
 * the browser logins of their accounts and the usage of every account's plan limits.
 */
export class ProviderService extends TypedEmitter<Events> {
  readonly claude: ClaudeProvider
  readonly codex: CodexProvider
  readonly gemini: GeminiProvider
  private readonly providers: Record<ProviderId, AgentProvider>
  private readonly logins = new AccountLogins()
  private readonly renewal: LoginRenewal
  private statuses = new Map<ProviderId, ProviderStatus>()
  /** By account id. */
  private readonly usages = new Map<string, ProviderUsage>()
  private pollTimer: NodeJS.Timeout | null = null
  private detecting: Promise<ProviderStatus[]> | null = null

  constructor(
    private readonly settings: () => AppSettings,
    private readonly accounts: AccountService,
    /** The readings of the limit windows, for their forecast (none kept in tests). */
    private readonly samples = new UsageSamples(null),
  ) {
    super()
    this.claude = new ClaudeProvider(() => settings().claude)
    this.codex = new CodexProvider(() => settings().codex)
    this.codex.onUsage = (accountId, usage) => this.setUsage(accountId, usage)
    this.gemini = new GeminiProvider(() => settings().gemini)
    this.providers = { claude: this.claude, codex: this.codex, gemini: this.gemini }
    this.renewal = new LoginRenewal({ accounts, enabled: () => settings().chat.keepLoginsFresh })
    this.logins.on('state', (state) => this.onLogin(state))
    let known = new Set(accounts.list().map((a) => a.id))
    accounts.on('changed', (list) => {
      // What belonged to a removed account goes: its limits, its Codex server, a login that runs.
      const ids = new Set(list.map((a) => a.id))
      for (const id of known) {
        if (ids.has(id)) continue
        this.logins.cancel(id)
        for (const provider of Object.values(this.providers)) void provider.forget(id)
        this.samples.forget(id)
        if (this.usages.delete(id)) this.emit('usage', this.usage())
      }
      known = ids
    })
  }

  get(id: ProviderId): AgentProvider {
    return this.providers[id]
  }

  /** The account new chats of a CLI start with. */
  defaultAccount(id: ProviderId): string {
    return this.accounts.resolve(id, this.settings().defaults.accounts[id])
  }

  private context(accountId: string): AccountContext {
    return { ...this.accounts.env(accountId), accessToken: this.accounts.login(accountId).accessToken }
  }

  list(): ProviderStatus[] {
    return PROVIDER_IDS.map(
      (id) => this.statuses.get(id) ?? { id, name: PROVIDERS[id].name, installed: false, loggedIn: null, checkedAt: 0 },
    )
  }

  /** Looks for every CLI again: installed, version, login of the default account. */
  detect(): Promise<ProviderStatus[]> {
    this.detecting ??= Promise.all(
      PROVIDER_IDS.map(async (id) => {
        try {
          const status = await this.providers[id].detect(this.context(this.defaultAccount(id)))
          this.statuses.set(id, status)
        } catch (error) {
          this.statuses.set(id, {
            id,
            name: PROVIDERS[id].name,
            installed: false,
            loggedIn: null,
            error: error instanceof Error ? error.message : String(error),
            checkedAt: Date.now(),
          })
        }
        this.emit('status', this.list())
      }),
    )
      .then(() => this.list())
      .finally(() => (this.detecting = null))
    return this.detecting
  }

  isReady(id: ProviderId): boolean {
    const status = this.statuses.get(id)
    return !!status?.installed
  }

  models(id: ProviderId): Promise<ModelOption[]> {
    return this.providers[id].models(this.context(this.defaultAccount(id)))
  }

  /** An account of the CLI, or its default account when none (or an unknown one) is named. */
  private accountOf(id: ProviderId, account: string | undefined): string {
    return this.accounts.resolve(id, account, this.defaultAccount(id))
  }

  modelDefaults(id: ProviderId, account: string | undefined, model: string): Promise<ModelDefaults> {
    return this.providers[id].modelDefaults(this.context(this.accountOf(id, account)), model)
  }

  commands(id: ProviderId, account: string | undefined, cwd: string): Promise<CommandOption[]> {
    return this.providers[id].commands(this.context(this.accountOf(id, account)), cwd)
  }

  /** The MCP servers the CLI starts in a folder with this account (`accountId` resolved already). */
  mcpServers(id: ProviderId, accountId: string, cwd: string): Promise<McpServerState[]> {
    return this.providers[id].mcpServers(this.context(accountId), cwd)
  }

  reconnectMcp(id: ProviderId, accountId: string, cwd: string, name: string): Promise<void> {
    return this.providers[id].reconnectMcp(this.context(accountId), cwd, name)
  }

  authenticateMcp(id: ProviderId, accountId: string, cwd: string, name: string): Promise<McpAuthStart | null> {
    return this.providers[id].authenticateMcp(this.context(accountId), cwd, name)
  }

  /** The plugins the CLI has installed for a folder with this account (`accountId` resolved already). */
  plugins(id: ProviderId, accountId: string, cwd: string): Promise<PluginInfo[]> {
    return this.providers[id].plugins(this.context(accountId), cwd)
  }

  setPluginEnabled(id: ProviderId, accountId: string, cwd: string, pluginId: string, enabled: boolean): Promise<void> {
    return this.providers[id].setPluginEnabled(this.context(accountId), cwd, pluginId, enabled)
  }

  /** The CLI's conversations saved with an account, where its server lists them; null where it doesn't. */
  async sessions(id: ProviderId, accountId: string): Promise<CliSessionInfo[] | null> {
    const provider = this.providers[id]
    return provider.sessions ? provider.sessions(this.context(accountId)) : null
  }

  /** The chat of a conversation saved with an account, where the CLI's server gives it; null where it doesn't. */
  async history(id: ProviderId, accountId: string, sessionId: string, since?: number): Promise<ChatItem[] | null> {
    const provider = this.providers[id]
    return provider.history ? provider.history(this.context(accountId), sessionId, since) : null
  }

  /** Where else a conversation is open now, where the CLI can tell (see `AgentProvider.openElsewhere`). */
  async openElsewhere(id: ProviderId, accountId: string, sessionId: string, configDir: string): Promise<string | null> {
    const provider = this.providers[id]
    return provider.openElsewhere ? provider.openElsewhere(this.context(accountId), sessionId, configDir) : null
  }

  usage(): ProviderUsage[] {
    return [...this.usages.values()]
  }

  /**
   * New limits of an account, with the forecast of each window from its readings. A failed reading
   * keeps the windows known before, with its reason.
   */
  setUsage(accountId: string, usage: RunUsage): void {
    const previous = this.usages.get(accountId)
    const failed = !usage.windows.length && !!usage.message
    const next: ProviderUsage = failed && previous
      ? { ...previous, message: usage.message }
      : { ...usage, accountId, plan: usage.plan ?? previous?.plan, windows: this.samples.record(accountId, usage.updatedAt, usage.windows) }
    this.usages.set(accountId, next)
    this.emit('usage', this.usage())
  }

  /**
   * Reads the limits of every account that can tell without a session. `wake` (asked for by hand):
   * Codex accounts whose server isn't running are asked too.
   */
  async refreshUsage(wake = false): Promise<ProviderUsage[]> {
    await Promise.all(
      this.accounts.list().map(async (account) => {
        // A CLI switched off isn't asked: its limits don't concern the user, and the asking costs.
        if (!this.isReady(account.provider) || !this.settings()[account.provider].enabled || account.authState === 'missing') return
        try {
          // A resting Claude account's expired token first: its limits are asked for with the new one.
          await this.renewal.renewExpired(account)
          const usage = await this.providers[account.provider].usage(this.context(account.id), wake)
          if (usage) this.setUsage(account.id, usage)
        } catch (error) {
          console.warn('[usage] reading failed', error)
        }
      }),
    )
    return this.usage()
  }

  startPolling(): void {
    if (this.pollTimer) return
    this.pollTimer = setInterval(() => void this.refreshUsage(), USAGE_POLL_MS)
  }

  // Logins -------------------------------------------------------------------------------------

  loginStates(): AccountLoginState[] {
    return this.logins.list()
  }

  /** Starts the browser login of an account; the CLI opens the browser, the window follows the state. */
  login(accountId: string): AccountLoginState {
    const account = this.accounts.get(accountId)
    if (!canLogin(account.kind)) throw new Error('Dieser Account meldet sich mit Token oder API-Key an, nicht im Browser.')
    const command = this.providers[account.provider].loginCommand()
    return this.logins.start(account.provider, command, this.accounts.env(accountId))
  }

  loginCode(accountId: string, code: string): void {
    this.logins.sendCode(accountId, code)
  }

  cancelLogin(accountId: string): void {
    this.logins.cancel(accountId)
  }

  /** „Jetzt erneuern“ for a Claude browser login; with the new token its limits are read right away. */
  async renewLogin(accountId: string): Promise<LoginRenewResult> {
    const result = await this.renewal.renewNow(accountId)
    if (result === 'renewed') {
      void (async () => {
        const usage = await this.claude.usage(this.context(accountId))
        if (usage) this.setUsage(accountId, usage)
      })().catch(() => undefined)
    }
    return result
  }

  private onLogin(state: AccountLoginState): void {
    this.emit('login', state)
    if (state.status !== 'success') return
    // The CLI wrote the new login; everything that knew the old one looks again.
    const account = this.accounts.has(state.accountId) ? this.accounts.get(state.accountId) : null
    this.accounts.refresh()
    if (!account) return
    void (async () => {
      if (account.provider === 'codex') await this.codex.relogged(account.id)
      if (this.defaultAccount(account.provider) === account.id) await this.detect()
      const usage = await this.providers[account.provider].usage(this.context(account.id), true).catch(() => null)
      if (usage) this.setUsage(account.id, usage)
    })()
  }

  async dispose(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.logins.dispose()
    await this.samples.flush()
    await Promise.all(Object.values(this.providers).map((p) => p.dispose().catch(() => undefined)))
  }
}
