import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolItem } from '@shared/chat'
import { FileActivityTracker } from './activity-tracker'
import type { FileActivity } from './file-activity'
import type { FileTreeService } from './file-tree-service'

function tool(patch: Partial<ToolItem>): ToolItem {
  return { id: 't1', ts: 0, provider: 'claude', kind: 'tool', tool: 'read', name: 'Read', title: '', status: 'running', startedAt: 10, ...patch }
}

function setup() {
  const calls: [string, FileActivity][] = []
  const tree = {
    activity: vi.fn((id: string, activity: FileActivity) => calls.push([id, activity])),
    endShells: vi.fn(),
  }
  return { tracker: new FileActivityTracker(tree as unknown as FileTreeService), calls, tree }
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('FileActivityTracker', () => {
  it('reports a read once, when it starts', () => {
    const { tracker, calls } = setup()
    const cwd = process.cwd()
    tracker.tool('s', tool({ input: { file_path: 'a.ts' } }), cwd)
    tracker.tool('s', tool({ input: { file_path: 'a.ts' }, status: 'done' }), cwd)
    tracker.tool('s', tool({ input: { file_path: 'a.ts' }, status: 'done' }), cwd)
    expect(calls).toHaveLength(1)
    expect(calls[0][1].touches?.[0].kind).toBe('read')
  })

  it('reports a write at its start and once more when it is done', () => {
    const { tracker, calls } = setup()
    const item = tool({ name: 'Edit', tool: 'write', input: { file_path: 'a.ts' } })
    tracker.tool('s', item, process.cwd())
    tracker.tool('s', { ...item, status: 'done' }, process.cwd())
    expect(calls.map(([, a]) => a.touches?.[0].kind)).toEqual(['write', 'write'])
    // Seen only once it was done: once.
    const late = setup()
    late.tracker.tool('s', { ...item, id: 't2', status: 'done' }, process.cwd())
    expect(late.calls).toHaveLength(1)
  })

  it('waits while a tool waits for permission, and drops a denied one', () => {
    const { tracker, calls } = setup()
    tracker.tool('s', tool({ name: 'Write', tool: 'write', input: { file_path: 'a.ts' }, status: 'pending' }), process.cwd())
    expect(calls).toHaveLength(0)
    tracker.tool('s', tool({ name: 'Write', tool: 'write', input: { file_path: 'a.ts' }, status: 'denied' }), process.cwd())
    expect(calls).toHaveLength(0)
  })

  it('reports a search’s hits only at its end', () => {
    const { tracker, calls } = setup()
    const item = tool({ name: 'Grep', tool: 'search', input: { pattern: 'x' } })
    tracker.tool('s', item, process.cwd())
    expect(calls).toHaveLength(0)
    tracker.tool('s', { ...item, status: 'done', output: 'a.ts:1:x' }, process.cwd())
    expect(calls[0][1].maybe?.[0].kind).toBe('search')
  })

  it('ends the shells of a session with its turn', () => {
    const { tracker, tree } = setup()
    tracker.turnEnded('s')
    expect(tree.endShells).toHaveBeenCalledWith('s')
  })

  it('reads the history of a chat, searches only with files that are there', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexa-activity-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'found.ts'), '')
    const { tracker } = setup()
    const items = [
      tool({ id: 'a', status: 'done', input: { file_path: 'read.ts' }, endedAt: 30 }),
      tool({ id: 'b', name: 'Grep', tool: 'search', status: 'done', output: 'found.ts:1:x\nmissing.ts:2:y', endedAt: 20 }),
      tool({ id: 'c', name: 'Write', tool: 'write', status: 'denied', input: { file_path: 'denied.ts' } }),
      tool({ id: 'd', name: 'Write', tool: 'write', status: 'running', input: { file_path: 'running.ts' } }),
    ]
    const history = await tracker.history(items, dir)
    expect(history.map((t) => [t.path, t.kind, t.at])).toEqual([
      [join(dir, 'found.ts'), 'search', 20],
      [join(dir, 'read.ts'), 'read', 30],
    ])
  })
})
