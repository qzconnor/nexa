import { execFile } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { AccountIdentity } from '@shared/accounts'
import { readJsonFile, updateJsonFile } from '../providers/cli-config'
import type { AccountEnv } from './account-env'
import {
  ANTIGRAVITY_FILE_TOKENS,
  ANTIGRAVITY_KEYRING,
  ANTIGRAVITY_KEYRING_TARGET,
  antigravityLogEmail,
  antigravityPaths,
  defaultAntigravityDir,
  keyringListsLogin,
  NO_IDENTITY,
  readAntigravityToken,
  secretServiceListsLogin,
  type LoginInfo,
} from './cli-files'

/**
 * The Google login of an Antigravity account. `fileTokens`: the account keeps it in its own folder
 * (Nexa's Google accounts); else it is the keyring's, one per user (the standard account), or the
 * folder's token file when Antigravity CLI couldn't reach the keyring. A keyring Nexa can't look into
 * counts as signed in: Antigravity says otherwise at the first prompt.
 */
export function antigravityLogin(dir: string, fileTokens: boolean, now = Date.now()): LoginInfo {
  const file = readTokenFile(antigravityPaths(dir).tokenFile, now)
  // The keyring's login names no expiry.
  const login = file ?? (!fileTokens && antigravityKeyring(now) !== false ? readAntigravityToken({}, now) : null)
  if (!login) return { ...readAntigravityToken(null), identity: { ...NO_IDENTITY } }
  return { ...login, identity: antigravityIdentity(dir) }
}

function readTokenFile(file: string, now: number): Omit<LoginInfo, 'identity'> | null {
  try {
    const savedAt = statSync(file).mtimeMs
    const raw = readFileSync(file, 'utf8')
    let json: unknown = {}
    try {
      json = JSON.parse(raw)
    } catch {
      // A token Nexa can't read is still Antigravity's to judge.
    }
    return readAntigravityToken(json, now, savedAt)
  } catch {
    return null
  }
}

/** Whether the account starts signed in: with an API key (its own or Nexa's inherited one), or a Google login. */
export function antigravitySignedIn(env: Pick<AccountEnv, 'set' | 'unset' | 'dir'>): boolean {
  if (env.set.GEMINI_API_KEY || (process.env.GEMINI_API_KEY && !env.unset.includes('GEMINI_API_KEY'))) return true
  return antigravityLogin(env.dir ?? defaultAntigravityDir(), env.set[ANTIGRAVITY_FILE_TOKENS] === 'true').authState !== 'missing'
}

/**
 * An API key works only with `modelProvider: "gemini"` in the folder's settings; without it
 * Antigravity asks for the Google login. Written at the account's start and before every start of
 * the CLI: the folder may be new or reset.
 */
export async function ensureApiKeySettings(dir: string): Promise<void> {
  const file = antigravityPaths(dir).settingsFile
  if ((await readJsonFile(file))?.modelProvider === 'gemini') return
  await updateJsonFile(file, (data) => {
    data.modelProvider = 'gemini'
  })
}

// ---------------------------------------------------------------------------------------------
// Who is signed in: the keyring and the token name nobody, but every start of `agy acp` logs it.

/** How many of the newest logs are read for the name: older ones belong to earlier logins. */
const LOGS_READ = 5

const emails = new Map<string, { key: string; email: string | null }>()

/** The Google account the folder's last `agy acp` signed in as. */
export function antigravityIdentity(dir: string): AccountIdentity {
  const { logDir } = antigravityPaths(dir)
  let logs: { file: string; at: number }[]
  try {
    logs = readdirSync(logDir)
      .filter((name) => /^acp-server-.*\.log$/.test(name))
      .map((name) => ({ file: join(logDir, name), at: statSync(join(logDir, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(0, LOGS_READ)
  } catch {
    return { ...NO_IDENTITY }
  }
  // Read again only when a newer log came.
  const key = logs.map((l) => `${l.file}:${l.at}`).join('|')
  let known = emails.get(dir)
  if (known?.key !== key) {
    let email: string | null = null
    for (const log of logs) {
      try {
        email = antigravityLogEmail(readFileSync(log.file, 'utf8'))
      } catch {
        email = null
      }
      if (email) break
    }
    known = { key, email }
    emails.set(dir, known)
  }
  return { ...NO_IDENTITY, email: known.email }
}

// ---------------------------------------------------------------------------------------------
// The keyring: only whether the entry is there, never its secret.

/** How long a look into the keyring holds: the accounts are read every 15 seconds. */
const FRESH_MS = 30_000

let known: { loggedIn: boolean | null; at: number } | null = null
let looking: Promise<boolean | null> | null = null

/**
 * Whether Antigravity CLI's Google login is in the keyring, as last seen; null while unknown (not
 * looked yet, or no way to look). A stale answer starts a new look and is given meanwhile, so the
 * account list never waits for the keyring.
 */
export function antigravityKeyring(now = Date.now()): boolean | null {
  if (!known || now - known.at > FRESH_MS) void refreshAntigravityKeyring()
  return known?.loggedIn ?? null
}

/** Looks into the keyring now (the login may just have changed). */
export function refreshAntigravityKeyring(): Promise<boolean | null> {
  looking ??= lookIntoKeyring()
    .catch(() => null)
    .then((loggedIn) => {
      known = { loggedIn, at: Date.now() }
      return loggedIn
    })
    .finally(() => (looking = null))
  return looking
}

function lookIntoKeyring(): Promise<boolean | null> {
  const { service, user } = ANTIGRAVITY_KEYRING
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // Only the entry's target is read; cmdkey never prints a password.
      execFile('cmdkey', [`/list:${ANTIGRAVITY_KEYRING_TARGET}`], { windowsHide: true, timeout: 10_000 }, (_error, stdout) => {
        // Without an entry cmdkey may end with an error code; what it printed still tells.
        resolve(stdout?.trim() ? keyringListsLogin(stdout) : null)
      })
    } else if (process.platform === 'darwin') {
      // Without -w or -g `security` prints the item's attributes only, so the keychain asks nothing.
      execFile('security', ['find-generic-password', '-s', service, '-a', user], { timeout: 10_000 }, (error) => {
        const code = (error as { code?: unknown } | null)?.code
        resolve(!error ? true : code === 44 ? false : null)
      })
    } else {
      // The Secret Service's search names items, not secrets (`secret-tool search` would print them).
      const args = ['call', '--session', '--dest', 'org.freedesktop.secrets', '--object-path', '/org/freedesktop/secrets']
      args.push('--method', 'org.freedesktop.Secret.Service.SearchItems', `{'service': '${service}', 'username': '${user}'}`)
      execFile('gdbus', args, { timeout: 10_000 }, (error, stdout) => resolve(error ? null : secretServiceListsLogin(stdout)))
    }
  })
}
