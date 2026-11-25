import { describe, expect, it } from 'vitest'
import type { AccountLoginState } from '@shared/accounts'
import { AccountLogins, loginUrlOf, plainOutput } from './account-login'

describe('AccountLogins', () => {
  it('takes the code Antigravity CLI asks for and ends with its exit', async () => {
    // What `agy acp --login` 1.5.17 prints, then a stand-in that waits for the code like it does.
    const url = 'https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=x.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&state=s'
    const agy = [
      `process.stdout.write('Open this link in a browser to log in with Google:\\n\\n  ${url}\\n\\nThen paste the authorization code, or the full URL of the page you land on, and press Enter:\\n')`,
      "process.stdin.once('data', (d) => { process.stdout.write(String(d).trim() === 'good' ? 'Logged in.\\n' : 'no\\n'); process.exit(String(d).trim() === 'good' ? 0 : 1) })",
    ].join(';')
    const logins = new AccountLogins()
    const states: AccountLoginState[] = []
    logins.on('state', (s) => states.push(s))
    logins.start('antigravity', { file: process.execPath, args: ['-e', agy] }, { accountId: 'g', set: {}, unset: [] })
    await expect.poll(() => states.at(-1)?.acceptsCode, { timeout: 5000 }).toBe(true)
    expect(states.at(-1)).toMatchObject({ status: 'waiting', url })
    logins.sendCode('g', 'good')
    await expect.poll(() => states.at(-1)?.status, { timeout: 5000 }).toBe('success')
  })
})

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
