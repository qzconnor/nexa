import { describe, expect, it } from 'vitest'
import {
  claudeProjectKey,
  antigravityLogEmail,
  antigravityPaths,
  claudeRenewable,
  keyringListsLogin,
  readAntigravityToken,
  readClaudeLogin,
  readCodexLogin,
  refuseRefreshToken,
  secretServiceListsLogin,
  withCodexFileStore,
} from './cli-files'

const NOW = Date.parse('2026-11-23T12:00:00Z')

function jwt(claims: Record<string, unknown>): string {
  return `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`
}

describe('readClaudeLogin', () => {
  const credentials = (oauth: Record<string, unknown>) => ({ claudeAiOauth: { accessToken: 'sk-ant-oat', subscriptionType: 'max', ...oauth } })
  const config = { oauthAccount: { emailAddress: 'a@b.de', organizationName: 'Firma', organizationType: 'claude_max' } }

  it('knows nobody without credentials', () => {
    expect(readClaudeLogin(null, config, NOW)).toMatchObject({ authState: 'missing', accessToken: null, identity: { email: null } })
  })

  it('reads who is signed in and keeps the token while it holds', () => {
    const login = readClaudeLogin(credentials({ expiresAt: NOW + 60_000, refreshToken: 'r' }), config, NOW)
    expect(login.authState).toBe('ok')
    expect(login.accessToken).toBe('sk-ant-oat')
    expect(login.identity).toMatchObject({ email: 'a@b.de', organizationName: 'Firma', subscriptionType: 'max' })
  })

  it('tells an expired token that renews from one that needs a new login', () => {
    const renewable = { refreshToken: 'r', scopes: ['user:inference', 'user:profile'] }
    expect(readClaudeLogin(credentials({ expiresAt: NOW - 1, ...renewable }), config, NOW)).toMatchObject({
      authState: 'expired',
      renewable: true,
      accessToken: null,
    })
    expect(readClaudeLogin(credentials({ expiresAt: NOW - 1 }), config, NOW)).toMatchObject({ authState: 'dead', renewable: false })
    // Claude Code renews only a login that may ask for inference, with a refresh token that still holds.
    expect(readClaudeLogin(credentials({ expiresAt: NOW - 1, ...renewable, scopes: ['user:profile'] }), config, NOW).authState).toBe('dead')
    expect(readClaudeLogin(credentials({ expiresAt: NOW - 1, ...renewable, refreshTokenExpiresAt: NOW }), config, NOW).authState).toBe('dead')
  })

  it('counts a login whose refresh token Anthropic refused as dead', () => {
    const oauth = { expiresAt: NOW - 1, refreshToken: 'refused-once', scopes: ['user:inference'] }
    expect(claudeRenewable(oauth, NOW)).toBe(true)
    refuseRefreshToken('refused-once')
    expect(claudeRenewable(oauth, NOW)).toBe(false)
    expect(readClaudeLogin(credentials(oauth), config, NOW).authState).toBe('dead')
    expect(claudeRenewable({ ...oauth, refreshToken: 'another' }, NOW)).toBe(true)
  })

  it('tells when the login ends and when its tokens were saved', () => {
    const login = readClaudeLogin(
      credentials({ expiresAt: NOW + 60_000, refreshToken: 'r', scopes: ['user:inference'], refreshTokenExpiresAt: Date.parse('2026-12-23T12:00:00Z') }),
      config,
      NOW,
      Date.parse('2026-11-23T11:00:00Z'),
    )
    expect(login).toMatchObject({ loginEndsAt: '2026-12-23T12:00:00.000Z', tokenSavedAt: '2026-11-23T11:00:00.000Z', renewable: true })
    expect(readClaudeLogin(credentials({ refreshTokenExpiresAt: 'bald' }), config, NOW)).toMatchObject({ loginEndsAt: null, tokenSavedAt: null })
  })

  it('ignores a config that still names a login of another plan', () => {
    const login = readClaudeLogin(credentials({ subscriptionType: 'pro' }), config, NOW)
    expect(login.identity.email).toBeNull()
    expect(login.identity.subscriptionType).toBe('pro')
  })
})

describe('readCodexLogin', () => {
  it('reads person, plan and workspace from the tokens', () => {
    const file = {
      tokens: {
        id_token: jwt({
          email: 'c@d.de',
          'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', organizations: [{ id: 'o1', title: 'Team', is_default: true }] },
        }),
        access_token: jwt({ exp: (NOW + 60_000) / 1000 }),
        refresh_token: 'r',
      },
    }
    const login = readCodexLogin(file, NOW)
    expect(login.authState).toBe('ok')
    expect(login.identity).toMatchObject({ email: 'c@d.de', subscriptionType: 'plus', organizationName: 'Team', organizationType: 'chatgpt_plus' })
  })

  it('tells when Codex saved the tokens last and whether it can renew them', () => {
    const tokens = { access_token: jwt({ exp: (NOW + 60_000) / 1000 }) }
    expect(readCodexLogin({ tokens: { ...tokens, refresh_token: 'r' }, last_refresh: '2026-11-20T08:30:00Z' }, NOW)).toMatchObject({
      tokenSavedAt: '2026-11-20T08:30:00.000Z',
      renewable: true,
      loginEndsAt: null,
    })
    expect(readCodexLogin({ tokens, last_refresh: 'gestern' }, NOW)).toMatchObject({ tokenSavedAt: null, renewable: false })
  })

  it('counts an expired access token as expired, an API key as signed in', () => {
    expect(readCodexLogin({ tokens: { access_token: jwt({ exp: (NOW - 1000) / 1000 }) } }, NOW).authState).toBe('expired')
    expect(readCodexLogin({ OPENAI_API_KEY: 'sk-x' }, NOW)).toMatchObject({ authState: 'ok', apiKey: true })
    expect(readCodexLogin({}, NOW).authState).toBe('missing')
  })
})

describe('keyringListsLogin', () => {
  it('finds the login of Antigravity CLI in what cmdkey prints, in any language', () => {
    // `cmdkey /list:gemini:antigravity` on a German Windows 11, the user field left out.
    const german = '\r\nAktuell gespeicherte Anmeldeinformationen:\r\n\r\n    Ziel: gemini:antigravity\r\n    Typ: Generisch \r\n    Lokaler Computer\r\n\r\n'
    expect(keyringListsLogin(german)).toBe(true)
    expect(keyringListsLogin('Currently stored credentials:\n\n    Target: LegacyGeneric:target=gemini:antigravity\n    Type: Generic\n')).toBe(true)
    expect(keyringListsLogin('\r\nAktuell gespeicherte Anmeldeinformationen:\r\n\r\n* KEINE *\r\n')).toBe(false)
    expect(keyringListsLogin('    Ziel: gemini:antigravity-other\r\n')).toBe(false)
  })

  it('knows where a .gemini folder keeps what Nexa reads and writes', () => {
    const paths = antigravityPaths('/p/k')
    expect(paths.settingsFile.replace(/\\/g, '/')).toBe('/p/k/antigravity-cli/settings.json')
    expect(paths.mcpFile.replace(/\\/g, '/')).toBe('/p/k/config/mcp_config.json')
    expect(paths.conversationsDir.replace(/\\/g, '/')).toBe('/p/k/antigravity-cli/conversations')
    expect(paths.projectFile.replace(/\\/g, '/')).toBe('/p/k/config/projects/default-cli-project.json')
    // Where Antigravity CLI 1.5.17 read a token with AGY_CLI_FORCE_FILE_TOKEN_STORAGE=true.
    expect(paths.tokenFile.replace(/\\/g, '/')).toBe('/p/k/antigravity-cli/antigravity-oauth-token')
  })
})

describe('secretServiceListsLogin', () => {
  it('reads what gdbus answers to SearchItems', () => {
    expect(secretServiceListsLogin("([objectpath '/org/freedesktop/secrets/collection/login/3'], @ao [])\n")).toBe(true)
    // A locked keyring still holds the login.
    expect(secretServiceListsLogin("(@ao [], [objectpath '/org/freedesktop/secrets/collection/login/3'])")).toBe(true)
    expect(secretServiceListsLogin('(@ao [], @ao [])\n')).toBe(false)
    expect(secretServiceListsLogin('')).toBeNull()
  })
})

describe('readAntigravityToken', () => {
  const now = Date.parse('2026-11-25T10:00:00Z')

  it('takes an OAuth token with its expiry and refresh token', () => {
    const token = { access_token: 'a', token_type: 'Bearer', refresh_token: 'r', expiry: '2026-11-25T11:00:00+01:00' }
    expect(readAntigravityToken(token, now, now - 1000)).toMatchObject({
      authState: 'expired',
      tokenExpiresAt: '2026-11-25T10:00:00.000Z',
      tokenSavedAt: new Date(now - 1000).toISOString(),
      renewable: true,
      accessToken: null,
    })
    expect(readAntigravityToken({ token: { ...token, expiry: '2026-11-25T12:00:00Z' } }, now).authState).toBe('ok')
    expect(readAntigravityToken({ ...token, refresh_token: '' }, now).authState).toBe('dead')
  })

  it('counts a token it can not read as a login, and none as none', () => {
    expect(readAntigravityToken({}, now).authState).toBe('ok')
    expect(readAntigravityToken('?', now).authState).toBe('ok')
    expect(readAntigravityToken(null, now).authState).toBe('missing')
  })
})

describe('antigravityLogEmail', () => {
  it('finds whom agy acp signed in as, the newest line first', () => {
    const log = [
      'I1125 02:38:34.814432      48 server_oauth.go:221] applyAuthResult: email=old@example.com, authMethod=consumer, quotaProject=',
      'I1125 02:38:34.814432      48 server_oauth.go:226] OAuth: authenticated successfully as new@example.com',
      'W1125 02:38:34.804669     102 rpcs_plugin_auth.go:110] Not reloading plugin MCP servers: cannot get the signed-in user',
    ].join('\n')
    expect(antigravityLogEmail(log)).toBe('new@example.com')
    expect(antigravityLogEmail('error getting token source: You are not logged into Antigravity.')).toBeNull()
  })
})

describe('withCodexFileStore', () => {
  it('puts the setting before the first table and leaves a chosen store alone', () => {
    expect(withCodexFileStore('')).toBe('cli_auth_credentials_store = "file"\n')
    expect(withCodexFileStore('[mcp_servers.x]\nurl = "y"\n')).toMatch(/^cli_auth_credentials_store = "file"\n\n\[mcp_servers/)
    expect(withCodexFileStore('cli_auth_credentials_store = "keyring"\n')).toBeNull()
  })
})

describe('claudeProjectKey', () => {
  it('names project folders as Claude Code does', () => {
    expect(claudeProjectKey('F:\\Projekte\\Apps\\nexa')).toBe('F--Projekte-Apps-nexa')
    expect(claudeProjectKey('/home/me/my.app')).toBe('-home-me-my-app')
  })

  it('shortens long paths with a hash, like Claude Code', () => {
    const long = `F:\\${'a'.repeat(250)}`
    const key = claudeProjectKey(long)
    expect(key.startsWith(`F--${'a'.repeat(197)}-`)).toBe(true)
    expect(key.length).toBeGreaterThan(201)
    expect(claudeProjectKey(long)).toBe(key)
    expect(claudeProjectKey(`${long}b`)).not.toBe(key)
  })
})
