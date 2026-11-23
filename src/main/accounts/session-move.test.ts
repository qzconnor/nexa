import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claudeProjectKey } from './cli-files'
import { relocateClaudeSession } from './session-move'

/** Steps that fail: renaming this path (a virus scanner holds it), appending (a full disk, after a few bytes). */
const failing = vi.hoisted(() => ({ rename: null as string | null, append: false }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      if (from === failing.rename) throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}'`), { code: 'EBUSY' })
      return actual.rename(from, to)
    },
    appendFile: async (file: string, data: string, options: BufferEncoding) => {
      if (!failing.append) return actual.appendFile(file, data, options)
      await actual.appendFile(file, data.slice(0, 5), options)
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    },
  }
})

const S1 = '11111111-1111-4111-8111-111111111111'
const S2 = '22222222-2222-4222-8222-222222222222'

let projects: string

beforeEach(() => {
  projects = mkdtempSync(join(tmpdir(), 'nexa-move-'))
})

afterEach(() => {
  failing.rename = null
  failing.append = false
  rmSync(projects, { recursive: true, force: true })
})

function transcript(cwd: string, id: string, text = '{"type":"user"}\n'): string {
  const dir = join(projects, claudeProjectKey(cwd))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${id}.jsonl`)
  writeFileSync(file, text)
  return file
}

const lines = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)

describe('relocateClaudeSession', () => {
  it('moves the session into the project folder of the new folder, as /cd does; the others and the memory stay', async () => {
    const file = transcript('F:\\Downloads', S1)
    mkdirSync(join(projects, 'F--Downloads', S1, 'subagents'), { recursive: true })
    const stays = transcript('F:\\Downloads', S2)
    mkdirSync(join(projects, 'F--Downloads', 'memory'))

    const moved = join(projects, 'F--Kunden-shop', `${S1}.jsonl`)
    expect(await relocateClaudeSession(projects, file, S1, 'F:\\Kunden\\shop')).toBe(moved)

    expect(lines(moved)).toEqual([{ type: 'user' }, { type: 'relocated', sessionId: S1, relocatedCwd: 'F:\\Kunden\\shop' }])
    expect(existsSync(join(projects, 'F--Kunden-shop', S1, 'subagents'))).toBe(true)
    expect(existsSync(file)).toBe(false)
    expect(existsSync(stays)).toBe(true)
    expect(existsSync(join(projects, 'F--Downloads', 'memory'))).toBe(true)
    expect(existsSync(join(projects, 'F--Kunden-shop', 'memory'))).toBe(false)
  })

  it('removes the project folder it leaves once it is empty, and writes the entry on a line of its own', async () => {
    const file = transcript('F:\\Downloads', S1, '{"type":"user"}')

    const moved = await relocateClaudeSession(projects, file, S1, 'F:\\Kunden\\shop')

    expect(existsSync(join(projects, 'F--Downloads'))).toBe(false)
    expect(lines(moved!)).toEqual([{ type: 'user' }, { type: 'relocated', sessionId: S1, relocatedCwd: 'F:\\Kunden\\shop' }])
  })

  it('leaves the session where it is when a copy lies in the new folder', async () => {
    const file = transcript('F:\\Downloads', S1)
    const copy = transcript('F:\\Kunden\\shop', S1, '{"type":"assistant"}\n')

    expect(await relocateClaudeSession(projects, file, S1, 'F:\\Kunden\\shop')).toBeNull()

    expect(lines(file)).toEqual([{ type: 'user' }])
    expect(lines(copy)).toEqual([{ type: 'assistant' }])
  })

  it('moves everything back when the transcript can’t move: no session without its subagents', async () => {
    const file = transcript('F:\\Downloads', S1)
    mkdirSync(join(projects, 'F--Downloads', S1, 'subagents'), { recursive: true })
    failing.rename = file

    await expect(relocateClaudeSession(projects, file, S1, 'F:\\Kunden\\shop')).rejects.toThrow('Der Chat bleibt im alten Ordner: EBUSY')

    expect(lines(file)).toEqual([{ type: 'user' }])
    expect(existsSync(join(projects, 'F--Downloads', S1, 'subagents'))).toBe(true)
    expect(existsSync(join(projects, 'F--Kunden-shop'))).toBe(false)
  })

  it('moves the transcript back, as it was, when the note of the move can’t be written', async () => {
    const file = transcript('F:\\Downloads', S1, '{"type":"user"}')
    mkdirSync(join(projects, 'F--Downloads', S1, 'subagents'), { recursive: true })
    failing.append = true

    await expect(relocateClaudeSession(projects, file, S1, 'F:\\Kunden\\shop')).rejects.toThrow('Der Chat bleibt im alten Ordner: ENOSPC')

    // Not even the start of the line it began to write.
    expect(readFileSync(file, 'utf8')).toBe('{"type":"user"}')
    expect(existsSync(join(projects, 'F--Downloads', S1, 'subagents'))).toBe(true)
    expect(existsSync(join(projects, 'F--Kunden-shop'))).toBe(false)
  })

  it('says so when something stays in the new place', async () => {
    const file = transcript('F:\\Downloads', S1)
    failing.append = true
    // Moving back fails too: the transcript stays in the new folder.
    failing.rename = join(projects, 'F--Kunden-shop', `${S1}.jsonl`)

    await expect(relocateClaudeSession(projects, file, S1, 'F:\\Kunden\\shop')).rejects.toThrow('nur zum Teil verschoben')
  })
})
