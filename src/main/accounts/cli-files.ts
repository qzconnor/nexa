import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { AccountIdentity, AuthState } from '@shared/accounts'
import { isPlainObject } from '@shared/utils'

/**
 * Where the CLIs keep the login of a config folder, and what Nexa reads from it. The tokens never
 * leave the main process; the window only learns who is signed in and whether it still holds.
 */

export const NO_IDENTITY: AccountIdentity = {
  email: null,
  displayName: null,
  organizationName: null,
  organizationType: null,
  subscriptionType: null,
}

export interface LoginInfo {
  authState: AuthState
  identity: AccountIdentity
  tokenExpiresAt: string | null
  /** When the refresh token runs out (Claude); then only signing in again helps. */
  loginEndsAt: string | null
  /** When the CLI (or Nexa) last saved the tokens. */
  tokenSavedAt: string | null
  /** A refresh token that may still work. */
  renewable: boolean
  /** OAuth access token, only for reading the plan limits (Claude). */
  accessToken: string | null
}

/** Nobody signed in (the identity is filled in fresh, it gets handed out). */
const NO_LOGIN: Omit<LoginInfo, 'identity'> = {
  authState: 'missing',
  tokenExpiresAt: null,
  loginEndsAt: null,
  tokenSavedAt: null,
  renewable: false,
  accessToken: null,
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isoTime(ms: unknown): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null
}

// ---------------------------------------------------------------------------------------------
// Claude Code

export interface ClaudePaths {
  configDir: string
  credentialsFile: string
  /** `.claude.json`: in the home folder for `~/.claude`, inside the folder for CLAUDE_CONFIG_DIR. */
  globalConfigFile: string
  projectsDir: string
}

export function defaultClaudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude')
}

/** Mirrors Claude Code's own lookup; `viaEnv`: the folder comes through CLAUDE_CONFIG_DIR. */
export function claudePaths(configDir: string, viaEnv: boolean): ClaudePaths {
  const legacy = join(configDir, '.config.json')
  let globalConfigFile = join(viaEnv ? configDir : homedir(), '.claude.json')
  try {
    const st = statSync(legacy)
    if (st.isFile() && st.size > 0) globalConfigFile = legacy
  } catch {
    // No legacy file.
  }
  return { configDir, credentialsFile: join(configDir, '.credentials.json'), globalConfigFile, projectsDir: join(configDir, 'projects') }
}

/** Claude Code shortens the name of a project folder longer than this, with a hash of the path. */
const MAX_PROJECT_KEY = 200

/** Claude Code's project folder name for a working directory. */
export function claudeProjectKey(cwd: string): string {
  const key = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (key.length <= MAX_PROJECT_KEY) return key
  // As Claude Code hashes it.
  let hash = 0
  for (let i = 0; i < cwd.length; i++) hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0
  return `${key.slice(0, MAX_PROJECT_KEY)}-${Math.abs(hash).toString(36)}`
}

/** Refresh tokens Anthropic refused (by hash): they never work again, their login is dead. */
const refusedRefreshTokens = new Set<string>()

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32)
}

/** Anthropic answered `invalid_grant` for this refresh token (see claude-renewal.ts). */
export function refuseRefreshToken(token: string): void {
  refusedRefreshTokens.add(tokenHash(token))
}

/**
 * Whether a Claude login (`claudeAiOauth`) can still get new access tokens, on Claude Code's terms: a
 * refresh token that hasn't run out or been refused, and the scope to ask for inference with.
 */
export function claudeRenewable(oauth: Record<string, unknown>, now = Date.now()): boolean {
  const refreshToken = text(oauth.refreshToken)
  if (!refreshToken) return false
  const scopes = oauth.scopes
  if (!Array.isArray(scopes) || !scopes.every((s) => typeof s === 'string') || !scopes.includes('user:inference')) return false
  if (typeof oauth.refreshTokenExpiresAt === 'number' && oauth.refreshTokenExpiresAt <= now) return false
  return !refusedRefreshTokens.has(tokenHash(refreshToken))
}

/**
 * The login of a Claude Code folder from its `.credentials.json` and `.claude.json`. The config may
 * still name a previous login; it only counts when its plan fits the stored credentials. `savedAt`:
 * when the credentials file was written last.
 */
export function readClaudeLogin(credentials: unknown, config: unknown, now = Date.now(), savedAt: number | null = null): LoginInfo {
  const oauth = isPlainObject(credentials) && isPlainObject(credentials.claudeAiOauth) ? credentials.claudeAiOauth : null
  const accessToken = text(oauth?.accessToken)
  const subscriptionType = text(oauth?.subscriptionType)
  if (!oauth || !accessToken) return { ...NO_LOGIN, identity: { ...NO_IDENTITY } }
  const expires = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null
  const renewable = claudeRenewable(oauth, now)
  const account = isPlainObject(config) && isPlainObject(config.oauthAccount) ? config.oauthAccount : null
  const organizationType = text(account?.organizationType)
  const fits = !organizationType?.startsWith('claude_') || !subscriptionType || organizationType.slice(7) === subscriptionType.toLowerCase()
  const known = account && fits ? account : null
  return {
    authState: expires !== null && expires <= now ? (renewable ? 'expired' : 'dead') : 'ok',
    identity: {
      email: text(known?.emailAddress),
      displayName: text(known?.displayName),
      organizationName: text(known?.organizationName),
      organizationType: known ? organizationType : null,
      subscriptionType,
    },
    tokenExpiresAt: expires !== null ? new Date(expires).toISOString() : null,
    loginEndsAt: isoTime(oauth.refreshTokenExpiresAt),
    tokenSavedAt: isoTime(savedAt),
    renewable,
    accessToken: expires !== null && expires <= now ? null : accessToken,
  }
}

// ---------------------------------------------------------------------------------------------
// Codex

export interface CodexPaths {
  /** CODEX_HOME */
  configDir: string
  authFile: string
  configFile: string
  /** `sessions/<yyyy>/<mm>/<dd>/rollout-<time>-<thread id>.jsonl` */
  sessionsDir: string
}

export function defaultCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(homedir(), '.codex')
}

export function codexPaths(configDir: string): CodexPaths {
  return {
    configDir,
    authFile: join(configDir, 'auth.json'),
    configFile: join(configDir, 'config.toml'),
    sessionsDir: join(configDir, 'sessions'),
  }
}

/** The claims of a JWT, unchecked: Nexa only shows them, Codex and OpenAI check the token. */
export function jwtClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string') return null
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return isPlainObject(claims) ? claims : null
  } catch {
    return null
  }
}

/**
 * The login of a CODEX_HOME from its `auth.json`. A ChatGPT login names the person and plan in its
 * id token; with an expired access token it still counts, Codex renews it at the next start
 * (`last_refresh` says when it did last).
 */
export function readCodexLogin(file: unknown, now = Date.now()): LoginInfo & { apiKey: boolean } {
  const empty: LoginInfo & { apiKey: boolean } = { ...NO_LOGIN, identity: { ...NO_IDENTITY }, apiKey: false }
  if (!isPlainObject(file)) return empty
  const tokens = isPlainObject(file.tokens) ? file.tokens : null
  if (!tokens || (!text(tokens.access_token) && !text(tokens.id_token))) {
    return text(file.OPENAI_API_KEY) ? { ...empty, authState: 'ok', apiKey: true } : empty
  }
  const id = jwtClaims(tokens.id_token) ?? {}
  const access = jwtClaims(tokens.access_token) ?? {}
  const auth = isPlainObject(id['https://api.openai.com/auth']) ? id['https://api.openai.com/auth'] : {}
  const accessAuth = isPlainObject(access['https://api.openai.com/auth']) ? access['https://api.openai.com/auth'] : {}
  const profile = isPlainObject(access['https://api.openai.com/profile']) ? access['https://api.openai.com/profile'] : {}
  const plan = text(auth.chatgpt_plan_type) ?? text(accessAuth.chatgpt_plan_type)
  const organizations = Array.isArray(auth.organizations) ? auth.organizations.filter(isPlainObject) : []
  const workspace = organizations.find((o) => o.is_default === true) ?? organizations[0]
  const exp = typeof access.exp === 'number' ? access.exp * 1000 : null
  const saved = Date.parse(text(file.last_refresh) ?? '')
  return {
    authState: exp !== null && exp <= now ? 'expired' : 'ok',
    identity: {
      email: text(id.email) ?? text(profile.email),
      displayName: text(id.name) ?? text(profile.name),
      organizationName: text(workspace?.title),
      organizationType: plan ? `chatgpt_${plan}` : null,
      subscriptionType: plan,
    },
    tokenExpiresAt: exp !== null ? new Date(exp).toISOString() : null,
    loginEndsAt: null,
    tokenSavedAt: isoTime(saved),
    renewable: !!text(tokens.refresh_token),
    accessToken: null,
    apiKey: false,
  }
}

/** Codex keeps the login of a folder in its `auth.json` instead of the keyring: every account has its own. */
export const CODEX_FILE_STORE = 'cli_auth_credentials_store = "file"'
const CODEX_STORE_RE = /^\s*cli_auth_credentials_store\s*=/m

/** `config.toml` with the file store, unless it already says where logins go. */
export function withCodexFileStore(config: string): string | null {
  if (CODEX_STORE_RE.test(config)) return null
  // Top-level keys come before the first table.
  return config ? `${CODEX_FILE_STORE}\n\n${config}` : `${CODEX_FILE_STORE}\n`
}
