import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { pickAccount, visibleAccounts, type Account } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import { folderKey } from '@shared/folders'
import { enabledProviders, PROVIDERS } from '@shared/providers'
import type { AppSettings, Project, SessionMeta } from '@shared/types'
import { baseName } from '@shared/utils'
import { codexOverrides } from './providers/codex/codex-overrides'

/**
 * The `nx` command (src/launcher/nx.cs) starts the app with `--nx=<Base64>`: the caller's working
 * directory and its arguments, separated by NUL characters.
 */
const SWITCH = '--nx='
/** Nexa's chats, Claude Code's sessions and Codex's threads all have UUIDs. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface LaunchRequest {
  cwd: string
  args: string[]
}

export interface LaunchCommand {
  /** The folder named, as typed; null: the caller's. */
  dir: string | null
  /** Name, e-mail or id of an account of either CLI. */
  account: string | null
  provider: ProviderId | null
  /** Open the last chat of the folder instead of a new one. */
  continue: boolean
  /** The id of a chat or of a CLI's conversation; `true`: pick one of the folder's chats. */
  resume: string | true | null
  /** A new chat, also when the folder has an open one. */
  newChat: boolean
  /** Sent right away. */
  prompt: string | null
  /** After `--`: for the CLI of a new chat. */
  passthrough: string[]
}

/** What the app does for a call. */
export type LaunchPlan =
  | { kind: 'open'; sessionId: string; prompt: string | null }
  | { kind: 'create'; dir: string; provider: ProviderId; account: string | null; cliArgs: string[]; prompt: string | null }
  /** A conversation of a CLI that no chat has yet: taken over from the accounts' folders. */
  | { kind: 'takeOver'; id: string; prompt: string | null }
  /** The quick open with the folder's chats. */
  | { kind: 'pick'; query: string }

export interface LaunchContext {
  settings: AppSettings
  accounts: readonly Account[]
  projects: readonly Pick<Project, 'id' | 'name' | 'path'>[]
  /** Newest first, as `SessionService.list`. */
  sessions: readonly SessionMeta[]
  /** Chats whose CLI is up or at work (`SessionService.running`). */
  running: ReadonlySet<string>
  home?: string
}

export function readLaunchRequest(argv: readonly string[]): LaunchRequest | null {
  const encoded = argv.find((arg) => arg.startsWith(SWITCH))?.slice(SWITCH.length)
  if (!encoded) return null
  const [cwd, ...args] = Buffer.from(encoded, 'base64').toString('utf8').split('\0')
  return cwd ? { cwd, args } : null
}

/** Checks data coming from another process (`second-instance`) before trusting its shape. */
export function isLaunchRequest(value: unknown): value is LaunchRequest {
  if (!value || typeof value !== 'object') return false
  const { cwd, args } = value as Record<string, unknown>
  return typeof cwd === 'string' && Array.isArray(args) && args.every((a) => typeof a === 'string')
}

export function parseLaunchArgs(args: readonly string[]): LaunchCommand {
  const command: LaunchCommand = {
    dir: null,
    account: null,
    provider: null,
    continue: false,
    resume: null,
    newChat: false,
    prompt: null,
    passthrough: [],
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') {
      command.passthrough.push(...args.slice(i + 1))
      break
    }
    const at = arg.startsWith('-') ? arg.indexOf('=') : -1
    const [flag, inline] = at > 0 ? [arg.slice(0, at), arg.slice(at + 1)] : [arg, null]
    // Switches take no value; `-c=foo` would otherwise drop `foo` without a word.
    const noValue = () => {
      if (inline !== null) throw new Error(`${flag} nimmt keinen Wert („${arg}“).`)
    }
    const setProvider = (provider: ProviderId) => {
      noValue()
      if (command.provider && command.provider !== provider) throw new Error('--claude, --codex und --gemini schließen sich aus.')
      command.provider = provider
    }
    switch (flag) {
      case '-a':
      case '--account': {
        const value = inline ?? args[++i]
        if (!value) throw new Error(`${flag} braucht einen Account-Namen.`)
        command.account = value
        break
      }
      case '-c':
      case '--continue':
        noValue()
        command.continue = true
        break
      case '-r':
      case '--resume': {
        const value = inline ?? (args[i + 1] && ID.test(args[i + 1]) ? args[++i] : null)
        if (value !== null && !ID.test(value)) throw new Error(`„${value}“ ist keine gültige ID.`)
        command.resume = value ?? true
        break
      }
      case '-n':
      case '--new':
        noValue()
        command.newChat = true
        break
      case '--claude':
        setProvider('claude')
        break
      case '--codex':
        setProvider('codex')
        break
      case '--gemini':
        setProvider('gemini')
        break
      case '-m':
      case '--message': {
        const value = inline ?? args[++i]
        if (!value) throw new Error(`${flag} braucht einen Prompt.`)
        command.prompt = value
        break
      }
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unbekannte Option „${arg}“. Argumente für die CLI gehören hinter --, z. B. nx -- --model opus. „nx --help“ zeigt, was geht.`)
        }
        if (command.dir !== null) throw new Error(`Nur ein Ordner geht („${command.dir}“ und „${arg}“).`)
        command.dir = arg
    }
  }

  if (command.continue && command.resume) throw new Error('-c und -r lassen sich nicht kombinieren.')
  if (command.newChat && (command.continue || command.resume)) throw new Error('-n öffnet einen neuen Chat und lässt sich nicht mit -c oder -r kombinieren.')
  if (command.passthrough.length && (command.continue || command.resume)) {
    throw new Error('Argumente für die CLI gelten für einen neuen Chat, nicht mit -c oder -r.')
  }
  if (command.resume && (command.account || command.provider)) {
    throw new Error('-r öffnet einen Chat, wie er ist: -a, --claude, --codex und --gemini gehen damit nicht.')
  }
  if (typeof command.resume === 'string' && command.dir !== null) throw new Error('Mit einer ID braucht -r keinen Ordner.')
  if (command.resume === true && command.prompt) throw new Error('-m geht mit -r nur zusammen mit einer ID.')
  return command
}

/** The CLI new chats start with: the default one, or the first that is on when it is off. */
function defaultProvider(settings: AppSettings): ProviderId {
  const preferred = settings.defaults.provider
  return settings[preferred].enabled ? preferred : (enabledProviders(settings)[0] ?? preferred)
}

const label = (account: Account) => `${account.name} (${PROVIDERS[account.provider].short})`

/**
 * The account `-a` names: by id, name or e-mail, else a unique part of the name (all case-insensitive),
 * among the accounts of `provider`, or of every CLI that is on. A name that fits accounts of both CLIs
 * goes to the CLI new chats start with.
 */
export function findAccount(accounts: readonly Account[], query: string, settings: AppSettings, provider: ProviderId | null): Account {
  const clis = provider ? [provider] : enabledProviders(settings)
  const pool = clis.flatMap((cli) => visibleAccounts(accounts, cli))
  const q = query.trim().toLowerCase()
  const exact = pool.filter((a) => a.id.toLowerCase() === q || a.name.toLowerCase() === q || a.identity.email?.toLowerCase() === q)
  const partial = pool.filter((a) => a.name.toLowerCase().includes(q))
  for (const found of [exact, partial]) {
    if (found.length === 1) return found[0]
    if (found.length === 0) continue
    const preferred = found.filter((a) => a.provider === defaultProvider(settings))
    if (preferred.length === 1) return preferred[0]
    throw new Error(`„${query}“ passt auf mehrere Accounts: ${found.map(label).join(', ')}.`)
  }
  const of = provider ? `${PROVIDERS[provider].name}-Account` : 'Account'
  if (!pool.length) throw new Error(`Kein ${of} vorhanden.`)
  throw new Error(`Kein ${of} „${query}“. Vorhanden: ${pool.map(label).join(', ')}.`)
}

/** The folder of the call: the one named (also `~`), relative to the caller's, else the caller's. */
function launchDir(cwd: string, dir: string | null, home: string): string {
  if (dir === null) return cwd
  const expanded = dir === '~' || /^~[\\/]/.test(dir) ? join(home, dir.slice(1)) : dir
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

/**
 * What a call of `nx` asks for. A chat that is open in the folder (its CLI runs, or it is still empty)
 * is shown instead of a new one, with the setting `general.nxReuseChat`; -n, -m and arguments for the
 * CLI ask for a new one. -a, --claude, --codex and --gemini narrow down the chat -c and the open one may be.
 */
export function resolveLaunch(request: LaunchRequest, context: LaunchContext): LaunchPlan {
  const command = parseLaunchArgs(request.args)
  const { settings } = context

  if (typeof command.resume === 'string') {
    const id = command.resume.toLowerCase()
    // Also a conversation from before a `/clear`: it is still the chat's.
    const holds = (meta: SessionMeta) => [meta.cli, ...(meta.earlierCli ?? [])].some((links) => Object.values(links).some((link) => link?.sessionId.toLowerCase() === id))
    const chat = context.sessions.find((meta) => meta.id.toLowerCase() === id || holds(meta))
    return chat ? { kind: 'open', sessionId: chat.id, prompt: command.prompt } : { kind: 'takeOver', id: command.resume, prompt: command.prompt }
  }

  const dir = launchDir(request.cwd, command.dir, context.home ?? homedir())
  const key = folderKey(dir)
  const project = context.projects.find((p) => folderKey(p.path) === key)
  if (command.resume === true) return { kind: 'pick', query: project?.name ?? baseName(dir) }

  const account = command.account ? findAccount(context.accounts, command.account, settings, command.provider) : null
  const provider = command.provider ?? account?.provider ?? defaultProvider(settings)
  if (provider === 'codex' && command.passthrough.length) {
    const { rest } = codexOverrides(command.passthrough)
    if (rest.length) throw new Error(`Codex nimmt hinter -- nur -c schlüssel=wert (Konfiguration des Threads), nicht „${rest.join(' ')}“.`)
  }

  const accountOf = (meta: SessionMeta) => meta.accounts?.[meta.provider] ?? pickAccount(context.accounts, meta.provider, [settings.defaults.accounts[meta.provider]])
  const fits = (meta: SessionMeta) =>
    !meta.archived && (!command.provider || meta.provider === command.provider) && (!account || (meta.provider === account.provider && accountOf(meta) === account.id))

  if (command.continue) {
    const last = project && context.sessions.find((meta) => meta.projectId === project.id && fits(meta))
    if (last) return { kind: 'open', sessionId: last.id, prompt: command.prompt }
  } else if (settings.general.nxReuseChat && !command.newChat && !command.prompt && !command.passthrough.length) {
    const paths = new Map(context.projects.map((p) => [p.id, p.path]))
    const folderOf = (meta: SessionMeta) => meta.cwd ?? paths.get(meta.projectId)
    const empty = (meta: SessionMeta) => !meta.preview && !meta.importedFrom && Object.keys(meta.cli).length === 0
    const open = context.sessions.find((meta) => {
      const folder = folderOf(meta)
      return !!folder && folderKey(folder) === key && fits(meta) && (context.running.has(meta.id) || empty(meta))
    })
    if (open) return { kind: 'open', sessionId: open.id, prompt: null }
  }
  return { kind: 'create', dir, provider, account: account?.id ?? null, cliArgs: command.passthrough, prompt: command.prompt }
}
