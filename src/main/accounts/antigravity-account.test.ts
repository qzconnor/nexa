import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { antigravityLogin, antigravitySignedIn } from './antigravity-account'

const dirs: string[] = []

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nexa-agy-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'antigravity-cli', 'log'), { recursive: true })
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('antigravityLogin', () => {
  // With its own token file an account never asks the keyring, so these tests don't either.
  it('reads the Google login an account keeps in its folder', () => {
    const dir = folder()
    expect(antigravityLogin(dir, true).authState).toBe('missing')
    writeFileSync(join(dir, 'antigravity-cli', 'antigravity-oauth-token'), JSON.stringify({ refresh_token: 'r', expiry: '2000-01-01T00:00:00Z' }))
    expect(antigravityLogin(dir, true)).toMatchObject({ authState: 'expired', renewable: true })
    expect(antigravitySignedIn({ set: { AGY_CLI_FORCE_FILE_TOKEN_STORAGE: 'true' }, unset: ['GEMINI_API_KEY'], dir })).toBe(true)
  })

  it('names whom the newest log signed in as', () => {
    const dir = folder()
    writeFileSync(join(dir, 'antigravity-cli', 'antigravity-oauth-token'), '{}')
    const log = (name: string, email: string, at: number) => {
      const file = join(dir, 'antigravity-cli', 'log', name)
      writeFileSync(file, `I1125 02:38:34.814432      48 server_oauth.go:226] OAuth: authenticated successfully as ${email}\n`)
      utimesSync(file, at, at)
    }
    log('acp-server-1.log', 'old@example.com', 1_000)
    log('acp-server-2.log', 'new@example.com', 2_000)
    writeFileSync(join(dir, 'antigravity-cli', 'log', 'cli-3.log'), 'OAuth: authenticated successfully as other@example.com\n')
    expect(antigravityLogin(dir, true).identity.email).toBe('new@example.com')
  })
})
