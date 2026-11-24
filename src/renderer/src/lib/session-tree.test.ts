import { describe, expect, it } from 'vitest'
import type { SessionMeta } from '@shared/types'
import { chatsIn, foldersOf, pinnedChats, projectTree } from './session-tree'

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
