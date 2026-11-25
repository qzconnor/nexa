import { randomUUID } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  ACCOUNT_COLORS,
  ACCOUNT_KINDS,
  isSystemAccountId,
  maskSecret,
  pickAccount,
  reorderAccounts,
  systemAccountId,
  usesSecret,
  type Account,
  type AccountCreateInput,
  type AccountIdentity,
  type AccountKind,
  type AccountUpdateInput,
} from '@shared/accounts'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import { readJsonGuarded, readJsonSync, writeJsonAtomic } from '../lib/json-file'
import { decryptSecret, encryptSecret } from '../lib/secrets'
import { TypedEmitter } from '../lib/typed-emitter'
import { accountEnv, type AccountEnv } from './account-env'
import { antigravityLogin, ensureApiKeySettings } from './antigravity-account'
import {
  antigravityPaths,
  claudePaths,
  codexPaths,
  defaultAntigravityDir,
  defaultClaudeConfigDir,
  defaultCodexHome,
  NO_IDENTITY,
  readClaudeLogin,
  readCodexLogin,
  withCodexFileStore,
  type AntigravityPaths,
  type ClaudePaths,
  type CodexPaths,
  type LoginInfo,
} from './cli-files'

interface StoredAccount {
  id: string
  name: string
  provider: ProviderId
  kind: AccountKind
  color: string
  /** Only set when the user picked the folder; otherwise Nexa's profile folder is used. */
  configDir: string | null
  extraArgs: string[]
  createdAt: number
  /** base64 of the encrypted token or API key */
  secret: string | null
  secretHint: string | null
}

interface AccountsFile {
  version: 1
  accounts: StoredAccount[]
}

/** Copied from the CLI's own folder into a new profile when asked: settings, never logins. */
const SHAREABLE_ITEMS: Record<ProviderId, string[]> = {
  claude: ['settings.json', 'keybindings.json', 'CLAUDE.md', 'skills', 'commands', 'agents', 'rules'],
  codex: ['config.toml', 'AGENTS.md', 'prompts', 'skills', 'rules'],
  // `config`: MCP servers, hooks, plugins and skills; the login is in the keyring anyway.
  antigravity: ['GEMINI.md', 'config'],
}

/** The standard account's color: one per CLI, the others pick from the rest. */
const SYSTEM_COLOR: Record<ProviderId, string> = { claude: ACCOUNT_COLORS[0], codex: ACCOUNT_COLORS[1], antigravity: ACCOUNT_COLORS[2] }

const POLL_MS = 15_000

type Events = { changed: [accounts: Account[]] }

/**
 * The accounts of every CLI: stored in `accounts.json`, their tokens and API keys encrypted by the
 * system. The login state comes from the CLI's own files and is read again every few seconds: the
 * CLIs log in, out and renew tokens on their own.
 */
export class AccountService extends TypedEmitter<Events> {
  private readonly file: string
  private readonly profilesDir: string
  private stored: StoredAccount[] = []
  /** Decrypted tokens and API keys by account id; only ever in memory. */
  private readonly secrets = new Map<string, string>()
  private snapshot: Account[] = []
  private fingerprint = ''
  private pollTimer: NodeJS.Timeout | null = null

  constructor(userDataDir: string) {
    super()
    this.file = join(userDataDir, 'accounts.json')
    this.profilesDir = join(userDataDir, 'profiles')
  }

  async init(): Promise<void> {
    const data = await readJsonGuarded<AccountsFile>(this.file)
    this.stored = Array.isArray(data?.accounts) ? data.accounts.filter(isStoredAccount) : []
    // Accounts of a CLI Nexa no longer has (Gemini CLI in Nexa 0.x) leave the file; their folders stay.
    let added = Array.isArray(data?.accounts) && data.accounts.length !== this.stored.length
    // Every CLI has its standard account, first in its list.
    for (const provider of [...PROVIDER_IDS].reverse()) {
      const id = systemAccountId(provider)
      if (this.stored.some((a) => a.id === id)) continue
      this.stored.unshift({
        id,
        name: 'Standard',
        provider,
        kind: 'system',
        color: SYSTEM_COLOR[provider],
        configDir: null,
        extraArgs: [],
        createdAt: Date.now(),
        secret: null,
        secretHint: null,
      })
      added = true
    }
    if (added) await this.persist().catch((error) => console.warn('[accounts] could not be saved', error))
    await this.loadSecrets()
    this.rebuild()
    this.pollTimer = setInterval(() => this.rebuild(), POLL_MS)
  }

  dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
  }

  list(): Account[] {
    return this.snapshot.map((a) => structuredClone(a))
  }

  has(id: string | null | undefined): boolean {
    return !!id && this.stored.some((a) => a.id === id)
  }

  get(id: string): Account {
    const account = this.snapshot.find((a) => a.id === id)
    if (!account) throw new Error('Den Account gibt es nicht mehr.')
    return structuredClone(account)
  }

  /** Reads the logins again; `changed` follows when something differs. */
  refresh(): Account[] {
    this.rebuild()
    return this.list()
  }

  async create(input: AccountCreateInput): Promise<Account> {
    const name = input.name?.trim()
    if (!name) throw new Error('Bitte gib einen Namen an.')
    const provider = input.provider
    if (!PROVIDER_IDS.includes(provider)) throw new Error('Unbekannte CLI.')
    if (!ACCOUNT_KINDS[provider].includes(input.kind)) throw new Error(`${PROVIDERS[provider].name} unterstützt diese Anmeldeart nicht.`)
    const secret = input.secret?.trim() ?? ''
    if (usesSecret(input.kind)) checkSecret(provider, input.kind, secret)

    const id = randomUUID()
    // Before anything is created: without the system's encryption nothing is stored at all.
    const encrypted = secret ? await encryptSecret(secret) : null
    let configDir: string | null = null
    if (input.configDir?.trim()) {
      configDir = resolve(input.configDir.trim())
      if (!isAbsolute(configDir)) throw new Error('Der Konfigurationsordner muss ein absoluter Pfad sein.')
      if (this.stored.some((a) => this.configDir(a) && samePath(this.configDir(a), configDir!))) {
        throw new Error('Diesen Ordner nutzt schon ein anderer Account.')
      }
    }
    const dir = configDir ?? join(this.profilesDir, id)
    const existed = existsSync(dir)
    await mkdir(dir, { recursive: true })
    try {
      if (input.importSettings && !configDir) await importShared(provider, dir)
      if (provider === 'codex') {
        const config = await readFile(join(dir, 'config.toml'), 'utf8').catch(() => '')
        const next = withCodexFileStore(config)
        if (next !== null) await writeFile(join(dir, 'config.toml'), next)
      }
      if (provider === 'antigravity' && input.kind === 'apiKey') await ensureApiKeySettings(dir)
    } catch (error) {
      // The account isn't created, so its folder doesn't stay behind either.
      if (!existed) await rm(dir, { recursive: true, force: true })
      throw error
    }

    const used = new Set(this.stored.map((a) => a.color.toLowerCase()))
    this.stored.push({
      id,
      name,
      provider,
      kind: input.kind,
      color: validColor(input.color) ?? ACCOUNT_COLORS.find((c) => !used.has(c)) ?? ACCOUNT_COLORS[this.stored.length % ACCOUNT_COLORS.length],
      configDir,
      extraArgs: cleanArgs(input.extraArgs),
      createdAt: Date.now(),
      secret: encrypted,
      secretHint: secret ? maskSecret(secret) : null,
    })
    if (secret) this.secrets.set(id, secret)
    await this.persist()
    this.rebuild(true)
    return this.get(id)
  }

  async update(id: string, patch: AccountUpdateInput): Promise<Account> {
    const account = this.require(id)
    // Checked and encrypted first, so a failure leaves the account as it was.
    const name = patch.name?.trim()
    if (patch.name !== undefined && !name) throw new Error('Bitte gib einen Namen an.')
    const secret = patch.secret?.trim() || null
    let encrypted: string | null = null
    if (secret) {
      if (!usesSecret(account.kind)) throw new Error('Nur Token- und API-Key-Accounts speichern ein Secret.')
      checkSecret(account.provider, account.kind, secret)
      encrypted = await encryptSecret(secret)
    }
    if (name) account.name = name
    const color = validColor(patch.color)
    if (color) account.color = color
    if (patch.extraArgs !== undefined) account.extraArgs = cleanArgs(patch.extraArgs)
    if (secret && encrypted) {
      account.secret = encrypted
      account.secretHint = maskSecret(secret)
      this.secrets.set(id, secret)
    }
    await this.persist()
    this.rebuild(true)
    return this.get(id)
  }

  /** The accounts in `ids` in that order (the user's order: lists, the fallback default, switching at a limit). */
  async reorder(ids: readonly string[]): Promise<void> {
    const next = reorderAccounts(this.stored, ids)
    if (next.every((a, i) => a === this.stored[i])) return
    this.stored = next
    await this.persist()
    this.rebuild(true)
  }

  /** Nexa deletes only folders it created itself, and only when asked. */
  async remove(id: string, deleteFolder: boolean): Promise<void> {
    if (isSystemAccountId(id)) throw new Error('Den Standard-Account einer CLI gibt es immer.')
    const account = this.stored.find((a) => a.id === id)
    if (!account) return
    this.stored = this.stored.filter((a) => a.id !== id)
    this.secrets.delete(id)
    await this.persist()
    if (deleteFolder && !account.configDir) {
      const dir = join(this.profilesDir, id)
      // A CLI that just ended may still hold a file for a moment (Windows).
      if (dir.startsWith(this.profilesDir) && existsSync(dir)) await rm(dir, { recursive: true, force: true, maxRetries: 5 })
    }
    this.rebuild(true)
  }

  /**
   * The account a CLI runs with: `id`, else `fallback` (the default), else the first one the user
   * sees. The standard account counts only while no other was added (`visibleAccounts`).
   */
  resolve(provider: ProviderId, id: string | null | undefined, fallback?: string): string {
    return pickAccount(this.stored, provider, [id, fallback])
  }

  /** The environment that starts the account's CLI. */
  env(id: string): AccountEnv {
    const account = this.require(id)
    return accountEnv({ id, provider: account.provider, kind: account.kind, configDir: this.configDir(account) }, this.secrets.get(id) ?? null)
  }

  extraArgs(id: string): string[] {
    return [...this.require(id).extraArgs]
  }

  claudePaths(id: string): ClaudePaths {
    const account = this.require(id)
    return account.kind === 'system' ? claudePaths(defaultClaudeConfigDir(), !!process.env.CLAUDE_CONFIG_DIR) : claudePaths(this.configDir(account), true)
  }

  codexPaths(id: string): CodexPaths {
    return codexPaths(this.configDir(this.require(id)))
  }

  /** Every account's `configDir` is a `.gemini` folder: `~/.gemini`, or its own passed as `--gemini-dir`. */
  antigravityPaths(id: string): AntigravityPaths {
    return antigravityPaths(this.configDir(this.require(id)))
  }

  /** The login in the account's files (and its access token, never sent to the window). */
  login(id: string): LoginInfo {
    const account = this.require(id)
    if (account.provider === 'codex') return readCodexLogin(readJsonSync<unknown>(this.codexPaths(id).authFile))
    if (account.provider === 'antigravity') {
      // The standard account may sign in with a key from the environment instead of the keyring.
      if (process.env.GEMINI_API_KEY) return { ...antigravityLogin(), authState: 'ok' }
      return antigravityLogin()
    }
    const paths = this.claudePaths(id)
    // Claude Code keeps no time of its own with the tokens; the file's tells when they were saved.
    const savedAt = modifiedAt(paths.credentialsFile)
    return readClaudeLogin(readJsonSync<unknown>(paths.credentialsFile), readJsonSync<unknown>(paths.globalConfigFile), Date.now(), savedAt)
  }

  /** Who is signed in in a config folder Nexa has no account for (yet), as the CLI would run with it. */
  identityAt(provider: ProviderId, configDir: string): AccountIdentity {
    if (provider === 'codex') return readCodexLogin(readJsonSync<unknown>(codexPaths(configDir).authFile)).identity
    // Antigravity's login is in the keyring and names nobody.
    if (provider === 'antigravity') return { ...NO_IDENTITY }
    const paths = claudePaths(configDir, true)
    return readClaudeLogin(readJsonSync<unknown>(paths.credentialsFile), readJsonSync<unknown>(paths.globalConfigFile)).identity
  }

  private configDir(account: StoredAccount): string {
    if (account.kind === 'system') return systemConfigDir(account.provider)
    return account.configDir ?? join(this.profilesDir, account.id)
  }

  private require(id: string): StoredAccount {
    const account = this.stored.find((a) => a.id === id)
    if (!account) throw new Error('Den Account gibt es nicht mehr.')
    return account
  }

  private async loadSecrets(): Promise<void> {
    let changed = false
    for (const account of this.stored) {
      if (!account.secret || this.secrets.has(account.id)) continue
      const decrypted = await decryptSecret(account.secret)
      if (!decrypted) {
        console.warn(`[accounts] secret of „${account.name}“ could not be decrypted`)
        continue
      }
      this.secrets.set(account.id, decrypted.plain)
      if (decrypted.reEncrypted) {
        account.secret = decrypted.reEncrypted
        changed = true
      }
    }
    if (changed) await this.persist().catch((error) => console.warn('[accounts] could not be saved', error))
  }

  private persist(): Promise<void> {
    return writeJsonAtomic(this.file, { version: 1, accounts: this.stored } satisfies AccountsFile, { guarded: true })
  }

  private rebuild(force = false): void {
    const next = this.stored.map((a) => this.toAccount(a))
    const fingerprint = JSON.stringify(next)
    if (!force && fingerprint === this.fingerprint) return
    this.snapshot = next
    this.fingerprint = fingerprint
    this.emit('changed', this.list())
  }

  private toAccount(stored: StoredAccount): Account {
    const base = {
      id: stored.id,
      name: stored.name,
      provider: stored.provider,
      kind: stored.kind,
      color: stored.color,
      configDir: this.configDir(stored),
      customConfigDir: stored.kind === 'system' || stored.configDir !== null,
      createdAt: stored.createdAt,
      secretHint: stored.secretHint,
      extraArgs: [...stored.extraArgs],
    }
    if (usesSecret(stored.kind)) {
      // A secret that can't be decrypted is as good as none. A token names no person.
      const authState = this.secrets.has(stored.id) ? 'ok' : 'missing'
      return { ...base, authState, identity: { ...NO_IDENTITY }, tokenExpiresAt: null, loginEndsAt: null, tokenSavedAt: null, renewable: false }
    }
    const info = this.login(stored.id)
    return {
      ...base,
      authState: info.authState,
      identity: info.identity,
      tokenExpiresAt: info.tokenExpiresAt,
      loginEndsAt: info.loginEndsAt,
      tokenSavedAt: info.tokenSavedAt,
      renewable: info.renewable,
    }
  }
}

/** The folder of a CLI's standard account, as the CLI finds it. */
function systemConfigDir(provider: ProviderId): string {
  if (provider === 'codex') return defaultCodexHome()
  if (provider === 'antigravity') return defaultAntigravityDir()
  return defaultClaudeConfigDir()
}

function checkSecret(provider: ProviderId, kind: AccountKind, secret: string): void {
  if (!secret) throw new Error(kind === 'token' ? 'Bitte trage den Token ein.' : 'Bitte trage den API-Key ein.')
  if (provider === 'antigravity') {
    // AI Studio's keys have no fixed prefix Nexa could rely on; only obvious mix-ups are caught.
    if (/\s/.test(secret) || secret.length < 20) throw new Error('Das sieht nicht nach einem Gemini-API-Key aus (aus Google AI Studio).')
    if (secret.startsWith('sk-')) throw new Error('Das ist kein Gemini-API-Key: Er kommt aus Google AI Studio und beginnt meist mit „AIza“.')
    return
  }
  if (!secret.startsWith('sk-ant-')) {
    throw new Error(kind === 'token' ? 'Der Token beginnt mit „sk-ant-“ (erzeugt mit `claude setup-token`).' : 'Der API-Key beginnt mit „sk-ant-“.')
  }
}

function validColor(color: string | undefined): string | null {
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null
}

function cleanArgs(args: string[] | undefined): string[] {
  return (args ?? []).map((a) => String(a).trim()).filter(Boolean)
}

function modifiedAt(file: string): number | null {
  try {
    return statSync(file).mtimeMs
  } catch {
    return null
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

/** All or nothing: when an item fails, what was copied so far is removed again. */
async function importShared(provider: ProviderId, target: string): Promise<void> {
  const source = systemConfigDir(provider)
  await mkdir(target, { recursive: true })
  const copied: string[] = []
  for (const item of SHAREABLE_ITEMS[provider]) {
    const from = join(source, item)
    const to = join(target, item)
    if (!(await stat(from).catch(() => null)) || existsSync(to)) continue
    copied.push(to)
    try {
      await copyShared(from, to)
    } catch (error) {
      for (const path of copied) await rm(path, { recursive: true, force: true })
      throw new Error(`„${item}“ ließ sich nicht übernehmen: ${(error as Error).message}`)
    }
  }
}

/** Copies a file or folder, links stay links: skills from a skills manager keep getting its updates. */
async function copyShared(from: string, to: string): Promise<void> {
  const info = await lstat(from)
  if (info.isSymbolicLink()) {
    const target = resolve(dirname(from), await readlink(from))
    const linked = await stat(target).catch(() => null)
    if (!linked) return
    try {
      // A junction needs no admin rights on Windows, a symlink does.
      await symlink(target, to, linked.isDirectory() ? 'junction' : 'file')
    } catch {
      await copyShared(target, to)
    }
  } else if (info.isDirectory()) {
    await mkdir(to)
    for (const name of await readdir(from)) await copyShared(join(from, name), join(to, name))
  } else if (info.isFile()) {
    await copyFile(from, to)
  }
}

function isStoredAccount(value: unknown): value is StoredAccount {
  if (!value || typeof value !== 'object') return false
  const a = value as Partial<StoredAccount>
  return (
    typeof a.id === 'string' &&
    typeof a.name === 'string' &&
    PROVIDER_IDS.includes(a.provider as ProviderId) &&
    (a.kind === 'system' || a.kind === 'oauth' || a.kind === 'token' || a.kind === 'apiKey') &&
    typeof a.color === 'string' &&
    Array.isArray(a.extraArgs)
  )
}
