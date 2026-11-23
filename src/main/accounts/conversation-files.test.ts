import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeProjectKey } from './cli-files'
import { claudeSessionFiles, codexRollouts, codexThreadFiles, diskSize } from './conversation-files'

const SESSION = '2f2591e1-0000-4000-8000-000000000001'
const THREAD = '019a1b2c-3d4e-7f00-8000-00000000abcd'

let dir: string

async function put(path: string, text = 'x'): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexa-conv-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('claudeSessionFiles', () => {
  const cwd = 'F:\\Projekte\\demo'

  it('finds the transcript first, then what belongs to it', async () => {
    const project = join(dir, 'projects', claudeProjectKey(cwd))
    await put(join(project, `${SESSION}.jsonl`))
    await put(join(project, SESSION, 'subagents', 'agent-1.jsonl'))
    await put(join(dir, 'file-history', SESSION, 'abc@v1'))
    await put(join(dir, 'tasks', 'other', 'x.json'))
    expect(await claudeSessionFiles(dir, SESSION, cwd, false)).toEqual([
      join(project, `${SESSION}.jsonl`),
      join(project, SESSION),
      join(dir, 'file-history', SESSION),
    ])
  })

  it('looks in other project folders only when searching', async () => {
    await put(join(dir, 'projects', 'shortened-name', `${SESSION}.jsonl`))
    expect(await claudeSessionFiles(dir, SESSION, cwd, false)).toEqual([])
    expect(await claudeSessionFiles(dir, SESSION, cwd, true)).toEqual([join(dir, 'projects', 'shortened-name', `${SESSION}.jsonl`)])
  })

  it('never builds paths from odd ids', async () => {
    expect(await claudeSessionFiles(dir, '../../etc', cwd, true)).toEqual([])
  })
})

describe('codexRollouts', () => {
  it('indexes live and archived rollouts by thread', async () => {
    const live = join(dir, 'sessions', '2026', '11', '23', `rollout-2026-11-23T10-00-00-${THREAD}.jsonl`)
    const archived = join(dir, 'archived_sessions', `rollout-2026-10-01T09-00-00-${THREAD}.jsonl`)
    await put(live)
    await put(archived)
    await put(join(dir, 'sessions', 'notes.txt'))
    const index = await codexRollouts(dir)
    expect(codexThreadFiles(index, THREAD.toUpperCase()).sort()).toEqual([archived, live].sort())
    expect(codexThreadFiles(index, 'nope')).toEqual([])
  })

  it('is empty without a CODEX_HOME', async () => {
    expect((await codexRollouts(join(dir, 'missing'))).size).toBe(0)
  })
})

describe('diskSize', () => {
  it('adds up folders and counts what is missing as 0', async () => {
    await put(join(dir, 'a', 'b.txt'), '12345')
    await put(join(dir, 'a', 'c', 'd.txt'), '123')
    expect(await diskSize(join(dir, 'a'))).toBe(8)
    expect(await diskSize(join(dir, 'a', 'b.txt'))).toBe(5)
    expect(await diskSize(join(dir, 'missing'))).toBe(0)
  })
})
