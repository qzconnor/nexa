import { describe, expect, it } from 'vitest'
import { claudeProjectKey, readClaudeLogin, readCodexLogin, withCodexFileStore } from './cli-files'

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
    expect(readClaudeLogin(credentials({ expiresAt: NOW - 1, refreshToken: 'r' }), config, NOW)).toMatchObject({ authState: 'expired', accessToken: null })
    expect(readClaudeLogin(credentials({ expiresAt: NOW - 1 }), config, NOW).authState).toBe('dead')
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
