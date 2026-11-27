import { describe, expect, it } from 'vitest'
import type { ToolItem } from './chat'
import { foundFiles, resolvePath, toolTouches, writtenFiles } from './file-touches'

function tool(patch: Partial<ToolItem>): ToolItem {
  return { id: 't', ts: 0, provider: 'claude', kind: 'tool', tool: 'read', name: 'Read', title: '', status: 'done', startedAt: 0, ...patch }
}

describe('resolvePath', () => {
  it('joins and normalises on Windows', () => {
    expect(resolvePath('C:\\dev', 'src/a.ts', true)).toBe('C:\\dev\\src\\a.ts')
    expect(resolvePath('C:\\dev\\', '..\\x\\.\\b.ts', true)).toBe('C:\\x\\b.ts')
    expect(resolvePath('C:\\dev', 'D:/other/c.ts', true)).toBe('D:\\other\\c.ts')
  })

  it('keeps a share and never climbs above the drive', () => {
    expect(resolvePath('\\\\server\\share', 'a.ts', true)).toBe('\\\\server\\share\\a.ts')
    expect(resolvePath('C:\\', '..\\..\\a.ts', true)).toBe('C:\\a.ts')
  })

  it('joins on POSIX', () => {
    expect(resolvePath('/home/me/dev', '../x/a.ts', false)).toBe('/home/me/x/a.ts')
  })
})

describe('foundFiles', () => {
  it('reads Grep and Glob output', () => {
    expect(foundFiles('Found 2 files\nsrc/a.ts\nsrc/b.ts')).toEqual(['src/a.ts', 'src/b.ts'])
    expect(foundFiles('src/a.ts:12:const x = 1\nsrc/a.ts:14:y\nsrc/c.ts-3-z')).toEqual(['src/a.ts', 'src/c.ts'])
    expect(foundFiles('No files found')).toEqual([])
  })
})

describe('toolTouches', () => {
  it('reads a file Read names', () => {
    expect(toolTouches(tool({ input: { file_path: 'src/a.ts' } }), 'C:\\dev', true)).toEqual({
      touches: [{ path: 'C:\\dev\\src\\a.ts', kind: 'read' }],
      maybe: [],
    })
  })

  it('writes the changes of an edit, also a move', () => {
    const item = tool({ name: 'apply_patch', tool: 'write', changes: [{ path: 'a.ts', type: 'update', movePath: 'b.ts' }] })
    expect(toolTouches(item, 'C:\\dev', true).touches).toEqual([
      { path: 'C:\\dev\\a.ts', kind: 'write' },
      { path: 'C:\\dev\\b.ts', kind: 'write' },
    ])
  })

  it('writes the file of a write tool without changes once', () => {
    expect(toolTouches(tool({ name: 'Write', tool: 'write', input: { file_path: 'C:\\dev\\a.ts' } }), 'C:\\dev', true).touches).toEqual([
      { path: 'C:\\dev\\a.ts', kind: 'write' },
    ])
    const changed = tool({ name: 'Edit', tool: 'write', input: { file_path: 'C:\\dev\\a.ts' }, changes: [{ path: 'C:\\dev\\a.ts', type: 'update' }] })
    expect(toolTouches(changed, 'C:\\dev', true).touches).toHaveLength(1)
  })

  it('takes a search’s folder and hits as files that may be there', () => {
    const item = tool({ name: 'Grep', tool: 'search', input: { path: 'src' }, output: 'src/a.ts:1:x' })
    expect(toolTouches(item, 'C:\\dev', true).maybe).toEqual([
      { path: 'C:\\dev\\src', kind: 'search' },
      { path: 'C:\\dev\\src\\a.ts', kind: 'search' },
    ])
    expect(toolTouches({ ...item, status: 'running' }, 'C:\\dev', true).maybe).toHaveLength(1)
  })

  it('follows the folder a tool ran in', () => {
    const item = tool({ input: { file_path: 'a.ts', cwd: 'C:\\other' } })
    expect(toolTouches(item, 'C:\\dev', true).touches[0].path).toBe('C:\\other\\a.ts')
  })
})

describe('writtenFiles', () => {
  it('keeps each file a tool wrote, with its last write, by folder key', () => {
    const items = [
      tool({ id: 'r', input: { file_path: 'read.ts' }, startedAt: 1 }),
      tool({ id: 'w1', name: 'Write', tool: 'write', input: { file_path: 'A.ts' }, startedAt: 2, endedAt: 3 }),
      tool({ id: 'w2', name: 'Edit', tool: 'write', input: { file_path: 'C:\\dev\\a.ts' }, startedAt: 7, endedAt: 9 }),
      tool({ id: 'p', name: 'apply_patch', tool: 'write', changes: [{ path: 'b.ts', type: 'add' }], startedAt: 5 }),
    ]
    expect(writtenFiles(items, 'C:\\dev', true)).toEqual(
      new Map([
        ['c:\\dev\\a.ts', 9],
        ['c:\\dev\\b.ts', 5],
      ]),
    )
  })

  it('leaves out what changed nothing: asked, refused, still running or failed', () => {
    const write = (patch: Partial<ToolItem>) => tool({ name: 'Write', tool: 'write', input: { file_path: 'a.ts' }, ...patch })
    const items = [write({ status: 'pending' }), write({ status: 'denied' }), write({ status: 'running' }), write({ status: 'error' })]
    expect(writtenFiles(items, 'C:\\dev', true).size).toBe(0)
    expect(writtenFiles([write({ status: 'error', changes: [{ path: 'a.ts', type: 'update' }] })], 'C:\\dev', true).size).toBe(1)
  })
})
