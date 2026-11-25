import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { antigravityPaths } from '../../accounts/cli-files'
import { conversationFile, conversationMtime, copyConversation, cutIndex, promptTimes, readSteps, stepTime, USER_STEP } from './antigravity-conversations'
import { writeConversation } from './conversation-fixture'

const ID = '1cdfb3c6-7f4b-4e69-a335-d6dfab82fbfb'
const TRAJECTORY = '0ec8cdec-a0e2-498d-9a20-ba2d9acf3538'
const FORK = '0f0f0f0f-1111-4222-8333-444455556666'

/** Two turns: prompt (14), answer (15), tool (132), answer; prompt, answer. As steps 0–5. */
const STEPS: [number, number][] = [
  [USER_STEP, 1_795_573_124_417],
  [15, 1_795_573_126_160],
  [132, 1_795_573_127_000],
  [15, 1_795_573_128_000],
  [USER_STEP, 1_795_573_138_940],
  [15, 1_795_573_142_776],
]

let dir: string

const conversation = () => writeConversation(dir, ID, TRAJECTORY, STEPS)

function table(file: string, sql: string): Record<string, unknown>[] {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    return db.prepare(sql).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexa-agy-conv-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('steps', () => {
  it('reads each step’s kind and time from its metadata', async () => {
    const steps = readSteps(await conversation())
    expect(steps).toEqual(STEPS.map(([type, at]) => ({ type, at })))
    expect(promptTimes(steps)).toEqual([1_795_573_124_417, 1_795_573_138_940])
  })

  it('takes no time from what isn’t protobuf, and nothing from a file that isn’t there', () => {
    expect(stepTime(Buffer.from([0xff, 0xff]))).toBeNull()
    expect(stepTime(null)).toBeNull()
    expect(readSteps(join(dir, 'gone.db'))).toEqual([])
    expect(promptTimes([{ type: USER_STEP, at: null }])).toBeNull()
  })

  it('cuts at the first prompt made at the time or later', () => {
    const steps = STEPS.map(([type, at]) => ({ type, at }))
    expect(cutIndex(steps, 1_795_573_130_000)).toBe(4)
    expect(cutIndex(steps, 1_795_573_138_940)).toBe(4)
    expect(cutIndex(steps, 1_795_573_200_000)).toBe(6)
    expect(cutIndex(steps, 0)).toBe(0)
    expect(cutIndex([{ type: USER_STEP, at: null }], 5)).toBeNull()
  })

  it('takes the log beside the database as a write to the conversation', async () => {
    const file = await conversation()
    const db = await conversationMtime(dir, ID)
    expect(db).toBeGreaterThan(0)
    await writeFile(`${file}-wal`, 'x')
    expect(await conversationMtime(dir, ID)).toBeGreaterThanOrEqual(db!)
    expect(await conversationMtime(dir, FORK)).toBeNull()
  })
})

describe('copyConversation', () => {
  it('forks under a new id: the ids in every record change, the artifacts come along', async () => {
    await conversation()
    expect(await copyConversation({ dir, id: ID }, { dir, id: FORK })).toBe(true)
    const file = conversationFile(dir, FORK)
    const [meta] = table(file, 'SELECT trajectory_id, cascade_id FROM trajectory_meta')
    expect(meta!.cascade_id).toBe(FORK)
    expect(meta!.trajectory_id).not.toBe(TRAJECTORY)
    const blobs = [
      ...table(file, 'SELECT metadata AS v FROM steps'),
      ...table(file, 'SELECT data AS v FROM gen_metadata'),
      ...table(file, 'SELECT data AS v FROM executor_metadata'),
      ...table(file, 'SELECT data AS v FROM trajectory_metadata_blob'),
    ].map((r) => Buffer.from(r.v as Uint8Array).toString('latin1'))
    expect(blobs.some((b) => b.includes(ID) || b.includes(TRAJECTORY))).toBe(false)
    expect(blobs.filter((b) => b.includes(FORK) || b.includes(meta!.trajectory_id as string)).length).toBeGreaterThan(0)
    // Still readable, the times as they were.
    expect(readSteps(file)).toEqual(STEPS.map(([type, at]) => ({ type, at })))
    expect(await readFile(join(antigravityPaths(dir).brainDir, FORK, 'walkthrough.md'), 'utf8')).toBe('# Fertig')
    // The original stays as it was.
    expect(table(conversationFile(dir, ID), 'SELECT cascade_id FROM trajectory_meta')[0]!.cascade_id).toBe(ID)
  })

  it('leaves out the prompts from the cut on, with the records of their answers and turns', async () => {
    await conversation()
    expect(await copyConversation({ dir, id: ID }, { dir, id: FORK }, 1_795_573_130_000)).toBe(true)
    const file = conversationFile(dir, FORK)
    expect(table(file, 'SELECT idx FROM steps').map((r) => r.idx)).toEqual([0, 1, 2, 3])
    expect(table(file, 'SELECT idx FROM gen_metadata').map((r) => r.idx)).toEqual([0])
    expect(table(file, 'SELECT idx FROM executor_metadata').map((r) => r.idx)).toEqual([0])
  })

  it('copies nothing when nothing would remain, or there is no conversation', async () => {
    await conversation()
    expect(await copyConversation({ dir, id: ID }, { dir, id: FORK }, 1_795_573_124_417)).toBe(false)
    expect(await conversationMtime(dir, FORK)).toBeNull()
    expect(await copyConversation({ dir, id: FORK }, { dir, id: ID })).toBe(false)
  })

  it('takes a conversation to another account’s folder under its id, over an older copy and its log', async () => {
    await conversation()
    const other = join(dir, 'other')
    const target = conversationFile(other, ID)
    await mkdir(antigravityPaths(other).conversationsDir, { recursive: true })
    await writeFile(target, 'older copy')
    await writeFile(`${target}-wal`, 'older log')
    expect(await copyConversation({ dir, id: ID }, { dir: other, id: ID })).toBe(true)
    expect(table(target, 'SELECT cascade_id, trajectory_id FROM trajectory_meta')[0]).toEqual({ cascade_id: ID, trajectory_id: TRAJECTORY })
    expect(readSteps(target)).toHaveLength(STEPS.length)
    expect(await conversationMtime(other, ID)).not.toBeNull()
  })
})
