import type { ProviderId } from '@shared/chat'
import type { AccountKind } from '@shared/accounts'

/** Variables that make Claude Code use another login than the one of its config folder. */
export const CLAUDE_AUTH_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
]

/** Variables that make Codex use another login than the one of its CODEX_HOME. */
export const CODEX_AUTH_ENV = ['CODEX_API_KEY', 'OPENAI_API_KEY']

/**
 * Variables that make Gemini CLI sign in another way than its `.gemini` folder says. GEMINI_CLI_HOME
 * is not among them: the standard account keeps the one the app was started with.
 */
export const GEMINI_AUTH_ENV = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'GOOGLE_GENAI_USE_GCA',
  'GOOGLE_CLOUD_ACCESS_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
]

/** How a CLI is started as an account: variables to set, and inherited ones to remove. */
export interface AccountEnv {
  accountId: string
  set: Record<string, string>
  unset: string[]
}

export interface EnvAccount {
  id: string
  provider: ProviderId
  kind: AccountKind
  configDir: string
}

/**
 * The environment of a CLI for an account. The standard account runs as without Nexa (whatever
 * CLAUDE_CONFIG_DIR, CODEX_HOME or GEMINI_CLI_HOME the app was started with); every other one with
 * its own folder, and a token or API key in the variable that makes the CLI use it.
 */
export function accountEnv(account: EnvAccount, secret: string | null): AccountEnv {
  const { id, provider, kind, configDir } = account
  if (provider === 'gemini') {
    if (kind === 'system') return { accountId: id, set: {}, unset: [] }
    // GEMINI_CLI_HOME is the folder Gemini CLI takes for the home: its files go to `<folder>/.gemini`.
    const set: Record<string, string> = { GEMINI_CLI_HOME: configDir }
    if (kind === 'apiKey') {
      if (!secret) throw new Error('Für diesen Account ist kein gültiges Secret gespeichert. Bitte unter Einstellungen → Accounts neu eintragen.')
      set.GEMINI_API_KEY = secret
    }
    return { accountId: id, set, unset: GEMINI_AUTH_ENV.filter((key) => !(key in set)) }
  }
  if (provider === 'codex') {
    if (kind === 'system') return { accountId: id, set: {}, unset: [...CODEX_AUTH_ENV] }
    return { accountId: id, set: { CODEX_HOME: configDir }, unset: [...CODEX_AUTH_ENV] }
  }
  if (kind === 'system') return { accountId: id, set: {}, unset: [] }
  const set: Record<string, string> = { CLAUDE_CONFIG_DIR: configDir }
  if (kind === 'token' || kind === 'apiKey') {
    if (!secret) throw new Error('Für diesen Account ist kein gültiges Secret gespeichert. Bitte unter Einstellungen → Accounts neu eintragen.')
    set[kind === 'token' ? 'CLAUDE_CODE_OAUTH_TOKEN' : 'ANTHROPIC_API_KEY'] = secret
  }
  return { accountId: id, set, unset: CLAUDE_AUTH_ENV.filter((key) => !(key in set)) }
}
