import { describe, expect, it } from 'vitest'
import { FilesEvent, FilesInvoke } from '@shared/files-ipc'
import { IpcEvent } from '@shared/ipc'
import { isFilesEventFor, NO_FILES_WATCH, queueFilesEvent, watchedBy } from './remote-files'

describe('watchedBy', () => {
  it('takes the folders of the trees and of the repositories a device watches', () => {
    expect(watchedBy(FilesInvoke.watch, [[{ root: '/a', dirs: [''] }, { root: '/b', dirs: ['src'] }, null]])).toEqual({ trees: new Set(['/a', '/b']) })
    expect(watchedBy(FilesInvoke.gitWatch, [['/a', 3, '/c']])).toEqual({ repos: new Set(['/a', '/c']) })
    // Nothing given: nothing watched any more.
    expect(watchedBy(FilesInvoke.watch, [])).toEqual({ trees: new Set() })
    expect(watchedBy(FilesInvoke.list, ['/a'])).toBeNull()
  })
})

describe('isFilesEventFor', () => {
  const watch = { trees: new Set(['/a']), repos: new Set(['/r']) }
  const chats = new Set(['s1'])

  it('passes the changes of folders the device watches, and the touches of chats it has open', () => {
    expect(isFilesEventFor(FilesEvent.changed, ['/a', [''], true, false], watch, chats)).toBe(true)
    expect(isFilesEventFor(FilesEvent.changed, ['/b', [''], true, false], watch, chats)).toBe(false)
    expect(isFilesEventFor(FilesEvent.gitBranchChanged, ['/r', null], watch, chats)).toBe(true)
    expect(isFilesEventFor(FilesEvent.gitBranchChanged, ['/a', null], watch, chats)).toBe(false)
    expect(isFilesEventFor(FilesEvent.touched, ['s1', []], watch, chats)).toBe(true)
    expect(isFilesEventFor(FilesEvent.touched, ['s2', []], watch, chats)).toBe(false)
  })

  it('passes nothing to a device that watches nothing', () => {
    expect(isFilesEventFor(FilesEvent.changed, ['/a', [''], true, false], NO_FILES_WATCH, new Set())).toBe(false)
    expect(isFilesEventFor(IpcEvent.sessionsChanged, [], watch, chats)).toBe(false)
  })
})

describe('queueFilesEvent', () => {
  it('joins the changes of a folder still waiting, each folder once, at the end', () => {
    let queue = queueFilesEvent([], FilesEvent.changed, ['/a', ['src'], false, false])
    queue = queueFilesEvent(queue, FilesEvent.changed, ['/b', [''], true, false])
    queue = queueFilesEvent(queue, FilesEvent.changed, ['/a', ['src', 'lib'], true, true])
    expect(queue).toEqual([
      { ch: FilesEvent.changed, args: ['/b', [''], true, false] },
      { ch: FilesEvent.changed, args: ['/a', ['src', 'lib'], true, true] },
    ])
    // What git saw stays seen when a later change doesn't tell it again.
    queue = queueFilesEvent(queue, FilesEvent.changed, ['/a', ['docs'], false, false])
    expect(queue.at(-1)).toEqual({ ch: FilesEvent.changed, args: ['/a', ['src', 'lib', 'docs'], true, true] })
  })

  it("adds an agent's touches to those waiting, and keeps the latest branch", () => {
    let queue = queueFilesEvent([], FilesEvent.touched, ['s1', [{ path: '/a/x', kind: 'read' }]])
    queue = queueFilesEvent(queue, FilesEvent.touched, ['s1', [{ path: '/a/y', kind: 'write' }]])
    expect(queue).toEqual([
      {
        ch: FilesEvent.touched,
        args: [
          's1',
          [
            { path: '/a/x', kind: 'read' },
            { path: '/a/y', kind: 'write' },
          ],
        ],
      },
    ])
    queue = queueFilesEvent(queue, FilesEvent.gitBranchChanged, ['/r', { name: 'main', detached: false }])
    queue = queueFilesEvent(queue, FilesEvent.gitBranchChanged, ['/r', { name: 'feat', detached: false }])
    expect(queue.filter((e) => e.ch === FilesEvent.gitBranchChanged)).toEqual([{ ch: FilesEvent.gitBranchChanged, args: ['/r', { name: 'feat', detached: false }] }])
  })

  it('leaves the events of other kinds as they are', () => {
    const other = { ch: IpcEvent.sessionsChanged, args: [{ id: 's1' }] }
    const queue = queueFilesEvent([other], FilesEvent.changed, ['/a', [''], false, false])
    expect(queue).toEqual([other, { ch: FilesEvent.changed, args: ['/a', [''], false, false] }])
  })
})
