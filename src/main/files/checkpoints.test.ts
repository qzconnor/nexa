import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Checkpoints, isSafeRel, unsafeRoot } from './checkpoints'

let base: string
let root: string
let store: Checkpoints

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'nexa-checkpoints-'))
  root = join(base, 'project')
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'a.ts'), 'one\ntwo\nthree\n')
  await writeFile(join(root, 'keep.txt'), 'stays\r\nas it is\r\n')
  store = new Checkpoints(join(base, 'data'))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true, maxRetries: 3 })
})

const read = (rel: string) => readFile(join(root, rel), 'utf8')
const gone = async (rel: string) => !(await stat(join(root, rel)).catch(() => null))

describe('Checkpoints', () => {
  it('counts what a prompt changed and lists it', async () => {
    await store.begin('s1', 'p1', [root])
    await writeFile(join(root, 'src', 'a.ts'), 'one\n2\nthree\nfour\n')
    await writeFile(join(root, 'src', 'new.ts'), 'x\n')
    await rm(join(root, 'keep.txt'))
    const summary = await store.end('s1')
    expect(summary).toEqual({ files: 3, insertions: 3, deletions: 3 })
    const { prompts } = await store.changes('s1')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]!.open).toBe(false)
    expect(prompts[0]!.files.map((f) => [f.rel, f.status])).toEqual([
      ['keep.txt', 'deleted'],
      ['src/a.ts', 'modified'],
      ['src/new.ts', 'added'],
    ])
    expect(prompts[0]!.files[1]!.path).toBe(join(root, 'src', 'a.ts'))
  })

  it('shows a running turn as far as it got', async () => {
    await store.begin('s1', 'p1', [root])
    await writeFile(join(root, 'src', 'b.ts'), 'b\n')
    const { prompts } = await store.changes('s1')
    expect(prompts[0]!.open).toBe(true)
    expect(prompts[0]!.files.map((f) => f.rel)).toEqual(['src/b.ts'])
  })

  it('gives a file’s change as a patch', async () => {
    await store.begin('s1', 'p1', [root])
    await writeFile(join(root, 'src', 'a.ts'), 'one\nTWO\nthree\n')
    await store.end('s1')
    const diff = await store.diff('s1', 'p1', join(root, 'src', 'a.ts'), false)
    expect(diff.patch).toContain('-two')
    expect(diff.patch).toContain('+TWO')
    expect(diff.binary).toBe(false)
  })

  it('rewinds the files to before a prompt and takes that back', async () => {
    await store.begin('s1', 'p1', [root])
    await writeFile(join(root, 'src', 'a.ts'), 'first\n')
    await writeFile(join(root, 'made.ts'), 'made\n')
    await store.end('s1')
    await store.begin('s1', 'p2', [root])
    await writeFile(join(root, 'src', 'a.ts'), 'second\n')
    await rm(join(root, 'keep.txt'))
    await store.end('s1')

    const preview = await store.preview('s1', 'p1')
    expect(preview.files.map((f) => [f.rel, f.status])).toEqual([
      ['keep.txt', 'added'],
      ['made.ts', 'deleted'],
      ['src/a.ts', 'modified'],
    ])
    expect(preview.files.every((f) => !f.outside)).toBe(true)

    const result = await store.rewind('s1', 'p1')
    expect(result.files).toBe(3)
    expect(result.failed).toEqual([])
    expect(await read('src/a.ts')).toBe('one\ntwo\nthree\n')
    expect(await read('keep.txt')).toBe('stays\r\nas it is\r\n')
    expect(await gone('made.ts')).toBe(true)
    expect((await store.changes('s1')).undo).toMatchObject({ promptId: 'p1', files: 3 })

    await store.undo('s1')
    expect(await read('src/a.ts')).toBe('second\n')
    expect(await read('made.ts')).toBe('made\n')
    expect(await gone('keep.txt')).toBe(true)
    expect((await store.changes('s1')).undo).toBeNull()
  })

  it('rewinds only what the agent changed and names what changed since', async () => {
    await store.begin('s1', 'p1', [root])
    await writeFile(join(root, 'src', 'a.ts'), 'agent\n')
    await store.end('s1')
    // The user's own edits after the turn: one in a file the agent changed, one in another.
    await writeFile(join(root, 'src', 'a.ts'), 'agent and user\n')
    await writeFile(join(root, 'keep.txt'), 'the user’s\n')
    const preview = await store.preview('s1', 'p1')
    expect(preview.files.map((f) => [f.rel, f.outside])).toEqual([['src/a.ts', true]])
    await store.rewind('s1', 'p1')
    expect(await read('src/a.ts')).toBe('one\ntwo\nthree\n')
    expect(await read('keep.txt')).toBe('the user’s\n')
  })

  it('removes folders a rewind leaves empty', async () => {
    await store.begin('s1', 'p1', [root])
    await mkdir(join(root, 'deep', 'er'), { recursive: true })
    await writeFile(join(root, 'deep', 'er', 'x.ts'), 'x\n')
    await store.end('s1')
    await store.rewind('s1', 'p1')
    expect(await gone('deep')).toBe(true)
  })

  it('leaves out ignored folders and big files', async () => {
    await writeFile(join(root, '.gitignore'), 'out/\n')
    await mkdir(join(root, 'node_modules', 'x'), { recursive: true })
    await mkdir(join(root, 'out'), { recursive: true })
    await store.begin('s1', 'p1', [root])
    await writeFile(join(root, 'node_modules', 'x', 'index.js'), 'x')
    await writeFile(join(root, 'out', 'bundle.js'), 'x')
    await writeFile(join(root, 'big.bin'), Buffer.alloc(6 * 1024 * 1024, 1))
    await writeFile(join(root, 'small.ts'), 's\n')
    await store.end('s1')
    const { prompts } = await store.changes('s1')
    expect(prompts[0]!.files.map((f) => f.rel)).toEqual(['small.ts'])
    expect(prompts[0]!.skipped).toEqual([join(root, 'big.bin')])
  })

  it('starts a waiting prompt’s checkpoint where the last one ended', async () => {
    await store.begin('s1', 'p1', [root])
    await writeFile(join(root, 'one.ts'), '1\n')
    await store.end('s1', 'p2')
    await writeFile(join(root, 'two.ts'), '2\n')
    await store.end('s1')
    const { prompts } = await store.changes('s1')
    expect(prompts.map((p) => [p.promptId, p.files.map((f) => f.rel)])).toEqual([
      ['p1', ['one.ts']],
      ['p2', ['two.ts']],
    ])
  })

  it('ends a checkpoint left open at the next prompt', async () => {
    await store.begin('s1', 'p1', [root])
    await writeFile(join(root, 'one.ts'), '1\n')
    await store.begin('s1', 'p2', [root])
    const { prompts } = await store.changes('s1')
    expect(prompts[0]!.open).toBe(false)
    expect(prompts[0]!.files.map((f) => f.rel)).toEqual(['one.ts'])
    expect(prompts[1]!.open).toBe(true)
  })

  it('copies, trims and forgets a chat’s checkpoints', async () => {
    await store.begin('s1', 'p1', [root])
    await store.end('s1')
    await store.begin('s1', 'p2', [root])
    await store.end('s1')
    await store.copy('s1', 's2')
    await store.keep('s2', new Set(['p1']))
    expect((await store.changes('s2')).prompts.map((p) => p.promptId)).toEqual(['p1'])
    expect((await store.changes('s1')).prompts.map((p) => p.promptId)).toEqual(['p1', 'p2'])
    await store.forget('s1')
    expect((await store.changes('s1')).prompts).toEqual([])
    // s2 still holds the folder's shadow repository.
    await expect(store.rewind('s2', 'p1')).resolves.toMatchObject({ failed: [] })
    await store.forget('s2')
    expect(await stat(join(base, 'data', 'repos')).then((s) => s.isDirectory())).toBe(true)
  })

  it('marks a folder it can’t take a checkpoint of', async () => {
    await store.begin('s1', 'p1', [join(base, 'missing')])
    const { prompts } = await store.changes('s1')
    expect(prompts[0]!.unavailable).toBe('Den Ordner gibt es nicht mehr.')
    await expect(store.rewind('s1', 'p1')).rejects.toThrow('Den Ordner gibt es nicht mehr.')
  })
})

describe('unsafeRoot', () => {
  it('refuses drives and the home folder', () => {
    const home = process.platform === 'win32' ? 'C:\\Users\\me' : '/home/me'
    expect(unsafeRoot(process.platform === 'win32' ? 'C:\\' : '/', home)).toMatch(/Laufwerk/)
    expect(unsafeRoot(home, home)).toMatch(/Benutzerordner/)
    expect(unsafeRoot(join(home, 'Desktop'), home)).toMatch(/Benutzerordner/)
    expect(unsafeRoot(join(home, 'code', 'app'), home)).toBeNull()
  })
})

describe('isSafeRel', () => {
  it('takes only paths within the folder', () => {
    expect(isSafeRel('src/a.ts')).toBe(true)
    expect(isSafeRel('../a.ts')).toBe(false)
    expect(isSafeRel('/etc/passwd')).toBe(false)
    expect(isSafeRel('a//b')).toBe(false)
  })
})
