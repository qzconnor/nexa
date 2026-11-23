import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudePaths, claudeProjectKey } from './cli-files'
import { copyClaudeSession, copyCodexThread } from './session-transfer'

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
