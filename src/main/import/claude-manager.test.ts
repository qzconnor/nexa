import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TranscriptSummary } from '../providers/claude/claude-transcript'
import { cmAccounts, planGroups, projectFolder, sessionTitle, type FoundSession } from './claude-manager'

const summary = (cwd: string | null, updatedAt: number, patch: Partial<TranscriptSummary> = {}): TranscriptSummary => ({
  cwd,
  title: null,
  firstPrompt: 'Frage',
  lastPrompt: 'Frage',
  createdAt: updatedAt - 1000,
  updatedAt,
  messages: 2,
  ...patch,
})
const session = (id: string, cwd: string | null, updatedAt: number): FoundSession => ({ id, file: `${id}.jsonl`, configDir: 'C:\\cfg', mtimeMs: updatedAt, summary: summary(cwd, updatedAt) })

describe('cmAccounts', () => {
  // Absolute on the system the tests run on: the folders from the environment are resolved.
  const claude = resolve('/cfg/claude')
  const cm = resolve('/cfg/cm')
  const env = { CLAUDE_CONFIG_DIR: claude, CODEX_HOME: resolve('/cfg/codex') }

  it('finds the folder of every account as the Claude Manager does', () => {
    const accounts = cmAccounts(
      {
        version: 1,
        accounts: [
          { id: 'system', name: 'Standard', kind: 'system', color: '#111111', configDir: null },
          { id: 'a1', name: 'Arbeit', kind: 'oauth', color: '#222222', configDir: null, secret: 'verschlüsselt' },
          { id: 'a2', name: 'Eigen', provider: 'claude', kind: 'oauth', color: '#333333', configDir: 'D:\\eigen' },
          { id: 'c1', name: 'Codex', provider: 'codex', kind: 'oauth', color: '#444444', configDir: null },
          { id: 'x', kind: 'unbekannt' },
        ],
      },
      cm,
      env,
    )
    expect(accounts.map((a) => [a.id, a.provider, a.kind, a.configDir])).toEqual([
      ['system', 'claude', 'system', claude],
      ['a1', 'claude', 'oauth', join(cm, 'profiles', 'a1')],
      ['a2', 'claude', 'oauth', 'D:\\eigen'],
      ['c1', 'codex', 'oauth', join(cm, 'profiles', 'c1')],
    ])
    expect(Object.keys(accounts[1]!)).not.toContain('secret')
  })

  it('adds the standard account of Claude Code when the file doesn’t list it', () => {
    expect(cmAccounts(null, cm, env)).toEqual([expect.objectContaining({ id: 'system', kind: 'system', configDir: claude })])
  })
})

describe('planGroups', () => {
  it('puts sessions into the innermost workspace or project, and folders of their own elsewhere', () => {
    const groups = planGroups(
      [
        session('s1', 'F:\\Projekte\\Apps\\nexa', 30),
        session('s2', 'f:/projekte/apps/nexa/src', 20),
        session('s3', 'F:\\Projekte\\Flowtech\\api', 10),
        session('s4', 'C:\\Users\\me\\Downloads', 40),
        session('s5', 'D:\\Kunde', 5),
        session('s6', null, 50),
      ],
      ['F:\\Projekte', 'F:\\Projekte\\Apps', 'E:\\Leer'],
      [{ path: 'D:\\Kunde' }],
      (path) => !path.startsWith('E:'),
    )
    expect(groups.map((g) => [g.path, g.kind, g.sessions, g.inSubfolders, g.updatedAt, g.exists, g.projects])).toEqual([
      ['F:\\Projekte\\Apps', 'workspace', 2, 2, 30, true, 1],
      ['F:\\Projekte', 'workspace', 1, 1, 10, true, 1],
      ['D:\\Kunde', 'project', 1, 0, 5, true, undefined],
      ['E:\\Leer', 'workspace', 0, 0, null, false, 0],
      ['C:\\Users\\me\\Downloads', 'folder', 1, 0, 40, true, undefined],
    ])
    expect(groups[0]!.members.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('keeps a workspace one when Nexa has a project of its folder, and counts the projects it becomes', () => {
    const groups = planGroups(
      [session('a', 'F:\\W', 3), session('b', 'F:\\W\\x\\deep', 2), session('c', 'f:/w/X', 1), session('d', 'F:\\W\\z\\in', 4)],
      ['F:\\W'],
      [{ path: 'F:\\W' }, { path: 'F:\\W\\z' }],
      () => true,
    )
    expect(groups.map((g) => [g.path, g.kind, g.sessions, g.projects])).toEqual([
      ['F:\\W\\z', 'project', 1, undefined],
      ['F:\\W', 'workspace', 3, 2],
    ])
  })
})

describe('projectFolder', () => {
  it('is the subfolder of the first level, else the workspace', () => {
    expect(projectFolder('F:\\W\\app\\src', 'F:\\W')).toBe('F:\\W\\app')
    expect(projectFolder('f:/w/app', 'F:\\W')).toBe('F:\\W\\app')
    expect(projectFolder('F:\\W', 'F:\\W')).toBe('F:\\W')
  })
})

describe('sessionTitle', () => {
  it('takes the Claude Manager’s name, then the session’s own, then the first prompt', () => {
    expect(sessionTitle(summary('x', 1, { title: 'Von Claude' }), 'Mein Name')).toEqual({ title: 'Mein Name', titleSource: 'user' })
    expect(sessionTitle(summary('x', 1, { title: 'Von Claude' }), undefined)).toEqual({ title: 'Von Claude', titleSource: 'user' })
    expect(sessionTitle(summary('x', 1, { firstPrompt: 'Wie geht das?\nMehr' }), undefined)).toEqual({ title: 'Wie geht das?', titleSource: 'auto' })
    expect(sessionTitle(summary('x', 1, { firstPrompt: null }), undefined)).toEqual({ title: 'Ohne Titel', titleSource: 'auto' })
  })
})
