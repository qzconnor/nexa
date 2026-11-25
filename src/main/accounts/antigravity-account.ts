import { execFile } from 'node:child_process'
import { readJsonFile, updateJsonFile } from '../providers/cli-config'
import { ANTIGRAVITY_KEYRING_TARGET, antigravityPaths, keyringListsLogin, NO_IDENTITY, type LoginInfo } from './cli-files'

/**
 * The standard account's login: the keyring names no person and no expiry. One Nexa can't see counts
 * as there; Antigravity says otherwise at the first prompt.
 */
export function antigravityLogin(now = Date.now()): LoginInfo {
  return {
    authState: antigravityLoggedIn(now) === false ? 'missing' : 'ok',
    identity: { ...NO_IDENTITY },
    tokenExpiresAt: null,
    loginEndsAt: null,
    tokenSavedAt: null,
    renewable: false,
    accessToken: null,
  }
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

/** How long a look into the keyring holds: the accounts are read every 15 seconds. */
const FRESH_MS = 30_000

let known: { loggedIn: boolean | null; at: number } | null = null
let looking: Promise<boolean | null> | null = null

/**
 * Whether Antigravity CLI's Google login is in the keyring, as last seen; null while unknown (not
 * looked yet, or a system whose keyring Nexa can't read without asking: macOS, Linux). A stale answer
 * starts a new look and is given meanwhile, so the account list never waits for `cmdkey`.
 */
export function antigravityLoggedIn(now = Date.now()): boolean | null {
  if (!known || now - known.at > FRESH_MS) void refreshAntigravityLogin()
  return known?.loggedIn ?? null
}

/** Looks into the keyring now (the login may just have changed). */
export function refreshAntigravityLogin(): Promise<boolean | null> {
  if (process.platform !== 'win32') {
    known = { loggedIn: null, at: Date.now() }
    return Promise.resolve(null)
  }
  looking ??= new Promise<boolean | null>((resolve) => {
    // Only the entry's target is read; cmdkey never prints a password.
    execFile('cmdkey', [`/list:${ANTIGRAVITY_KEYRING_TARGET}`], { windowsHide: true, timeout: 10_000 }, (_error, stdout) => {
      // Without an entry cmdkey may end with an error code; what it printed still tells.
      const loggedIn = stdout?.trim() ? keyringListsLogin(stdout) : null
      known = { loggedIn, at: Date.now() }
      resolve(loggedIn)
    })
  }).finally(() => (looking = null))
  return looking
}
