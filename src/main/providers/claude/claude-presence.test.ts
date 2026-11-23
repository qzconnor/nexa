import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeOpenElsewhere, whereOpen } from './claude-presence'

describe('claudeOpenElsewhere', () => {
  let dir: string
  const entry = (pid: number, sessionId: string, entrypoint: string) =>
    writeFile(join(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: 'F:\\Code\\app', kind: 'interactive', entrypoint }))

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-presence-'))
    await mkdir(join(dir, 'sessions'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('finds a running process with the session open and names where it runs', async () => {
    await entry(process.pid, 's1', 'cli')
    expect(await claudeOpenElsewhere(dir, 's1')).toEqual({ pid: process.pid, where: 'Claude Code im Terminal' })
  })

  it('passes over Nexa’s own run, other sessions and processes that are gone', async () => {
    await entry(process.pid, 's1', 'sdk-ts')
    await entry(2_147_483_000, 's2', 'cli')
    await writeFile(join(dir, 'sessions', 'kaputt.json'), '{')
    expect(await claudeOpenElsewhere(dir, 's1', process.pid)).toBeNull()
    expect(await claudeOpenElsewhere(dir, 's2')).toBeNull()
    expect(await claudeOpenElsewhere(join(dir, 'fehlt'), 's1')).toBeNull()
  })

  it('says where in words', () => {
    expect(whereOpen('claude-desktop')).toBe('Claude Desktop')
    expect(whereOpen('sdk-ts')).toBe('einem anderen Programm')
  })
})
