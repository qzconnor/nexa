import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, Project, SessionMeta } from '@shared/types'
import type { CliSessionInfo } from '../providers/provider'
import { CliSessionImport } from './cli-import'

let root: string
let app: string
let other: string
let claudeHome: string
let settings: AppSettings

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexa-cli-import-'))
  app = join(root, 'app')
  other = join(root, 'other')
  claudeHome = join(root, 'claude')
  await mkdir(join(app, 'sub'), { recursive: true })
  await mkdir(other, { recursive: true })
  settings = defaultSettings()
})

afterEach(() => rm(root, { recursive: true, force: true }))

/** A Claude Code transcript with one prompt and its answer, begun in `cwd`. */
async function transcript(id: string, cwd: string, prompt: string): Promise<void> {
  const dir = join(claudeHome, 'projects', 'key')
  await mkdir(dir, { recursive: true })
  const at = new Date(Date.UTC(2026, 10, 1, 10)).toISOString()
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: at, cwd, message: { role: 'user', content: prompt } },
    { type: 'assistant', uuid: 'a1', timestamp: at, message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Antwort' }] } },
  ]
  await writeFile(join(dir, `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}

function setup(options: { known?: string[]; threads?: Record<string, CliSessionInfo[] | Error>; projects?: Project[] }) {
  const projects: Project[] = options.projects ?? []
  const adopted: Omit<SessionMeta, 'id'>[] = []
  const accounts = [
    { id: 'system', provider: 'claude', name: 'Standard' },
    { id: 'system-codex', provider: 'codex', name: 'Standard' },
    { id: 'codex-b', provider: 'codex', name: 'Arbeit' },
  ]
  const threads = options.threads ?? {}
  const cli = new CliSessionImport(
    {
      list: () => projects,
      create: vi.fn(async ({ path }: { path: string }) => {
        const existing = projects.find((p) => p.path === path)
        if (existing) return existing
        const project = { id: `p${projects.length + 1}`, name: path, path, createdAt: 0, updatedAt: 0 }
        projects.push(project)
        return project
      }),
    } as never,
    {
      knownCliSessions: () => new Set(options.known ?? []),
      adopt: (metas: Omit<SessionMeta, 'id'>[]) => adopted.push(...metas) && metas.length,
      list: () => adopted.map((meta, i) => ({ ...meta, id: `chat-${i + 1}` })),
    } as never,
    {
      list: () => accounts,
      claudePaths: () => ({ configDir: claudeHome }),
      codexPaths: (id: string) => ({ configDir: join(root, id) }),
    } as never,
    {
      isReady: () => true,
      sessions: async (_provider: string, accountId: string) => {
        const found = threads[accountId] ?? []
        if (found instanceof Error) throw found
        return found
      },
    } as never,
    () => settings,
  )
  return { importer: cli, adopted, projects }
}

const thread = (id: string, cwd: string, updatedAt: number, more: Partial<CliSessionInfo> = {}): CliSessionInfo => ({
  id,
  cwd,
  title: null,
  firstPrompt: `Frage ${id}`,
  createdAt: updatedAt - 1000,
  updatedAt,
  ...more,
})

describe('CliSessionImport', () => {
  it('sorts the sessions of both CLIs into the projects of their folders', async () => {
    await transcript('c1', join(app, 'sub'), 'Baue den Export')
    await transcript('c2', other, 'Schon in Nexa')
    const { importer } = setup({
      known: ['c2', 't-known'],
      projects: [{ id: 'p0', name: 'app', path: app, createdAt: 0, updatedAt: 0 }],
      threads: {
        'system-codex': [thread('t1', other, 5000), thread('t-known', other, 1000)],
        // The same thread in another account's folder: where it went on last counts.
        'codex-b': [thread('t1', other, 9000), thread('t2', app, 2000)],
      },
    })

    const preview = await importer.scan()

    expect(preview.groups).toMatchObject([
      { path: app, kind: 'project', sessions: 2, inSubfolders: 1, counts: { claude: 1, codex: 1 } },
      { path: other, kind: 'folder', sessions: 1, counts: { claude: 0, codex: 1 }, updatedAt: 9000 },
    ])
    expect(preview).toMatchObject({ known: 2, skipped: 0, failed: [] })
  })

  it('takes over the groups chosen as chats that go on with their CLI', async () => {
    await transcript('c1', join(app, 'sub'), 'Baue den Export')
    const { importer, adopted, projects } = setup({ threads: { 'codex-b': [thread('t1', other, 9000, { title: 'Eigener Name' })] } })
    await importer.scan()

    // Without a project of its own above it, the folder the session ran in becomes one.
    expect(await importer.run({ groups: [join(app, 'sub'), other] })).toEqual({ projects: 2, sessions: 2 })
    expect(projects.map((p) => p.path)).toEqual([join(app, 'sub'), other])
    const claude = adopted.find((m) => m.provider === 'claude')!
    expect(claude).not.toHaveProperty('cwd')
    expect(claude).toMatchObject({
      projectId: 'p1',
      title: 'Baue den Export',
      titleSource: 'auto',
      cli: { claude: { sessionId: 'c1', configDir: claudeHome, accountId: 'system', seenItems: 0 } },
      importedFrom: join(claudeHome, 'projects', 'key', 'c1.jsonl'),
    })
    expect(adopted.find((m) => m.provider === 'codex')).toMatchObject({
      projectId: 'p2',
      title: 'Eigener Name',
      titleSource: 'user',
      updatedAt: 9000,
      cli: { codex: { sessionId: 't1', configDir: join(root, 'codex-b'), accountId: 'codex-b' } },
      accounts: { codex: 'codex-b' },
      importedFrom: 't1',
    })
  })

  it('says which account it couldn’t read and leaves out CLIs that are off', async () => {
    settings.claude.enabled = false
    await transcript('c1', app, 'Nicht dabei')
    const { importer } = setup({ threads: { 'system-codex': new Error('codex app-server beendet'), 'codex-b': [thread('t2', app, 2000)] } })

    const preview = await importer.scan()

    expect(preview.failed).toEqual(['Codex (Standard): codex app-server beendet'])
    expect(preview.groups).toMatchObject([{ path: app, counts: { claude: 0, codex: 1 } }])
  })
})

describe('CliSessionImport.takeOver', () => {
  it('takes over one session of Claude Code by its id, into the project its folder lies in', async () => {
    await transcript('c1', join(app, 'sub'), 'Baue den Export')
    const { importer, adopted } = setup({ projects: [{ id: 'p0', name: 'app', path: app, createdAt: 0, updatedAt: 0 }] })

    expect(await importer.takeOver('c1')).toBe('chat-1')
    expect(adopted).toMatchObject([{ projectId: 'p0', cwd: join(app, 'sub'), cli: { claude: { sessionId: 'c1' } } }])
  })

  it('takes over a thread of Codex, and nothing it can’t find', async () => {
    const { importer, adopted, projects } = setup({ threads: { 'codex-b': [thread('t1', other, 9000)] } })

    expect(await importer.takeOver('t1')).toBe('chat-1')
    expect(projects.map((p) => p.path)).toEqual([other])
    expect(adopted[0]).toMatchObject({ provider: 'codex', accounts: { codex: 'codex-b' } })
    expect(await importer.takeOver('t-unknown')).toBeNull()
  })
})
