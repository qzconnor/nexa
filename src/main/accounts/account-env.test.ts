import { describe, expect, it } from 'vitest'
import { accountEnv, ANTIGRAVITY_AUTH_ENV, CLAUDE_AUTH_ENV, CODEX_AUTH_ENV } from './account-env'

describe('accountEnv', () => {
  it('runs the standard accounts as without Nexa', () => {
    expect(accountEnv({ id: 'system', provider: 'claude', kind: 'system', configDir: '/home/me/.claude' }, null)).toEqual({ accountId: 'system', set: {}, unset: [] })
    const codex = accountEnv({ id: 'system-codex', provider: 'codex', kind: 'system', configDir: '/home/me/.codex' }, null)
    expect(codex.set).toEqual({})
    expect(codex.unset).toEqual(CODEX_AUTH_ENV)
  })

  it('gives a browser login its own folder and removes logins from the environment', () => {
    const env = accountEnv({ id: 'a', provider: 'claude', kind: 'oauth', configDir: '/p/a' }, null)
    expect(env.set).toEqual({ CLAUDE_CONFIG_DIR: '/p/a' })
    expect(env.unset).toEqual(CLAUDE_AUTH_ENV)
    expect(accountEnv({ id: 'b', provider: 'codex', kind: 'oauth', configDir: '/p/b' }, null).set).toEqual({ CODEX_HOME: '/p/b' })
  })

  it('hands a token or key over in its variable', () => {
    const token = accountEnv({ id: 't', provider: 'claude', kind: 'token', configDir: '/p/t' }, 'sk-ant-oat01-x')
    expect(token.set).toEqual({ CLAUDE_CONFIG_DIR: '/p/t', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-x' })
    expect(token.unset).not.toContain('CLAUDE_CODE_OAUTH_TOKEN')
    expect(token.unset).toContain('ANTHROPIC_API_KEY')
    const key = accountEnv({ id: 'k', provider: 'claude', kind: 'apiKey', configDir: '/p/k' }, 'sk-ant-api03-x')
    expect(key.set.ANTHROPIC_API_KEY).toBe('sk-ant-api03-x')
  })

  it('runs the standard Antigravity account as it is, an API key with its own folder as --gemini-dir', () => {
    expect(accountEnv({ id: 'system-antigravity', provider: 'antigravity', kind: 'system', configDir: '/home/me/.gemini' }, null)).toEqual({
      accountId: 'system-antigravity',
      set: {},
      unset: [],
    })
    const key = accountEnv({ id: 'k', provider: 'antigravity', kind: 'apiKey', configDir: '/p/k' }, 'AIzaSyX')
    expect(key).toEqual({ accountId: 'k', set: { GEMINI_API_KEY: 'AIzaSyX' }, unset: ANTIGRAVITY_AUTH_ENV.filter((k) => k !== 'GEMINI_API_KEY'), dir: '/p/k' })
    expect(key.unset).toContain('GOOGLE_API_KEY')
    expect(() => accountEnv({ id: 'k', provider: 'antigravity', kind: 'apiKey', configDir: '/p/k' }, null)).toThrow(/Secret/)
  })

  it('refuses a token account without its secret', () => {
    expect(() => accountEnv({ id: 't', provider: 'claude', kind: 'token', configDir: '/p/t' }, null)).toThrow(/Secret/)
  })
})
