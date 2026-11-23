import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, SessionMeta } from '@shared/types'
import type { ChatItem, SessionRuntime } from '@shared/chat'
import { claudeProjectKey } from '../accounts/cli-files'
import type { AgentProvider, AgentRun, RunInput, RunSink } from '../providers/provider'
import { SessionService } from './session-service'

const CWD = 'F:\\Projekte\\demo'
const GONE = '2f2591e1-0000-4000-8000-000000000001'
const STAYS = '2f2591e1-0000-4000-8000-000000000002'
const THREAD = '019a1b2c-3d4e-7f00-8000-00000000abcd'

let root: string
let dataDir: string
let claudeA: string
let claudeB: string
let codexA: string
let settings: AppSettings
let trashed: string[]
let service: SessionService | null

async function put(path: string, text = 'x'): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

const exists = (path: string) => stat(path).then(() => true, () => false)

function meta(id: string, patch: Partial<SessionMeta>): SessionMeta {
  return {
    id,
    projectId: 'p1',
    title: id,
    titleSource: 'user',
    provider: 'claude',
    model: '',
    effort: '',
    permissionMode: 'ask',
    createdAt: 1,
    updatedAt: 1,
    cli: {},
    ...patch,
  }
}

/** A Claude Code session in a config folder: transcript, subagents next to it, rewind snapshots. */
async function claudeSession(configDir: string, sessionId: string): Promise<void> {
  const project = join(configDir, 'projects', claudeProjectKey(CWD))
  await put(join(project, `${sessionId}.jsonl`), '12345')
  await put(join(project, sessionId, 'subagents', 'agent-1.jsonl'), '123')
  await put(join(configDir, 'file-history', sessionId, 'abc@v1'), '1')
}

async function start(metas: SessionMeta[], provider: Partial<AgentProvider> = {}): Promise<SessionService> {
  await put(join(dataDir, 'sessions.json'), JSON.stringify({ sessions: metas }))
  const accounts = {
    list: () => [
      { id: 'claude-a', provider: 'claude' },
      { id: 'claude-b', provider: 'claude' },
      { id: 'codex-a', provider: 'codex' },
    ],
    claudePaths: (id: string) => ({ configDir: id === 'claude-a' ? claudeA : claudeB }),
    codexPaths: () => ({ configDir: codexA }),
    resolve: () => 'claude-a',
    get: () => ({ id: 'claude-a', kind: 'system' }),
    env: () => ({ accountId: 'claude-a', set: {}, unset: [] }),
    extraArgs: () => [],
  }
  const projects = { get: (id: string) => (id === 'p1' ? { id, path: CWD } : undefined), touch: async () => {}, promptsFor: async () => [] }
  const providers = { isReady: () => true, defaultAccount: () => 'claude-a', get: () => provider, setUsage: () => {} }
  const mcp = { revoke: vi.fn(), running: false }
  service = new SessionService(
    dataDir,
    projects as never,
    providers as never,
    accounts as never,
    mcp as never,
    () => settings,
    () => ({}) as never,
    async (path) => {
      trashed.push(path)
      await rm(path, { recursive: true })
    },
  )
  return service
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexa-remove-'))
  dataDir = join(root, 'data')
  claudeA = join(root, 'claude-a')
  claudeB = join(root, 'claude-b')
  codexA = join(root, 'codex-a')
  settings = defaultSettings()
  trashed = []
  service = null
})

afterEach(async () => {
  await service?.dispose()
  await rm(root, { recursive: true, force: true })
})

describe('SessionService.remove', () => {
  it('takes the CLIs’ conversations along, from every account that has a copy', async () => {
    await claudeSession(claudeA, GONE)
    await claudeSession(claudeB, GONE)
    const rollout = join(codexA, 'sessions', '2026', '11', '23', `rollout-2026-11-23T10-00-00-${THREAD}.jsonl`)
    await put(rollout, '1234567890')
    const sessions = await start([
      meta('chat', { cli: { claude: { sessionId: GONE, seenItems: 0, configDir: claudeA }, codex: { sessionId: THREAD, seenItems: 0 } } }),
    ])

    const result = await sessions.remove(['chat', 'unknown'])

    expect(result).toMatchObject({ removed: ['chat'], trashed: 7, bytes: 2 * 9 + 10, openElsewhere: [], failed: 0 })
    expect(await exists(rollout)).toBe(false)
    expect(await readdir(join(claudeB, 'projects', claudeProjectKey(CWD)))).toEqual([])
    expect(sessions.list()).toEqual([])
  })

  it('leaves conversations another chat goes on with', async () => {
    await claudeSession(claudeA, GONE)
    await claudeSession(claudeA, STAYS)
    const sessions = await start([
      // Forked from `source` without having run: GONE is still the source's conversation.
      meta('fork', { cli: { claude: { sessionId: STAYS, seenItems: 0, fork: { at: 'm1' } } } }),
      meta('source', { cli: { claude: { sessionId: STAYS, seenItems: 0 } } }),
      meta('twin', { cli: { claude: { sessionId: GONE, seenItems: 0 } } }),
      meta('other', { cli: { claude: { sessionId: GONE, seenItems: 0 } } }),
      meta('third', { cli: { claude: { sessionId: GONE, seenItems: 0 } } }),
    ])

    expect(await sessions.remove(['fork', 'twin'])).toMatchObject({ removed: ['fork', 'twin'], trashed: 0 })
    expect(trashed).toEqual([])
    // The last chats of a conversation at once: its files go, once.
    expect(await sessions.remove(['source', 'other', 'third', 'source'])).toMatchObject({ removed: ['source', 'other', 'third'], trashed: 6 })
    expect(new Set(trashed).size).toBe(6)
  })

  it('keeps a session Claude Code has open outside Nexa', async () => {
    await claudeSession(claudeA, GONE)
    await put(join(claudeA, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: GONE, entrypoint: 'cli' }))
    const sessions = await start([meta('chat', { cli: { claude: { sessionId: GONE, seenItems: 0 } } })])

    expect(await sessions.remove(['chat'])).toMatchObject({ removed: ['chat'], trashed: 0, openElsewhere: ['chat'] })
    expect(await exists(join(claudeA, 'projects', claudeProjectKey(CWD), `${GONE}.jsonl`))).toBe(true)
  })

  it('deletes only Nexa’s history when the setting is off', async () => {
    settings.chat.deleteCliConversations = false
    await claudeSession(claudeA, GONE)
    const sessions = await start([meta('chat', { cli: { claude: { sessionId: GONE, seenItems: 0 } } })])

    expect(await sessions.remove(['chat'])).toMatchObject({ removed: ['chat'], trashed: 0 })
    expect(trashed).toEqual([])
  })

  it('counts a file the recycle bin refuses', async () => {
    await claudeSession(claudeA, GONE)
    const sessions = await start([meta('chat', { cli: { claude: { sessionId: GONE, seenItems: 0 } } })])
    ;(sessions as unknown as { trash: (path: string) => Promise<void> }).trash = async () => {
      throw new Error('Zugriff verweigert')
    }

    expect(await sessions.remove(['chat'])).toMatchObject({ removed: ['chat'], trashed: 0, failed: 3, error: 'Zugriff verweigert' })
  })
})

describe('SessionService.send while the agent works', () => {
  /** A CLI that takes what it is sent; the test reports for it through `sink`. */
  async function working() {
    let sink: RunSink | null = null
    const sent: RunInput[] = []
    const run = { alive: true, send: async (input: RunInput) => void sent.push(input), stop: async () => {} } as unknown as AgentRun
    const sessions = await start([meta('chat', {})], {
      start: async (_options, s) => {
        sink = s
        return run
      },
    })
    let runtime: SessionRuntime | null = null
    sessions.on('event', (event: { type: string; runtime?: SessionRuntime }) => {
      if (event.type === 'runtime') runtime = event.runtime!
    })
    await sessions.send('chat', { text: 'erste' })
    sink!.cliSession(GONE)
    sink!.runtime({ status: 'running' })
    const texts = async () => ((await sessions.history('chat'))!.items as ChatItem[]).map((i) => (i.kind === 'user' ? i.text : i.kind))
    return { sessions, sink: () => sink!, sent, runtime: () => runtime!, texts }
  }

  it('waits below the chat until the CLI takes it up, then stands where it did', async () => {
    const { sessions, sink, sent, runtime, texts } = await working()
    await sessions.send('chat', { text: 'zweite' })

    expect(await texts()).toEqual(['erste'])
    expect(runtime().queued?.map((u) => u.text)).toEqual(['zweite'])
    expect(sent.map((s) => s.text)).toEqual(['erste', 'zweite'])

    sink().item({ kind: 'tool', id: 't1', ts: 1, provider: 'claude', tool: 'bash', name: 'Bash', title: 'Befehl', status: 'done', startedAt: 1 })
    sink().taken(sent[1]!.id)

    expect(await texts()).toEqual(['erste', 'tool', 'zweite'])
    expect(runtime()).not.toHaveProperty('queued')
  })

  it('keeps what the CLI never took up when it ends', async () => {
    const { sessions, sink, runtime, texts } = await working()
    await sessions.send('chat', { text: 'zweite' })
    sink().exited()

    expect(await texts()).toEqual(['erste', 'zweite'])
    expect(runtime()).toMatchObject({ status: 'idle' })
    expect(runtime()).not.toHaveProperty('queued')
  })
})

describe('SessionService.storage', () => {
  it('counts Nexa’s history and the CLI’s files', async () => {
    await claudeSession(claudeA, GONE)
    await put(join(dataDir, 'sessions', 'chat.jsonl'), '1234')
    const sessions = await start([meta('chat', { cli: { claude: { sessionId: GONE, seenItems: 0 } } }), meta('empty', {})])
    const bytes = async () => Object.fromEntries((await sessions.storage()).map((s) => [s.id, s.bytes]))

    expect(await bytes()).toEqual({ chat: 4 + 9, empty: 0 })
    settings.chat.deleteCliConversations = false
    expect(await bytes()).toEqual({ chat: 4, empty: 0 })
  })
})
