import { describe, expect, it } from 'vitest'
import type { SessionMeta } from '@shared/types'
import { chatsIn, foldersOf, movePinned, orderPinned, pinnedChats, projectTree } from './session-tree'

const meta = (id: string, updatedAt: number, cwd?: string, pinned?: boolean): SessionMeta => ({
  id,
  projectId: 'p',
  title: id,
  titleSource: 'auto',
  provider: 'claude',
  model: '',
  effort: '',
  permissionMode: 'ask',
  createdAt: 0,
  updatedAt,
  cli: {},
  ...(cwd ? { cwd } : {}),
  ...(pinned ? { pinned } : {}),
})

describe('projectTree', () => {
  it('puts chats into the folders they work in, level by level', () => {
    const tree = projectTree('p', 'F:\\Projekte\\Apps', [
      meta('own', 5),
      meta('pinned', 1, undefined, true),
      meta('nexa', 30, 'F:\\Projekte\\Apps\\nexa'),
      meta('nexa-src', 40, 'f:/projekte/apps/nexa/src'),
      meta('deep', 10, 'F:\\Projekte\\Apps\\cm\\packages\\core'),
      meta('outside', 3, 'D:\\Anderswo'),
    ])
    expect(tree.sessions.map((s) => s.id)).toEqual(['pinned', 'own', 'outside'])
    expect(tree.folders.map((f) => [f.name, f.count, f.updatedAt, f.path])).toEqual([
      ['nexa', 2, 40, 'F:\\Projekte\\Apps\\nexa'],
      ['cm/packages/core', 1, 10, 'F:\\Projekte\\Apps\\cm\\packages\\core'],
    ])
    const [nexa] = tree.folders
    expect(nexa!.sessions.map((s) => s.id)).toEqual(['nexa'])
    expect(nexa!.folders.map((f) => [f.name, f.sessions.map((s) => s.id)])).toEqual([['src', ['nexa-src']]])
    expect(foldersOf(tree, 'nexa-src')).toEqual([nexa!.id, nexa!.folders[0]!.id])
    expect(foldersOf(tree, 'own')).toEqual([])
    // What a folded project or folder sums up: its chats and those below.
    expect(chatsIn(tree).map((s) => s.id).sort()).toEqual(['deep', 'nexa', 'nexa-src', 'outside', 'own', 'pinned'])
    expect(chatsIn(nexa!).map((s) => s.id)).toEqual(['nexa', 'nexa-src'])
  })

  it('shows a worktree as one level by its name', () => {
    const tree = projectTree('p', 'F:\\Code\\app', [
      meta('login', 30, 'F:\\Code\\app\\.claude\\worktrees\\login'),
      meta('login-src', 20, 'F:\\Code\\app\\.claude\\worktrees\\login\\src'),
      meta('fix', 10, 'F:\\Code\\app\\.claude\\worktrees\\fix\\src'),
      meta('config', 5, 'F:\\Code\\app\\.claude'),
    ])
    expect(tree.folders.map((f) => [f.name, f.worktree, f.path])).toEqual([
      ['login', true, 'F:\\Code\\app\\.claude\\worktrees\\login'],
      ['fix/src', true, 'F:\\Code\\app\\.claude\\worktrees\\fix\\src'],
      ['.claude', false, 'F:\\Code\\app\\.claude'],
    ])
    expect(tree.folders[0]!.folders.map((f) => [f.name, f.worktree])).toEqual([['src', false]])
  })
})

describe('pinnedChats', () => {
  it('lists the pinned chats of the shown projects, the latest first', () => {
    const chats = [
      meta('old', 1, undefined, true),
      meta('loose', 50),
      meta('new', 20, 'F:\Projekte\Apps\nexa', true),
      { ...meta('archived', 30, undefined, true), archived: true },
      { ...meta('elsewhere', 40, undefined, true), projectId: 'gone' },
    ]
    expect(pinnedChats(chats, new Set(['p'])).map((s) => s.id)).toEqual(['new', 'old'])
  })
})

const row = (key: string, updatedAt: number) => ({ key, meta: meta(key, updatedAt) })

describe('orderPinned', () => {
  it('keeps the dragged order and puts chats pinned since on top, the latest first', () => {
    const rows = [row(':a', 1), row('laptop:b', 2), row(':new', 5), row(':newer', 9), row(':c', 3)]
    expect(orderPinned(rows, ['laptop:b', ':gone', ':c', ':a']).map((r) => r.key)).toEqual([':newer', ':new', 'laptop:b', ':c', ':a'])
  })

  it('shows the latest first while nothing was dragged', () => {
    expect(orderPinned([row(':a', 1), row(':b', 2)], []).map((r) => r.key)).toEqual([':b', ':a'])
  })
})

describe('movePinned', () => {
  const all = () => true

  it('moves a chat before another one or to the end', () => {
    expect(movePinned([], [':a', ':b', ':c'], ':c', ':a', all)).toEqual([':c', ':a', ':b'])
    expect(movePinned([], [':a', ':b', ':c'], ':a', null, all)).toEqual([':b', ':c', ':a'])
  })

  it('keeps the chats of a device not loaded behind the one they followed', () => {
    const order = ['off:x', ':a', 'off:y', ':b', ':c']
    expect(movePinned(order, [':a', ':b', ':c'], ':c', ':a', all)).toEqual(['off:x', ':c', ':a', 'off:y', ':b'])
  })

  it('does not take them along with the chat they followed', () => {
    expect(movePinned([':a', 'off:y', ':b'], [':a', ':b'], ':a', null, all)).toEqual(['off:y', ':b', ':a'])
  })

  it('drops what `keep` refuses: chats of loaded devices that are gone or let go', () => {
    const keep = (key: string) => key.startsWith('off:')
    expect(movePinned([':gone', 'off:x', ':a', ':b'], [':a', ':b'], ':b', ':a', keep)).toEqual(['off:x', ':b', ':a'])
  })
})
