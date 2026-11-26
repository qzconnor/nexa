import { resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Project, SessionMeta } from '@shared/types'
import { chatFolders, inFolders } from './remote-roots'

const root = resolve('/projekte/app')
/** A path in `root` as another device may write it, `..` and all. */
const at = (...parts: string[]) => [root, ...parts].join(sep)

describe('inFolders', () => {
  it('takes the folders and what lies in them', () => {
    expect(inFolders(root, [root])).toBe(true)
    expect(inFolders(at('src', 'main.ts'), [root])).toBe(true)
    expect(inFolders(`${root}${sep}`, [root])).toBe(true)
    // A name that merely starts with two dots lies in it.
    expect(inFolders(at('..config'), [root])).toBe(true)
    expect(inFolders(at('src'), [resolve('/elsewhere'), root])).toBe(true)
  })

  it('refuses what only starts like one of them, once `..` is resolved', () => {
    expect(inFolders(at('..'), [root])).toBe(false)
    expect(inFolders(at('..', 'other'), [root])).toBe(false)
    expect(inFolders(at('src', '..', '..', 'other'), [root])).toBe(false)
    expect(inFolders(`${root}-kopie`, [root])).toBe(false)
    expect(inFolders(resolve('/'), [root])).toBe(false)
    // Back into it is in it.
    expect(inFolders(at('..', 'app', 'src'), [root])).toBe(true)
  })

  it('refuses relative paths, NUL and everything without folders', () => {
    expect(inFolders('src', [root])).toBe(false)
    expect(inFolders(at('a\0b'), [root])).toBe(false)
    expect(inFolders(root, [])).toBe(false)
  })

  it.runIf(process.platform === 'win32')('compares without regard to case on Windows', () => {
    expect(inFolders(at('SRC').toUpperCase(), [root])).toBe(true)
    expect(inFolders('C:\\Windows\\System32', [root])).toBe(false)
    expect(inFolders('\\\\server\\share\\app', [root])).toBe(false)
  })
})

describe('chatFolders', () => {
  it('are the projects, the folders chats work in and those added to them', () => {
    const project = (path: string) => ({ id: path, name: path, path, createdAt: 0, updatedAt: 0 }) as Project
    const meta = (extra: Partial<SessionMeta>) => ({ id: 'c', projectId: 'p', ...extra }) as SessionMeta
    const a = resolve('/a')
    const wt = resolve('/worktrees/a-fix')
    const docs = resolve('/docs')
    const folders = chatFolders(
      [project(a), project(a)],
      [meta({ cwd: resolve('/a/sub') }), meta({ cwd: wt, worktree: { path: wt, branch: 'fix' } }), meta({ dirs: [docs, 'relativ'] }), meta({})],
    )
    expect(folders).toEqual([a, resolve('/a/sub'), wt, docs])
  })
})
