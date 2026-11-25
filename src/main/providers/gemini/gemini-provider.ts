import { join, resolve } from 'node:path'
import type { CommandOption, McpAuthStart, ModelDefaults, ModelOption, PluginInfo, ProviderSettings, ProviderStatus } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import type { LoginCommand, LoginStep } from '../../accounts/account-login'
import { defaultGeminiHome, geminiAuthTypeOf, geminiDirOf, geminiPaths, readGeminiLogin } from '../../accounts/cli-files'
import { readJsonSync } from '../../lib/json-file'
import { CliBinary, cliEnv } from '../cli-binary'
import type { AccountContext, AgentProvider, AgentRun, McpServerState, RunOptions, RunSink, RunUsage } from '../provider'
import { AcpConnection } from './acp-connection'
import { GeminiConfig } from './gemini-config'
import { parseModelList } from './gemini-items'
import { GeminiRun } from './gemini-run'

/**
 * What Gemini CLI runs with besides the account: the chat's folder counts as trusted (the user picked
 * it as a project; untrusted, Gemini CLI would keep every chat in its default mode), and no relaunch
 * of itself as a child process, which a stop of the process would leave running.
 */
export const GEMINI_RUN_ENV = { GEMINI_CLI_TRUST_WORKSPACE: 'true', GEMINI_CLI_NO_RELAUNCH: 'true' }

/** Its commands in an ACP session, until a running chat reported them (`available_commands_update`). */
const COMMANDS: { name: string; description: string }[] = [
  { name: 'about', description: 'Version und Umgebung' },
  { name: 'help', description: 'Befehle von Gemini CLI' },
  { name: 'init', description: 'Legt eine GEMINI.md für das Projekt an' },
  { name: 'memory show', description: 'Zeigt den Inhalt des Gedächtnisses' },
  { name: 'memory list', description: 'Die GEMINI.md-Dateien im Einsatz' },
  { name: 'memory refresh', description: 'Liest das Gedächtnis neu ein' },
  { name: 'extensions list', description: 'Die installierten Erweiterungen' },
  { name: 'restore', description: 'Stellt einen Checkpoint wieder her' },
]

/** Until Gemini CLI listed them: what `gemini --list-models` names without a login. */
const FALLBACK_MODELS: ModelOption[] = [
  { id: 'auto', label: 'Auto', description: 'Gemini CLI wählt das Modell je nach Aufgabe', isDefault: true },
  { id: 'gemini-2.5-pro', label: 'gemini-2.5-pro' },
  { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
]

/**
 * Gemini CLI through the Agent Client Protocol (`gemini --acp`): a process per chat, started with the
 * account's GEMINI_CLI_HOME. Login state comes from the account's files; Gemini CLI tells neither
 * limits nor titles (docs/PROTOCOLS.md).
 */
export class GeminiProvider implements AgentProvider {
  readonly id = 'gemini' as const
  readonly binary: CliBinary
  /** Its `settings.json` files, written by Nexa itself (see gemini-config.ts). */
  readonly config = new GeminiConfig()
  private models_: { models: ModelOption[]; at: number } | null = null
  private modelsLoading: Promise<ModelOption[]> | null = null
  private commands_: CommandOption[] | null = null
  private readonly runs = new Map<string, Set<GeminiRun>>()

  constructor(private readonly settings: () => ProviderSettings) {
    this.binary = new CliBinary(
      {
        names: { win32: ['gemini.cmd', 'gemini.exe'], posix: ['gemini'] },
        installDirs: (home, isWin) => [...(isWin && process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : []), join(home, '.local', 'bin')],
        notFound: 'Gemini CLI wurde nicht gefunden. Installiere es (npm install -g @google/gemini-cli) oder trage den Pfad unter Einstellungen → CLIs ein.',
      },
      () => this.settings().path,
    )
  }

  /** The `.gemini` folder of an account: GEMINI_CLI_HOME's, else the one the app was started with. */
  private dirOf(account: AccountEnv): string {
    return geminiDirOf(account.set.GEMINI_CLI_HOME ? resolve(account.set.GEMINI_CLI_HOME) : defaultGeminiHome())
  }

  async detect(account: AccountContext): Promise<ProviderStatus> {
    this.binary.invalidate()
    const path = this.binary.resolve()
    const base: ProviderStatus = { id: 'gemini', name: 'Gemini CLI', installed: !!path, path: path ?? undefined, loggedIn: null, checkedAt: Date.now() }
    if (!path) return base
    const version = await this.binary.version()
    const paths = geminiPaths(this.dirOf(account))
    const type = geminiAuthTypeOf(readJsonSync<unknown>(paths.settingsFile))
    const apiKey = !!account.set.GEMINI_API_KEY || (!!process.env.GEMINI_API_KEY && !account.unset.includes('GEMINI_API_KEY'))
    const otherAuth = apiKey || (!!type && type !== 'oauth-personal')
    const login = readGeminiLogin(readJsonSync<unknown>(paths.oauthFile), readJsonSync<unknown>(paths.accountsFile), otherAuth)
    return {
      ...base,
      version: version ?? undefined,
      loggedIn: login.authState !== 'missing',
      account: login.authState === 'missing' ? undefined : { email: login.identity.email ?? undefined, authMode: login.renewable ? 'oauth-personal' : (type ?? (apiKey ? 'gemini-api-key' : undefined)) },
    }
  }

  /** The models of the last session Gemini CLI started (they depend on the login), else its list without one. */
  async models(): Promise<ModelOption[]> {
    if (this.models_) return this.models_.models
    this.modelsLoading ??= this.binary
      .run(['--list-models'], 20_000, cliEnv(GEMINI_RUN_ENV))
      .then((out) => {
        const parsed = out ? parseModelList(out) : []
        const models = parsed.length ? parsed.map((m) => ({ ...m, isDefault: m.id === 'auto' })) : FALLBACK_MODELS
        this.models_ ??= { models, at: Date.now() }
        return this.models_.models
      })
      .finally(() => (this.modelsLoading = null))
    return this.modelsLoading
  }

  /** Gemini CLI has no reasoning effort to choose. */
  async modelDefaults(): Promise<ModelDefaults> {
    return {}
  }

  async commands(): Promise<CommandOption[]> {
    return this.commands_ ?? COMMANDS.map((c) => ({ name: c.name, description: c.description, kind: 'command', insert: `/${c.name}` }))
  }

  /** Gemini CLI tells no client how its MCP servers are; its settings are edited in its own files. */
  async mcpServers(): Promise<McpServerState[]> {
    return []
  }

  async reconnectMcp(): Promise<void> {}

  async authenticateMcp(): Promise<McpAuthStart | null> {
    return null
  }

  async plugins(): Promise<PluginInfo[]> {
    return []
  }

  async setPluginEnabled(): Promise<void> {
    throw new Error('Erweiterungen von Gemini CLI schaltet Nexa noch nicht.')
  }

  async start(options: RunOptions, sink: RunSink): Promise<AgentRun> {
    const args = ['--acp', ...(options.dirs?.length ? ['--include-directories', options.dirs.join(',')] : []), ...this.settings().extraArgs, ...options.extraArgs]
    let run: GeminiRun | null = null
    const conn = new AcpConnection(
      this.binary.command(args),
      { cwd: options.cwd, env: cliEnv({ ...options.account.set, ...GEMINI_RUN_ENV }, options.account.unset) },
      {
        notification: (method, params) => run?.notification(method, params),
        request: (id, method, params) => (run ? run.request(id, method, params) : conn.respondError(id, 'Noch nicht bereit.')),
        exited: (code, stderr) => run?.exited(code, stderr),
      },
    )
    run = new GeminiRun(conn, options, sink, {
      commands: (list) => {
        if (list.length) this.commands_ = list.map((c) => ({ name: c.name, description: c.description, kind: 'command', insert: `/${c.name}` }))
      },
      models: (list) => {
        this.models_ = { models: list.map((m) => ({ ...m, isDefault: m.id === 'auto' })), at: Date.now() }
      },
    })
    const accountRuns = this.runs.get(options.account.accountId) ?? new Set<GeminiRun>()
    this.runs.set(options.account.accountId, accountRuns)
    for (const old of accountRuns) if (!old.alive) accountRuns.delete(old)
    accountRuns.add(run)
    try {
      await run.connect()
    } catch (error) {
      accountRuns.delete(run)
      await conn.stop(1000).catch(() => undefined)
      throw error
    }
    return run
  }

  async usage(): Promise<RunUsage | null> {
    return null
  }

  /**
   * Gemini CLI has no login command: its ACP server signs in with `authenticate`, opens the browser
   * itself and answers once Google redirected back (the link it prints stays in its process).
   */
  loginCommand(): LoginCommand {
    const line = (id: number, method: string, params: Record<string, unknown>) => `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    return {
      ...this.binary.command(['--acp']),
      env: GEMINI_RUN_ENV,
      dialog: {
        start: line(1, 'initialize', { protocolVersion: 1, clientCapabilities: {} }),
        read: (text): LoginStep => {
          let message: unknown
          try {
            message = JSON.parse(text)
          } catch {
            return null
          }
          if (!isPlainObject(message) || typeof message.method === 'string') return null
          const error = isPlainObject(message.error) ? message.error : null
          if (error) return { failed: typeof error.message === 'string' ? error.message : 'Die Anmeldung ist fehlgeschlagen.' }
          if (message.id === 1) return { write: line(2, 'authenticate', { methodId: 'oauth-personal' }) }
          return message.id === 2 ? { ok: true } : null
        },
      },
    }
  }

  async forget(accountId: string): Promise<void> {
    const runs = this.runs.get(accountId)
    this.runs.delete(accountId)
    await Promise.all([...(runs ?? [])].map((r) => r.stop().catch(() => undefined)))
  }

  async dispose(): Promise<void> {
    const all = [...this.runs.values()].flatMap((set) => [...set])
    this.runs.clear()
    await Promise.all(all.map((r) => r.stop().catch(() => undefined)))
  }
}
