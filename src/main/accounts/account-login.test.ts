import { describe, expect, it } from 'vitest'
import { loginUrlOf, plainOutput } from './account-login'

describe('loginUrlOf', () => {
  it('finds the link Claude Code prints as a terminal link', () => {
    const url = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz'
    const output = `Opening browser to sign in…\nIf the browser didn't open, visit:\n\x1b]8;;${url}\x07${url}\x1b]8;;\x07\nPaste code here if prompted > `
    expect(loginUrlOf(output)).toBe(url)
  })

  it('skips the local server Codex names first', () => {
    const output =
      'Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\nhttps://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x\n'
    expect(loginUrlOf(output)).toBe('https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_x')
  })

  it('has nothing before the link came', () => {
    expect(loginUrlOf('Opening browser to sign in…')).toBeNull()
  })
})

describe('plainOutput', () => {
  it('removes colors and carriage returns', () => {
    expect(plainOutput('\x1b[32mLogin successful.\x1b[0m\r\n')).toBe('Login successful.\n')
  })
})
