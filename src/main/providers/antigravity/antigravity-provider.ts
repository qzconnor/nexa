import { randomUUID } from 'node:crypto'
import { mkdir, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, normalize } from 'node:path'
import type { ChatItem } from '@shared/chat'
import type { CommandOption, McpAuthStart, ModelDefaults, ModelOption, PluginInfo, ProviderSettings, ProviderStatus } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import type { LoginCommand } from '../../accounts/account-login'
import { antigravitySignedIn, ensureApiKeySettings, refreshAntigravityKeyring } from '../../accounts/antigravity-account'
import { antigravityPaths, defaultAntigravityDir } from '../../accounts/cli-files'
import { AcpConnection } from '../acp/acp-connection'
import { CliBinary, cliEnv } from '../cli-binary'
import type { AccountContext, AgentProvider, AgentRun, CliSessionInfo, McpServerState, RunOptions, RunSink, RunUsage } from '../provider'
import { AntigravityConfig, antigravityMcpServers, setAntigravityMcpEnabled } from './antigravity-config'
import { conversationFile, conversationMtime, promptTimes, readSteps } from './antigravity-conversations'
import { stampHistory } from './antigravity-history'
import { commandsOf, modelsOf, pathOf, str, tierOf, usageOfQuota } from './antigravity-items'
import { AntigravityRun } from './antigravity-run'
import { AGY_SERVER_TOKEN_ENV, AgyLocalServer, agyLogOf } from './antigravity-server'

const NAME = 'Antigravity CLI'

/** After a turn the quota is read again, at most this often per account (a reading starts `agy` for ~2 s). */
const USAGE_AFTER_TURN_MS = 60_000

/** Until Antigravity named them in a session (they depend on the login). */
const FALLBACK_MODELS: ModelOption[] = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', efforts: ['low', 'medium', 'high'], isDefault: true },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
]

const asCommand = (c: { name: string; description?: string }): CommandOption => ({ name: c.name, description: c.description, kind: 'command', insert: `/${c.name}` })

/**
 * A home folder for `agy -p` whose `.gemini` is a link to the account's folder (a junction on
 * Windows: no rights needed). Made anew each time, in case the account's folder moved.
 */
async function homeFor(accountId: string, dir: string): Promise<string> {
  const home = join(tmpdir(), 'nexa-agy-home', accountId)
  const link = join(home, '.gemini')
  await mkdir(home, { recursive: true })
  // unlink removes only the link, never what it leads to.
  await unlink(link).catch(() => undefined)
  await symlink(dir, link, 'junction').catch((error: NodeJS.ErrnoException) => {
    // Another reading of the same account made it meanwhile.
    if (error.code !== 'EEXIST') throw error
  })
  return home
}

/**
 * The database of a session the probe started and never prompted, with SQLite's files beside it. Only
 * a session id as Antigravity names them (a UUID): nothing else of the folder can be meant.
 */
async function removeEmptyConversation(dir: string, sessionId: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) return
  const db = conversationFile(dir, sessionId)
  await Promise.all([db, `${db}-wal`, `${db}-shm`].map((file) => unlink(file).catch(() => undefined)))
}

/**
 * Antigravity CLI through the Agent Client Protocol (`agy acp`): a process per chat. The standard
 * account's Google login is the keyring's (one per user); every other account has its own data folder
 * (`--gemini-dir`) with its own Google login (file tokens) or an API key. ACP tells the plan of the
 * login; its quota comes from `agy -p "/usage"` (docs/PROTOCOLS.md).
 */
export class AntigravityProvider implements AgentProvider {
  readonly id = 'antigravity' as const
  readonly binary: CliBinary
  /** Its MCP servers, permissions and hooks, written by Nexa itself (see antigravity-config.ts). */
  readonly config = new AntigravityConfig()
  private models_: ModelOption[] | null = null
  private modelsLoading: Promise<ModelOption[]> | null = null
  private commands_: CommandOption[] | null = null
  /** The plan of each account's login, from its last session (by account id). */
  private readonly tiers = new Map<string, string>()
  private readonly runs = new Map<string, Set<AntigravityRun>>()
  /** When the quota of an account was last read. */
  private readonly usageReadAt = new Map<string, number>()

  constructor(private readonly settings: () => ProviderSettings) {
    this.binary = new CliBinary(
      {
        names: { win32: ['agy.exe', 'agy.cmd'], posix: ['agy'] },
        installDirs: (home, isWin) => [...(isWin && process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'agy', 'bin')] : []), join(home, '.local', 'bin')],
        notFound:
          process.platform === 'win32'
            ? 'Antigravity CLI wurde nicht gefunden. Installiere es (PowerShell: irm https://antigravity.google/cli/install.ps1 | iex) oder trage den Pfad unter Einstellungen → CLIs ein.'
            : 'Antigravity CLI wurde nicht gefunden. Installiere es (curl -fsSL https://antigravity.google/cli/install.sh | bash) oder trage den Pfad unter Einstellungen → CLIs ein.',
      },
      () => this.settings().path,
    )
  }

  async detect(account: AccountContext): Promise<ProviderStatus> {
    this.binary.invalidate()
    const path = this.binary.resolve()
    const base: ProviderStatus = { id: 'antigravity', name: NAME, installed: !!path, path: path ?? undefined, loggedIn: null, checkedAt: Date.now() }
    if (!path) return base
    const version = await this.binary.version()
    const apiKey = !!account.set.GEMINI_API_KEY
    await refreshAntigravityKeyring()
    // A keyring Nexa can't look into counts as signed in: Antigravity says so at the first prompt.
    const loggedIn = antigravitySignedIn(account)
    return {
      ...base,
      version: version ?? undefined,
      loggedIn,
      account: loggedIn ? { authMode: apiKey ? 'gemini-api-key' : 'oauth-personal', plan: apiKey ? undefined : this.tiers.get(account.accountId) } : undefined,
    }
  }

  /** The models of the last session (they depend on the login); before one, a session started to ask. */
  async models(account: AccountContext): Promise<ModelOption[]> {
    if (this.models_) return this.models_
    this.modelsLoading ??= this.probe(account)
      .then((models) => (this.models_ ??= models.length ? models : null) ?? FALLBACK_MODELS)
      .catch(() => FALLBACK_MODELS)
      .finally(() => (this.modelsLoading = null))
    return this.modelsLoading
  }

  /**
   * Starts a session without a prompt to read its models and commands: it costs no quota. Since 1.5.17
   * Antigravity keeps even such a session as a database; the probe removes it again.
   */
  private async probe(account: AccountEnv): Promise<ModelOption[]> {
    if (!antigravitySignedIn(account)) return []
    const conn = new AcpConnection(
      this.binary.command(this.argsOf(account, [])),
      { cwd: tmpdir(), env: cliEnv(account.set, account.unset), name: NAME },
      {
        notification: (method, params) => {
          const update = params.update as { sessionUpdate?: unknown; availableCommands?: unknown } | undefined
          if (method === 'session/update' && update?.sessionUpdate === 'available_commands_update') this.takeCommands(commandsOf(update.availableCommands))
        },
        request: (id) => conn.respondError(id, 'Nicht unterstützt.'),
        exited: () => undefined,
      },
    )
    let sessionId: string | undefined
    try {
      await this.withTimeout(conn.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'nexa', version: '1' } }))
      const session = await this.withTimeout(conn.request('session/new', { cwd: tmpdir(), mcpServers: [] }))
      sessionId = str(session.sessionId)
      this.takeTier(account.accountId, tierOf(session._meta))
      return modelsOf(session.configOptions, session.models)
    } finally {
      await conn.stop(1000).catch(() => undefined)
      if (sessionId) await removeEmptyConversation(this.dirOf(account), sessionId)
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms = 30_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<T>((_, reject) => (timer = setTimeout(() => reject(new Error('Antigravity CLI antwortet nicht.')), ms)))
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
  }

  /** A model's level of thought is named with its models. */
  async modelDefaults(_account: AccountContext, model: string): Promise<ModelDefaults> {
    const found = (this.models_ ?? []).find((m) => m.id === model)
    return { effort: found?.defaultEffort ?? (found?.efforts?.includes('high') ? 'high' : undefined) }
  }

  async commands(): Promise<CommandOption[]> {
    return this.commands_ ?? []
  }

  private takeTier(accountId: string, tier: string | undefined): void {
    if (tier) this.tiers.set(accountId, tier)
  }

  private takeCommands(list: { name: string; description?: string }[]): void {
    if (list.length) this.commands_ = list.map(asCommand)
  }

  /**
   * Without a running chat the „+“ menu shows the servers from the files (a running one adds how they
   * are, antigravity-run.ts); a run can't leave one out, the switch is their `disabled` there.
   */
  async mcpServers(account: AccountContext, cwd: string): Promise<McpServerState[]> {
    return antigravityMcpServers(account, cwd)
  }

  async setMcpEnabled(account: AccountContext, cwd: string, name: string, enabled: boolean): Promise<void> {
    await setAntigravityMcpEnabled(account, cwd, name, enabled)
  }

  async reconnectMcp(): Promise<void> {}

  async authenticateMcp(): Promise<McpAuthStart | null> {
    return null
  }

  async plugins(): Promise<PluginInfo[]> {
    return []
  }

  async setPluginEnabled(): Promise<void> {
    throw new Error('Plugins von Antigravity CLI schaltet Nexa noch nicht.')
  }

  /** The account's folder, then `extra`, then the arguments from Settings › CLIs (`settingsArgs`). */
  private argsOf(account: AccountEnv, extra: string[], settingsArgs = true): string[] {
    return ['acp', ...(account.dir ? ['--gemini-dir', account.dir] : []), ...extra, ...(settingsArgs ? this.settings().extraArgs : [])]
  }

  async start(options: RunOptions, sink: RunSink): Promise<AgentRun> {
    const account = options.account
    if (account.dir && account.set.GEMINI_API_KEY) await ensureApiKeySettings(account.dir)
    const extra = [
      ...(options.dirs ?? []).flatMap((dir) => ['--add-dir', dir]),
      // „Volle Rechte“ only at the start: a change to or from it restarts the process (session-service.ts).
      ...(options.permissionMode === 'full' ? ['--dangerously-skip-permissions'] : []),
    ]
    let run: AntigravityRun | null = null
    // The process's local server takes calls with this token only; Nexa asks it how the MCP servers are.
    const token = randomUUID()
    const conn = new AcpConnection(
      this.binary.command([...this.argsOf(account, extra), ...options.extraArgs]),
      { cwd: options.cwd, env: cliEnv({ ...account.set, [AGY_SERVER_TOKEN_ENV]: token }, account.unset), name: NAME },
      {
        notification: (method, params) => run?.notification(method, params),
        request: (id, method, params) => (run ? run.request(id, method, params) : conn.respondError(id, 'Noch nicht bereit.')),
        exited: (code, stderr) => run?.exited(code, stderr),
      },
    )
    const logDir = antigravityPaths(this.dirOf(account)).logDir
    run = new AntigravityRun(conn, options, sink, {
      commands: (list) => this.takeCommands(list),
      models: (list) => {
        this.models_ = list
      },
      turnEnded: (limit) => this.afterTurn(account, sink, limit),
      server: new AgyLocalServer(() => agyLogOf(logDir, conn.pid), token),
    })
    const accountRuns = this.runs.get(account.accountId) ?? new Set<AntigravityRun>()
    this.runs.set(account.accountId, accountRuns)
    for (const old of accountRuns) if (!old.alive) accountRuns.delete(old)
    accountRuns.add(run)
    try {
      await run.connect()
      this.takeTier(account.accountId, run.tier)
    } catch (error) {
      accountRuns.delete(run)
      await conn.stop(1000).catch(() => undefined)
      throw error
    }
    return run
  }

  /**
   * The quota of the Google login. An API key has none (agy exits with code 2). A reading starts a
   * process, so the regular look only comes while a chat of the account runs or before the first
   * reading; by hand (`wake`) always.
   */
  async usage(account: AccountContext, wake: boolean): Promise<RunUsage | null> {
    if (!this.hasQuota(account)) return null
    const running = [...(this.runs.get(account.accountId) ?? [])].some((r) => r.alive)
    if (!wake && !running && this.usageReadAt.has(account.accountId)) return null
    return this.readUsage(account)
  }

  /** Only a Google login has a quota. Without one, `agy -p` would wait for a sign-in in the browser. */
  private hasQuota(account: AccountEnv): boolean {
    return account.set.GEMINI_API_KEY === undefined && antigravitySignedIn(account) && !!this.binary.resolve()
  }

  /**
   * `/usage` in print mode answers without a turn, without quota and without a conversation left
   * behind. It knows no `--gemini-dir` (only `acp` does) and reads `<home>/.gemini`: an account with a
   * folder of its own gets a home of its own whose `.gemini` leads there, or it would read the
   * standard account's login.
   */
  private async readUsage(account: AccountEnv): Promise<RunUsage> {
    this.usageReadAt.set(account.accountId, Date.now())
    const env = cliEnv(account.set, account.unset)
    if (account.dir) {
      const home = await homeFor(account.accountId, account.dir)
      Object.assign(env, { USERPROFILE: home, HOME: home })
    }
    const result = await this.binary.output(['-p', '/usage', '--output-format', 'json'], { cwd: tmpdir(), env, timeout: 30_000 })
    // The JSON is the output's last line; a notice of the updater may come before it.
    const line = result.stdout.trim().split(/\r?\n/).pop() ?? ''
    let parsed: unknown = null
    try {
      parsed = JSON.parse(line)
    } catch {
      // Below as no quota.
    }
    const quota = usageOfQuota(parsed)
    const base = { provider: 'antigravity' as const, plan: this.tiers.get(account.accountId), updatedAt: Date.now(), source: 'api' as const }
    if (quota) return { ...base, ...quota }
    const reason = result.stderr.trim().split(/\r?\n/).pop() || 'keine Angaben'
    return { ...base, windows: [], message: `Antigravity CLI nennt keine Kontingente (${reason}).` }
  }

  /** The quota after a turn, so the title bar follows the chat; at once when the turn stopped at it. */
  private afterTurn(account: AccountEnv, sink: RunSink, limit: boolean): void {
    if (!this.hasQuota(account)) return
    if (!limit && Date.now() - (this.usageReadAt.get(account.accountId) ?? 0) < USAGE_AFTER_TURN_MS) return
    void this.readUsage(account)
      .then((usage) => sink.usage(usage))
      .catch(() => undefined)
  }

  /** The account's data folder: its own (`--gemini-dir`) or Antigravity's default. */
  private dirOf(account: AccountEnv): string {
    return account.dir ?? defaultAntigravityDir()
  }

  /** The conversations of the account's folder that can go on, as Antigravity lists them (`session/list`). */
  async sessions(account: AccountContext): Promise<CliSessionInfo[]> {
    const listed = await this.reading(account, (conn) => this.listed(conn))
    // Its list keeps conversations whose database was deleted.
    const dir = this.dirOf(account)
    const kept = await Promise.all(listed.map(async (s) => ((await conversationMtime(dir, s.id)) === null ? null : s)))
    return kept.filter((s): s is CliSessionInfo => !!s)
  }

  /**
   * A conversation as chat items: `session/load` streams it again (antigravity-run.ts `replay`), the
   * times come from its database. `since`: only the turns of prompts made after it, read only when there are any.
   */
  async history(account: AccountContext, sessionId: string, since?: number): Promise<ChatItem[]> {
    const steps = readSteps(conversationFile(this.dirOf(account), sessionId))
    if (since !== undefined && !(promptTimes(steps) ?? []).some((t) => t > since)) return []
    const items = await this.reading(account, async (conn, bind) => {
      // `session/load` needs the folder the conversation ran in.
      const cwd = (await this.listed(conn)).find((s) => s.id === sessionId)?.cwd
      if (!cwd) throw new Error('Antigravity CLI kennt diese Unterhaltung nicht.')
      const collected = new Map<string, ChatItem>()
      const sink: RunSink = {
        item: (item) => void collected.set(item.id, item),
        delta: () => undefined,
        runtime: () => undefined,
        cliSession: () => undefined,
        usage: () => undefined,
        taken: () => undefined,
        exited: () => undefined,
      }
      const run = new AntigravityRun(conn, { sessionId, cwd, permissionMode: 'ask', account, instructions: '', extraArgs: [] }, sink)
      bind(run)
      await this.withTimeout(run.replay(sessionId), 120_000)
      return [...collected.values()]
    })
    return stampHistory(items, steps, since)
  }

  /** Every page of `session/list`, its paths as the system writes them. */
  private async listed(conn: AcpConnection): Promise<CliSessionInfo[]> {
    const found: CliSessionInfo[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const result = await this.withTimeout(conn.request('session/list', cursor ? { cursor } : {}))
      for (const s of Array.isArray(result.sessions) ? result.sessions.filter(isPlainObject) : []) {
        const id = str(s.sessionId)
        const cwd = pathOf(str(s.cwd))
        if (!id || !cwd) continue
        const updatedAt = Date.parse(str(s.updatedAt) ?? '')
        // Its title is the last prompt, cut („…“), until the conversation has a name.
        found.push({ id, cwd: normalize(cwd), title: str(s.title)?.trim() || null, firstPrompt: null, createdAt: null, updatedAt: Number.isNaN(updatedAt) ? null : updatedAt })
      }
      cursor = str(result.nextCursor)
      if (!cursor) break
    }
    return found
  }

  /** A process of its own for one look at the account's conversations, ended after it. */
  private async reading<T>(account: AccountEnv, use: (conn: AcpConnection, bind: (run: AntigravityRun) => void) => Promise<T>): Promise<T> {
    if (account.dir && account.set.GEMINI_API_KEY) await ensureApiKeySettings(account.dir)
    let run: AntigravityRun | null = null
    const conn = new AcpConnection(
      this.binary.command(this.argsOf(account, [])),
      { cwd: tmpdir(), env: cliEnv(account.set, account.unset), name: NAME },
      {
        notification: (method, params) => run?.notification(method, params),
        request: (id) => conn.respondError(id, 'Nicht unterstützt.'),
        exited: () => undefined,
      },
    )
    try {
      await this.withTimeout(
        conn.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'nexa', version: '1' } }),
      )
      return await use(conn, (r) => (run = r))
    } finally {
      await conn.stop(1000).catch(() => undefined)
    }
  }

  /**
   * `agy acp --login`: prints the Google sign-in link (and opens it), then reads the code the page
   * shows after the login from stdin, saves the login and ends. ACP's `authenticate` would open the
   * browser too but name no link, and couldn't take a code.
   */
  loginCommand(account: AccountEnv): LoginCommand {
    // The account's variables come with the start (AccountLogins), file tokens among them.
    return this.binary.command(this.argsOf(account, ['--login'], false))
  }

  /** ACP's `logout`: Antigravity removes the login from where the account keeps it (keyring or token file). */
  async logout(account: AccountEnv): Promise<void> {
    const conn = new AcpConnection(
      this.binary.command(this.argsOf(account, [])),
      { cwd: tmpdir(), env: cliEnv(account.set, account.unset), name: NAME },
      { notification: () => undefined, request: (id) => conn.respondError(id, 'Nicht unterstützt.'), exited: () => undefined },
    )
    try {
      await this.withTimeout(conn.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'nexa', version: '1' } }))
      await this.withTimeout(conn.request('logout', {}))
    } finally {
      await conn.stop(1000).catch(() => undefined)
    }
    this.tiers.delete(account.accountId)
    await refreshAntigravityKeyring()
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

