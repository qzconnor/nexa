import { afterEach, describe, expect, it, vi } from 'vitest'
import { cliEnv } from './cli-binary'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

describe('cliEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("switches Antigravity CLI's own updater off, whose console popped up as a window", () => {
    expect(cliEnv().AGY_CLI_DISABLE_AUTO_UPDATE).toBe('true')
    vi.stubEnv('AGY_CLI_DISABLE_AUTO_UPDATE', '1')
    expect(cliEnv().AGY_CLI_DISABLE_AUTO_UPDATE).toBe('true')
  })

  it('leaves out the variables of a parent Claude Code session and removes those asked for', () => {
    vi.stubEnv('CLAUDECODE', '1')
    vi.stubEnv('NEXA_TEST_LOGIN', 'x')
    const env = cliEnv({ EXTRA: 'y' }, ['nexa_test_login'])
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.NEXA_TEST_LOGIN).toBeUndefined()
    expect(env.EXTRA).toBe('y')
  })
})
