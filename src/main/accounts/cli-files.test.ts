import { describe, expect, it } from 'vitest'
import { claudeProjectKey, claudeRenewable, readClaudeLogin, readCodexLogin, refuseRefreshToken, withCodexFileStore } from './cli-files'

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
