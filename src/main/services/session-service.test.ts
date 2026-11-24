import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, SessionMeta } from '@shared/types'
import type { ChatItem, SessionRuntime } from '@shared/chat'
import { claudeProjectKey } from '../accounts/cli-files'
import type { AgentProvider, AgentRun, RunInput, RunOptions, RunSink } from '../providers/provider'
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
/** What the CLI's server gives as a conversation's chat (`ProviderService.history`). */
let readHistory: (accountId: string, sessionId: string) => Promise<ChatItem[] | null>

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
    has: (id: string) => ['claude-a', 'claude-b', 'codex-a'].includes(id),
    resolve: () => 'claude-a',
    get: () => ({ id: 'claude-a', kind: 'system' }),
    env: () => ({ accountId: 'claude-a', set: {}, unset: [] }),
    extraArgs: () => [],
  }
  const projects = { get: (id: string) => (id === 'p1' ? { id, path: CWD } : undefined), touch: async () => {}, promptsFor: async () => [] }
  const providers = { isReady: () => true, defaultAccount: () => 'claude-a', get: () => provider, setUsage: () => {}, history: (_id: string, accountId: string, sessionId: string) => readHistory(accountId, sessionId) }
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
  readHistory = async () => null
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

describe('SessionService titles', () => {
  /** A CLI whose title for the first prompt comes when the test says so. */
  async function titled(patch: Partial<SessionMeta> = { titleSource: 'auto', title: 'Neuer Chat' }) {
    let give: (title: string | null) => void = () => {}
    const asked: string[] = []
    const run = {
      alive: true,
      send: async () => {},
      stop: async () => {},
      title: (prompt: string) => {
        asked.push(prompt)
        return new Promise<string | null>((resolve) => (give = resolve))
      },
    } as unknown as AgentRun
    const sessions = await start([meta('chat', patch)], { start: async () => run })
    const title = () => sessions.list()[0]!.title
    /** The title arrives; the session service takes it up a tick later. */
    const answer = async (value: string | null) => {
      give(value)
      await new Promise((r) => setTimeout(r, 0))
    }
    return { sessions, asked, title, answer }
  }

  it('shows the first line until the model names the chat', async () => {
    const { sessions, asked, title, answer } = await titled()
    await sessions.send('chat', { text: 'Wie plane ich eine Reise nach Kyoto?\nMit Kindern.' })

    expect(title()).toBe('Wie plane ich eine Reise nach Kyoto?')
    expect(asked).toEqual(['Wie plane ich eine Reise nach Kyoto?\nMit Kindern.'])
    await answer('Familienreise nach Kyoto')
    expect(title()).toBe('Familienreise nach Kyoto')
    expect(sessions.list()[0]!.titleSource).toBe('auto')
  })

  it('asks only for the first prompt', async () => {
    const { sessions, asked, answer } = await titled()
    await sessions.send('chat', { text: 'erste' })
    await answer('Titel')
    await sessions.send('chat', { text: 'zweite' })
    expect(asked).toEqual(['erste'])
  })

  it('keeps a name the user gave meanwhile', async () => {
    const { sessions, title, answer } = await titled()
    await sessions.send('chat', { text: 'erste' })
    await sessions.update('chat', { title: 'Mein Name' })
    await answer('Vom Modell')
    expect(title()).toBe('Mein Name')
  })

  it('keeps the first line without a title', async () => {
    const { sessions, title, answer } = await titled()
    await sessions.send('chat', { text: 'erste' })
    await answer(null)
    expect(title()).toBe('erste')
  })

  it('asks nothing when the setting is off or the chat has a name', async () => {
    settings.chat.autoTitles = false
    const off = await titled()
    await off.sessions.send('chat', { text: 'erste' })
    expect(off.asked).toEqual([])
    expect(off.title()).toBe('erste')
    await off.sessions.dispose()

    settings.chat.autoTitles = true
    const named = await titled({ titleSource: 'user', title: 'Mein Name' })
    await named.sessions.send('chat', { text: 'erste' })
    expect(named.asked).toEqual([])
    expect(named.title()).toBe('Mein Name')
  })
})

describe('SessionService with a session taken over from Codex', () => {
  const imported = () => meta('chat', { provider: 'codex', cli: { codex: { sessionId: THREAD, seenItems: 0, accountId: 'codex-a' } }, importedFrom: THREAD })

  it('reads its history once, through the app-server of the account that keeps it', async () => {
    const asked: string[] = []
    readHistory = async (accountId, sessionId) => {
      asked.push(`${accountId}:${sessionId}`)
      return [{ kind: 'user', id: 'u1', ts: 1, provider: 'codex', text: 'Hallo' }]
    }
    const sessions = await start([imported()])

    expect((await sessions.history('chat'))!.items).toMatchObject([{ kind: 'user', text: 'Hallo' }])
    expect((await sessions.history('chat'))!.items).toHaveLength(1)
    expect(asked).toEqual([`codex-a:${THREAD}`])
    const saved = sessions.list()[0]!
    expect(saved).not.toHaveProperty('importedFrom')
    // Codex has seen all of it: the next prompt doesn't send it again as context.
    expect(saved.cli.codex!.seenItems).toBe(1)
  })

  it('says so when Codex keeps no history of it', async () => {
    readHistory = async () => []
    const sessions = await start([imported()])
    expect((await sessions.history('chat'))!.items).toMatchObject([{ kind: 'notice', level: 'warning' }])
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

describe('SessionService.clear', () => {
  /** A chat with one finished turn in GONE; the CLI's starts and prompts are recorded. */
  async function talked(patch: Partial<SessionMeta> = {}) {
    let sink: RunSink | null = null
    const starts: RunOptions[] = []
    const sent: string[] = []
    /** The prompts the model was asked to name the chat by; it names it „Über <prompt>“. */
    const asked: string[] = []
    const title = async (prompt: string) => {
      asked.push(prompt)
      return `Über ${prompt}`
    }
    const run = { alive: true, send: async (input: RunInput) => void sent.push(input.text), stop: async () => {}, title } as unknown as AgentRun
    const sessions = await start([meta('chat', { title: 'Mein Chat', pinned: true, ...patch })], {
      start: async (options, s) => {
        starts.push(options)
        sink = s
        return run
      },
    })
    await sessions.send('chat', { text: 'erste' })
    sink!.cliSession(GONE)
    sink!.item({ kind: 'assistant', id: 'a1', ts: 2, provider: 'claude', text: 'Antwort' })
    sink!.item({ kind: 'turn', id: 'turn1', ts: 3, provider: 'claude', status: 'done' })
    sink!.runtime({ status: 'idle', context: { used: 1000, max: 200_000 } as never })
    const items = async () => (await sessions.history('chat'))!.items as ChatItem[]
    return { sessions, sink: () => sink!, starts, sent, asked, items }
  }

  it('names a chat the model named again by its first prompt after it', async () => {
    const { sessions, asked } = await talked({ titleSource: 'auto', title: 'Neue Session' })
    await new Promise((r) => setTimeout(r, 0))
    expect(sessions.list()[0]!.title).toBe('Über erste')

    await sessions.clear('chat')
    await sessions.send('chat', { text: 'zweite' })
    await sessions.send('chat', { text: 'dritte' })
    await new Promise((r) => setTimeout(r, 0))

    expect(asked).toEqual(['erste', 'zweite'])
    expect(sessions.list()[0]).toMatchObject({ title: 'Über zweite', titleSource: 'auto' })
  })

  it('keeps a name the user gave', async () => {
    const { sessions, asked } = await talked()
    await sessions.clear('chat')
    await sessions.send('chat', { text: 'zweite' })
    await new Promise((r) => setTimeout(r, 0))

    expect(asked).toEqual([])
    expect(sessions.list()[0]).toMatchObject({ title: 'Mein Chat', titleSource: 'user' })
  })

  it('starts a new conversation in the same chat, without what came before', async () => {
    const { sessions, starts, sent, items } = await talked()

    const cleared = await sessions.clear('chat')

    expect(cleared).toMatchObject({ id: 'chat', title: 'Mein Chat', pinned: true, cli: {}, contextFrom: 4 })
    expect(cleared.earlierCli).toEqual([{ claude: expect.objectContaining({ sessionId: GONE }) }])
    expect(cleared).not.toHaveProperty('context')
    expect((await items()).at(-1)).toMatchObject({ kind: 'notice', cleared: true, text: 'Kontext geleert' })

    await sessions.send('chat', { text: 'zweite' })
    expect(starts.map((o) => o.resumeId)).toEqual([undefined, undefined])
    // No context from before: the CLI gets the prompt alone.
    expect(sent).toEqual(['erste', 'zweite'])
  })

  it('hands no CLI what came before, not when switching either', async () => {
    const { sessions, sent } = await talked()
    await sessions.clear('chat')
    await sessions.update('chat', { provider: 'codex' })
    await sessions.send('chat', { text: 'zweite' })
    expect(sent.at(-1)).toBe('zweite')
  })

  it('adds nothing when nothing was said since', async () => {
    const { sessions, items } = await talked()
    await sessions.clear('chat')
    const count = (await items()).length
    const again = await sessions.clear('chat')
    expect((await items()).length).toBe(count)
    expect(again.earlierCli).toHaveLength(1)
  })

  it('waits for the agent to finish', async () => {
    const { sessions, sink } = await talked()
    sink().runtime({ status: 'running' })
    await expect(sessions.clear('chat')).rejects.toThrow('lässt er sich leeren')
  })

  it('takes the conversations from before along when the chat is deleted', async () => {
    await claudeSession(claudeA, GONE)
    const { sessions } = await talked()
    await sessions.clear('chat')
    expect(await sessions.remove(['chat'])).toMatchObject({ removed: ['chat'], trashed: 3 })
  })

  it('leaves them to the chat a fork came from', async () => {
    const { sessions } = await talked()
    await sessions.clear('chat')
    const fork = await sessions.fork('chat')
    expect(fork).not.toHaveProperty('earlierCli')
    expect(fork.contextFrom).toBe(4)
  })
})
