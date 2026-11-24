import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudePaths, claudeProjectKey, codexPaths } from './cli-files'
import { codexRolloutDays, copyClaudeSession, copyCodexThread, ensureClaudeSession, ensureCodexThread, findCodexRollout } from './session-transfer'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexa-transfer-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('copyClaudeSession', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  const cwd = '/work/project'

  it('copies the transcript, its folder and the file history', async () => {
    const from = claudePaths(join(root, 'a'), true)
    const to = claudePaths(join(root, 'b'), true)
    const folder = join(from.projectsDir, claudeProjectKey(cwd))
    await mkdir(join(folder, id, 'subagents'), { recursive: true })
    await writeFile(join(folder, `${id}.jsonl`), '{"type":"user"}\n')
    await writeFile(join(folder, id, 'subagents', 'agent.jsonl'), 'x')
    await mkdir(join(from.configDir, 'file-history', id), { recursive: true })
    await writeFile(join(from.configDir, 'file-history', id, 'snap'), 'y')

    expect(await copyClaudeSession(from, to, id, cwd)).toBe(true)
    const target = join(to.projectsDir, claudeProjectKey(cwd))
    expect(await readFile(join(target, `${id}.jsonl`), 'utf8')).toBe('{"type":"user"}\n')
    expect(await readFile(join(target, id, 'subagents', 'agent.jsonl'), 'utf8')).toBe('x')
    expect(await readFile(join(to.configDir, 'file-history', id, 'snap'), 'utf8')).toBe('y')
  })

  it('keeps a newer copy, and has nothing to copy without a transcript', async () => {
    const from = claudePaths(join(root, 'a'), true)
    const to = claudePaths(join(root, 'b'), true)
    expect(await copyClaudeSession(from, to, id, cwd)).toBe(false)
    const source = join(from.projectsDir, 'other-folder', `${id}.jsonl`)
    const target = join(to.projectsDir, 'other-folder', `${id}.jsonl`)
    await mkdir(join(from.projectsDir, 'other-folder'), { recursive: true })
    await mkdir(join(to.projectsDir, 'other-folder'), { recursive: true })
    await writeFile(source, 'old')
    await writeFile(target, 'newer')
    await utimes(source, new Date(2020, 0, 1), new Date(2020, 0, 1))
    expect(await copyClaudeSession(from, to, id, cwd)).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('newer')
  })
})

describe('copyCodexThread', () => {
  it('copies the rollout to the same place below sessions', async () => {
    const thread = '019a0000-0000-7000-8000-000000000001'
    const from = join(root, 'a', 'sessions')
    const to = join(root, 'b', 'sessions')
    await mkdir(join(from, '2026', '11', '23'), { recursive: true })
    await writeFile(join(from, '2026', '11', '23', `rollout-2026-11-23T10-00-00-${thread}.jsonl`), 'r')
    const copied = await copyCodexThread(from, to, thread)
    expect(copied).toBe(join(to, '2026', '11', '23', `rollout-2026-11-23T10-00-00-${thread}.jsonl`))
    expect(await readFile(copied!, 'utf8')).toBe('r')
    expect(await copyCodexThread(from, to, 'unknown')).toBeNull()
  })
})

describe('ensureClaudeSession', () => {
  const id = '11111111-2222-3333-4444-555555555555'
  const cwd = '/work/project'

  it('finds the session where Claude Code looks, else copies it from where it was saved', async () => {
    const saved = claudePaths(join(root, 'saved'), true)
    const now = claudePaths(join(root, 'now'), true)
    expect(await ensureClaudeSession(now, saved.configDir, id, cwd)).toBe(false)
    const folder = join(saved.projectsDir, claudeProjectKey(cwd))
    await mkdir(folder, { recursive: true })
    await writeFile(join(folder, `${id}.jsonl`), 't')
    // Saved in the folder Claude Code looks in, or nowhere known: nothing to copy.
    expect(await ensureClaudeSession(now, undefined, id, cwd)).toBe(false)
    expect(await ensureClaudeSession(now, saved.configDir, id, cwd)).toBe(true)
    expect(await readFile(join(now.projectsDir, claudeProjectKey(cwd), `${id}.jsonl`), 'utf8')).toBe('t')
    expect(await ensureClaudeSession(saved, saved.configDir, id, cwd)).toBe(true)
  })
})

describe('ensureCodexThread', () => {
  it('finds the thread below sessions, else copies it from where it was saved', async () => {
    const thread = '019a0000-0000-7000-8000-000000000002'
    const saved = codexPaths(join(root, 'saved'))
    const now = codexPaths(join(root, 'now'))
    expect(await ensureCodexThread(now, saved.configDir, thread)).toEqual({ found: false })
    const file = join(saved.sessionsDir, '2026', '11', '23', `rollout-2026-11-23T10-00-00-${thread}.jsonl`)
    await mkdir(join(saved.sessionsDir, '2026', '11', '23'), { recursive: true })
    await writeFile(file, 'r')
    expect(await ensureCodexThread(saved, saved.configDir, thread)).toEqual({ found: true })
    const copied = await ensureCodexThread(now, saved.configDir, thread)
    expect(copied).toEqual({ found: true, copiedTo: join(now.sessionsDir, '2026', '11', '23', `rollout-2026-11-23T10-00-00-${thread}.jsonl`) })
    expect(await ensureCodexThread(now, undefined, thread)).toEqual({ found: true })
  })
})

describe('findCodexRollout', () => {
  it('looks in the folder of the day the thread id names first, else in all of them', async () => {
    // 01a20a44-5e41-…: started 2026-11-23 21:16:22 UTC.
    const thread = '01a20a44-5e41-7c42-b2e3-f3603fac2443'
    const days = codexRolloutDays(thread)
    const started = new Date(0x01a20a445e41)
    expect(days[0]).toBe(join(String(started.getFullYear()), String(started.getMonth() + 1).padStart(2, '0'), String(started.getDate()).padStart(2, '0')))
    expect(days).toHaveLength(3)
    expect(codexRolloutDays('not-a-uuid')).toEqual([])
    // UUIDv4: no time in it.
    expect(codexRolloutDays('a1b2c3d4-0000-4000-8000-000000000000')).toEqual([])

    const sessions = join(root, 'sessions')
    await mkdir(join(sessions, days[0]!), { recursive: true })
    await writeFile(join(sessions, days[0]!, `rollout-x-${thread}.jsonl`), '')
    expect(await findCodexRollout(sessions, thread)).toBe(join(sessions, days[0]!, `rollout-x-${thread}.jsonl`))

    const elsewhere = '01a20a44-5e41-7c42-b2e3-f3603fac2444'
    await mkdir(join(sessions, '2020', '01', '01'), { recursive: true })
    await writeFile(join(sessions, '2020', '01', '01', `rollout-y-${elsewhere}.jsonl`), '')
    expect(await findCodexRollout(sessions, elsewhere)).toBe(join(sessions, '2020', '01', '01', `rollout-y-${elsewhere}.jsonl`))
    expect(await findCodexRollout(sessions, '01a20a44-5e41-7c42-b2e3-000000000000')).toBeNull()
  })
})
