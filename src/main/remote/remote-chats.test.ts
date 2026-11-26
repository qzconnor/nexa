import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, ChatOrigin, ProviderId } from '@shared/chat'
import { RemoteKind, type RemoteErrorCode, type RemoteLevel, type RemoteResponse } from '@shared/remote'
import type { RemoteChatMethod } from '@shared/remote-chats'
import type { SessionSearchHit } from '@shared/types'
import { ChatTools, type ChatDevice, type ChatPeers } from '../mcp/chat-tools'
import type { PeerChat } from '../services/session-service'
import { FakeServer } from '../server-link/fake-server'
import type { SecretCodec } from '../server-link/link-store'
import { ServerLinkService } from '../server-link/server-link-service'
import { createRemote, type Remote } from './remote'
import { DeviceChats, RemoteChatsHost, type DeviceChatsDeps } from './remote-chats'
import { RemoteError } from './remote-client'
import { RemoteHost } from './remote-host'

vi.mock('electron', () => ({ safeStorage: {} }))

const NOW = 1_800_000_000_000

function peer(id: string, title: string, patch: Partial<PeerChat> = {}): PeerChat {
  return { id, title, provider: 'claude', projectId: 'p1', project: 'nexa', folder: 'F:\\nexa', status: 'idle', updatedAt: NOW - 60_000, archived: false, ...patch }
}

const PROJECTS = [
  { id: 'p1', name: 'nexa', path: 'F:\\Projekte\\nexa' },
  { id: 'p2', name: 'nexa-server', path: 'F:\\Projekte\\nexa-server' },
  { id: 'p3', name: 'cm', path: 'F:\\Projekte\\claude-manager' },
]

interface Delivered {
  to: string
  text: string
  from: { origin: ChatOrigin; chain: number }
}

/** The receiving device's side: a `RemoteChatsHost` behind a `RemoteHost`, as Remote Control asks it. */
function receiver(options: { level?: RemoteLevel; enabled?: boolean; chatTools?: boolean; trusted?: boolean } = {}) {
  const state = { level: 'prompt' as RemoteLevel, enabled: true, chatTools: true, trusted: true, now: NOW, ...options }
  const delivered: Delivered[] = []
  const created: { input: { projectId: string; provider: ProviderId; text: string; title?: string }; from: { origin: ChatOrigin; chain: number } }[] = []
  const chats = [peer('c1', 'Server-Umbau', { status: 'running' }), peer('c2', 'Alter Plan', { archived: true }), peer('c3', 'Release', { projectId: 'p3', project: 'cm', folder: 'F:\\cm' })]
  const items: Record<string, ChatItem[]> = {
    c1: [
      { kind: 'user', id: 'u1', ts: 1, provider: 'claude', text: 'Bau den Server um' },
      { kind: 'assistant', id: 'a1', ts: 2, provider: 'claude', text: 'Mache ich.' },
    ],
  }
  const hits: SessionSearchHit[] = [{ sessionId: 'c2', role: 'assistant', provider: 'claude', snippet: '…der alte Plan…' }]
  const searched: string[] = []
  const chatsHost = new RemoteChatsHost({
    enabled: () => state.chatTools,
    link: { trusted: () => state.trusted, deviceName: (id) => ({ laptop: 'Laptop' })[id] ?? null },
    chats: {
      list: () => chats,
      items: async (id) => items[id] ?? null,
      search: async (query) => {
        searched.push(query)
        return query.includes('plan') ? hits : []
      },
      projects: () => PROJECTS,
      send: async (to, text, from) => void delivered.push({ to, text, from }),
      create: async (input, from) => {
        created.push({ input, from })
        return { id: 'n1', title: input.title ?? 'Neue Session' }
      },
    },
    maxChain: 10,
    now: () => state.now,
  })
  const answers: RemoteResponse[] = []
  const host = new RemoteHost({
    link: {
      sendToDevice: async (_to, kind, data) => {
        if (kind === RemoteKind.response) answers.push(data as RemoteResponse)
        return `m${answers.length}`
      },
      selfName: () => 'Desktop',
      deviceName: (id) => ({ laptop: 'Laptop' })[id] ?? null,
      level: () => (state.enabled ? state.level : 'off'),
      enabled: () => state.enabled,
      revoke: async () => undefined,
      limits: () => ({ maxMessageBytes: 1024 * 1024, rateLimit: 100 }),
    },
    invoke: async () => {
      throw new Error('no window API in this test')
    },
    chats: (from, request) => chatsHost.handle(from, request),
    version: '1.0.0',
  })
  let next = 0
  async function ask(m: string, p: unknown = {}, from = 'laptop'): Promise<RemoteResponse> {
    const id = `r${++next}`
    await host.onDeviceMessage(from, RemoteKind.request, id, { m, p })
    const answer = answers.find((a) => a.re === id)
    if (!answer) throw new Error(`no answer to ${m}`)
    return answer
  }
  const sender = (sessionId = 's1') => ({ sessionId, title: 'Hier', provider: 'codex' })
  const send = (chain = 1, sessionId = 's1', to = 'c1') => ask('chats.send', { from: sender(sessionId), chain, to, text: 'Bitte prüfen.' })
  return { state, ask, send, sender, delivered, created, searched }
}

const error = (answer: RemoteResponse) => ('e' in answer ? answer.e : null)
const result = (answer: RemoteResponse) => ('r' in answer ? answer.r : undefined)

describe('RemoteChatsHost', () => {
  it('lets a device with the level to read look at the chats, but not write to them', async () => {
    const { ask, send, delivered } = receiver({ level: 'read' })
    expect(result(await ask('chats.list'))).toMatchObject({ chats: [{ id: 'c1', title: 'Server-Umbau', status: 'running' }, { id: 'c2', archived: true }, { id: 'c3' }] })
    expect(result(await ask('chats.read', { id: 'c1', last: 6 }))).toEqual({
      chat: expect.objectContaining({ id: 'c1' }),
      transcript: 'User: Bau den Server um\n\nClaude: Mache ich.',
    })
    expect(error(await send())).toEqual({ code: 'forbidden', message: 'needs level prompt' })
    expect(error(await ask('chats.new', { from: { sessionId: 's1', title: 'Hier', provider: 'codex' }, chain: 1, provider: 'claude', text: 'x', near: 'nexa' }))).toMatchObject({
      code: 'forbidden',
    })
    expect(delivered).toEqual([])
  })

  it('answers nothing while Remote Control is off, messages between chats are, or the device is not confirmed', async () => {
    expect(error(await receiver({ enabled: false }).ask('chats.list'))).toMatchObject({ code: 'disabled' })
    const off = receiver({ chatTools: false })
    expect(error(await off.ask('chats.list'))).toEqual({ code: 'forbidden', message: 'messages between chats are turned off there (Einstellungen › Chat).' })
    expect(error(await off.send())).toMatchObject({ code: 'forbidden' })
    expect(off.delivered).toEqual([])
    expect(error(await receiver({ trusted: false }).ask('chats.list'))).toMatchObject({ code: 'forbidden', message: expect.stringContaining('confirmed') })
  })

  it('delivers a message marked with its chat and the device as this one knows it, its place in the chain kept', async () => {
    const { send, delivered } = receiver()
    const answer = await send(4)
    expect(result(answer)).toMatchObject({ chat: { id: 'c1', status: 'running' } })
    expect(delivered).toEqual([
      { to: 'c1', text: 'Bitte prüfen.', from: { origin: { sessionId: 's1', title: 'Hier', provider: 'codex', device: { id: 'laptop', name: 'Laptop' } }, chain: 4 } },
    ])
  })

  it('stops a chain of messages past the limit, as on one device', async () => {
    const { send, delivered } = receiver()
    expect(error(await send(11))).toEqual({ code: 'failed', message: expect.stringMatching(/^Nexa stopped this: 10 messages between chats in a row without the user/) })
    expect(error(await send(10))).toBeNull()
    expect(delivered.map((d) => d.from.chain)).toEqual([10])
  })

  it('names a chat it doesn’t have, and counts no message for it', async () => {
    const { send, delivered } = receiver()
    expect(error(await send(1, 's1', 'weg'))).toMatchObject({ code: 'not-found', message: expect.stringContaining('no chat with the id weg') })
    for (let i = 0; i < 20; i++) expect(error(await send())).toBeNull()
    expect(delivered).toHaveLength(20)
  })

  it('limits the messages of one chat and of one device, until the window passed', async () => {
    const { state, send, delivered } = receiver()
    for (let i = 0; i < 20; i++) await send(1, 's1')
    expect(error(await send(1, 's1'))).toMatchObject({ code: 'forbidden', message: expect.stringContaining('too many messages') })
    // Other chats of the same device go on, up to the device's own limit.
    for (let i = 0; i < 20; i++) await send(1, 's2')
    for (let i = 0; i < 20; i++) await send(1, 's3')
    expect(error(await send(1, 's4'))).toMatchObject({ code: 'forbidden' })
    expect(delivered).toHaveLength(60)
    state.now += 10 * 60_000 + 1
    expect(error(await send(1, 's1'))).toBeNull()
  })

  it('searches its chats for the other device, by title and conversation, within a project', async () => {
    const { ask, searched } = receiver()
    expect(result(await ask('chats.search', { query: '„Plan“' }))).toEqual({
      found: [{ chat: expect.objectContaining({ id: 'c2' }), hit: expect.objectContaining({ snippet: '…der alte Plan…' }) }],
      total: 1,
    })
    expect(searched).toEqual(['plan'])
    expect(result(await ask('chats.search', { query: 'release', project: 'cm' }))).toMatchObject({ found: [{ chat: { id: 'c3' } }], total: 1 })
    expect(result(await ask('chats.search', { query: 'release', project: 'nexa' }))).toEqual({ found: [], total: 0 })
  })

  it('starts a new chat in the project named, else in the one called like the sender’s', async () => {
    const { ask, created, sender } = receiver()
    const make = (p: Record<string, unknown>) => ask('chats.new', { from: sender(), chain: 2, provider: 'codex', text: 'Review bitte', ...p })
    expect(result(await make({ project: 'claude-manager', title: 'Review' }))).toEqual({ id: 'n1', title: 'Review', project: 'cm' })
    expect(result(await make({ near: 'NEXA' }))).toEqual({ id: 'n1', title: 'Neue Session', project: 'nexa' })
    expect(created.map((c) => [c.input.projectId, c.from.chain, c.from.origin.device?.name])).toEqual([
      ['p3', 2, 'Laptop'],
      ['p1', 2, 'Laptop'],
    ])
    // A part of the name that fits several, or a project there is none of: the agent gets the list.
    expect(error(await make({ project: 'nex' }))).toMatchObject({ code: 'not-found', message: expect.stringContaining('fits 2 projects') })
    expect(error(await make({ near: 'website' }))).toMatchObject({ code: 'not-found', message: expect.stringContaining('Its projects: "nexa", "nexa-server", "cm".') })
    expect(created).toHaveLength(2)
  })

  it('refuses requests it can’t read', async () => {
    const { ask } = receiver()
    expect(error(await ask('chats.send', { from: { sessionId: 's1', title: 'Hier', provider: 'codex' }, to: 'c1', text: 'ohne Kette' }))).toMatchObject({ code: 'bad-request' })
  })
})

describe('DeviceChats', () => {
  const laptop: ChatDevice = { id: 'laptop', name: 'Laptop', online: true }
  const chat = { id: 'c1', title: 'Server-Umbau', provider: 'claude', projectId: 'p1', project: 'nexa', folder: 'F:\\nexa', status: 'idle', updatedAt: 1, archived: false }

  function deviceChats(answer: (m: RemoteChatMethod, p: unknown) => Promise<unknown>, patch: Partial<DeviceChatsDeps> = {}) {
    const requests: { device: string; m: string; p: unknown }[] = []
    const chats = new DeviceChats({
      request: async (device, m, p) => {
        requests.push({ device, m, p })
        return answer(m, p)
      },
      devices: () => [laptop],
      selfName: () => 'Desktop',
      outgoing: () => ({ origin: { sessionId: 's1', title: 'Hier', provider: 'codex' }, chain: 3 }),
      projectOf: () => 'nexa',
      ...patch,
    })
    return { chats, requests }
  }

  it('asks no device that isn’t connected, and says so', async () => {
    const { chats, requests } = deviceChats(async () => ({ chats: [] }))
    await expect(chats.list({ ...laptop, online: false })).rejects.toThrow('The device "Laptop" is not connected right now')
    expect(requests).toEqual([])
  })

  it('sends with the chat’s place in the chain, and nothing past the limit', async () => {
    const { chats, requests } = deviceChats(async () => ({ chat }))
    expect(await chats.send(laptop, 's1', 'c1', 'Bitte prüfen.')).toMatchObject({ id: 'c1' })
    expect(requests).toEqual([{ device: 'laptop', m: 'chats.send', p: { from: { sessionId: 's1', title: 'Hier', provider: 'codex' }, chain: 3, to: 'c1', text: 'Bitte prüfen.' } }])

    const full = deviceChats(async () => ({ chat }), {
      outgoing: () => {
        throw new Error('Nexa stopped this: 10 messages between chats in a row without the user.')
      },
    })
    await expect(full.chats.send(laptop, 's1', 'c1', 'x')).rejects.toThrow('Nexa stopped this')
    expect(full.requests).toEqual([])
  })

  it('starts a new chat in the project called like the sender’s unless one is named', async () => {
    const { chats, requests } = deviceChats(async () => ({ id: 'n1', title: 'Review', project: 'nexa' }))
    expect(await chats.create(laptop, 's1', { provider: 'codex', text: 'Review bitte' })).toEqual({ id: 'n1', title: 'Review', project: 'nexa' })
    expect(requests[0]?.p).toEqual({ from: { sessionId: 's1', title: 'Hier', provider: 'codex' }, chain: 3, provider: 'codex', text: 'Review bitte', near: 'nexa' })
  })

  it('puts what went wrong at the device in words for the agent', async () => {
    const failing = (code: RemoteErrorCode, message: string = code) => deviceChats(async () => Promise.reject(new RemoteError({ code, message }))).chats
    await expect(failing('disabled').list(laptop)).rejects.toThrow('The device "Laptop" lets no other device in: its Remote Control is off')
    await expect(failing('forbidden', 'needs level prompt').send(laptop, 's1', 'c1', 'x')).rejects.toThrow(
      'The device "Laptop" doesn\'t let this device write to its chats or start new ones',
    )
    await expect(failing('forbidden', 'needs level read').list(laptop)).rejects.toThrow('doesn\'t let this device read its chats')
    await expect(failing('forbidden', 'messages between chats are turned off there (Einstellungen › Chat).').list(laptop)).rejects.toThrow(
      'The device "Laptop" refused: messages between chats are turned off there',
    )
    await expect(failing('failed', 'Codex ist nicht installiert.').send(laptop, 's1', 'c1', 'x')).rejects.toThrow('On the device "Laptop": Codex ist nicht installiert.')
    await expect(failing('unreachable').list(laptop)).rejects.toThrow('The device "Laptop" is not connected right now')
    await expect(failing('offline').list(laptop)).rejects.toThrow('This device is not connected to its server right now')
    await expect(failing('bad-request').list(laptop)).rejects.toThrow('it may run an older version of Nexa')
    await expect(failing('timeout').send(laptop, 's1', 'c1', 'x')).rejects.toThrow('the message may or may not have arrived')
  })

  it('gives up on a device that doesn’t answer, sooner when only looking', async () => {
    const { chats } = deviceChats(() => new Promise(() => undefined), { lookTimeoutMs: 20 })
    await expect(chats.list(laptop)).rejects.toThrow('The device "Laptop" did not answer in time')
  })

  it('refuses an answer it doesn’t understand', async () => {
    const { chats } = deviceChats(async () => ({ nonsense: true }))
    await expect(chats.read(laptop, 'c1', 6)).rejects.toThrow("gave an answer this Nexa doesn't understand")
  })
})

// --- Both sides over the server ---------------------------------------------------------------------

const codec: SecretCodec = {
  encrypt: async (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: async (text) => ({ plain: Buffer.from(text.slice(4), 'base64').toString(), reEncrypted: null }),
}

describe('messages between chats of two devices, over the server', () => {
  let server: FakeServer
  const dirs: string[] = []
  const links: ServerLinkService[] = []
  const remotes: Remote[] = []

  afterEach(async () => {
    for (const remote of remotes.splice(0)) remote.dispose()
    for (const link of links.splice(0)) await link.dispose()
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  async function device(name: string, invite: () => Promise<string>, chats?: (link: ServerLinkService) => RemoteChatsHost) {
    const userDataDir = await mkdtemp(join(tmpdir(), 'nexa-remote-chats-'))
    dirs.push(userDataDir)
    const link = new ServerLinkService({ userDataDir, defaultName: name, fetch: server.fetch, socket: server.socket, codec })
    links.push(link)
    await link.init()
    await link.pair({ url: 'https://nexa.test', code: await invite(), name })
    await vi.waitFor(() => expect(link.getState().status).toBe('online'))
    const host = chats?.(link)
    const remote = createRemote({
      link,
      invoke: async () => {
        throw new Error('no window API in this test')
      },
      onBroadcast: () => () => undefined,
      chats: host ? (from, request) => host.handle(from, request) : undefined,
      version: '1.0.0',
    })
    remotes.push(remote)
    return { link, remote, instance: link.getState().instance! }
  }

  /** Desktop with a chat „Server-Umbau“ that takes messages; Laptop whose agent in „Hier“ uses the chat tools. */
  async function pair() {
    server = new FakeServer()
    const settings = { chatTools: true }
    const delivered: Delivered[] = []
    const desktop = await device('Desktop', async () => server.invite(), (link) =>
      new RemoteChatsHost({
        enabled: () => settings.chatTools,
        link: { trusted: (id) => link.device(id)?.trusted ?? false, deviceName: (id) => link.device(id)?.name ?? null },
        chats: {
          list: () => [peer('c1', 'Server-Umbau')],
          items: async () => [],
          search: async () => [],
          projects: () => PROJECTS,
          send: async (to, text, from) => void delivered.push({ to, text, from }),
          create: async () => ({ id: 'n1', title: 'Neu' }),
        },
        maxChain: 10,
      }),
    )
    const laptop = await device('Laptop', async () => (await desktop.link.invite()).code)
    const trusted = (link: ServerLinkService) => link.getState().devices.filter((d) => d.trusted).length === 2
    await vi.waitFor(() => expect(trusted(desktop.link) && trusted(laptop.link)).toBe(true))

    const local: ChatPeers = {
      list: () => [peer('self', 'Hier'), peer('l1', 'Lokale Notizen')],
      items: async () => [],
      search: async () => [],
      send: async () => undefined,
      create: async () => ({ id: 'new', title: 'Neu' }),
    }
    const tools = new ChatTools(local, () => NOW)
    tools.setDevices(
      new DeviceChats({
        request: (instance, m, p) => laptop.remote.client.request(instance, m, p),
        devices: () => laptop.link.getState().devices.flatMap((d) => (!d.self && d.trusted ? [{ id: d.id, name: d.name, online: d.online }] : [])),
        selfName: () => laptop.link.self()?.name ?? null,
        outgoing: (from) => ({ origin: { sessionId: from, title: 'Hier', provider: 'claude' }, chain: 1 }),
        projectOf: () => 'nexa',
      }),
    )
    const call = async (name: string, args: Record<string, unknown>) => {
      const answer = await tools.call('self', name, args)
      return { text: answer.content.map((c) => (c.type === 'text' ? c.text : '')).join(''), error: !!answer.isError }
    }
    return { desktop, laptop, settings, delivered, call }
  }

  it('finds the other device’s chats and writes to them as far as it lets this one', async () => {
    const { desktop, laptop, settings, delivered, call } = await pair()
    // Remote Control off at the desktop: the laptop's agent hears so, its own chats still come.
    const before = await call('chat_list', {})
    expect(before.text).toContain('- "Lokale Notizen"')
    expect(before.text).toContain('The device "Desktop" lets no other device in')

    await desktop.link.setRemoteEnabled(true)
    const list = await call('chat_list', {})
    expect(list.text).toContain('You are in "Hier" (id: self, project nexa) on the device "Laptop".')
    expect(list.text).toContain(`Chats on the device "Desktop", newest first:\n- "Desktop › Server-Umbau" (Claude Code, project nexa, idle, active 1 min ago) id: ${desktop.instance}:c1`)

    // Looking is the default level; writing needs more.
    expect(await call('chat_send', { to: 'Desktop › Server-Umbau', text: 'Bitte prüfen.' })).toMatchObject({ error: true, text: expect.stringContaining('write to its chats') })
    await desktop.link.setRemoteLevel(laptop.instance, 'prompt')
    expect(await call('chat_send', { to: 'Desktop › Server-Umbau', text: 'Bitte prüfen.' })).toMatchObject({ error: false, text: expect.stringMatching(/^Sent to "Desktop › Server-Umbau" \(Claude Code\)/) })
    expect(delivered).toEqual([
      { to: 'c1', text: 'Bitte prüfen.', from: { origin: { sessionId: 'self', title: 'Hier', provider: 'claude', device: { id: laptop.instance, name: 'Laptop' } }, chain: 1 } },
    ])

    // The receiving device's setting decides as well.
    settings.chatTools = false
    expect(await call('chat_send', { to: `${desktop.instance}:c1`, text: 'Noch da?' })).toMatchObject({ error: true, text: expect.stringContaining('turned off there') })
    expect(delivered).toHaveLength(1)
  })

  it('tells the agent when the other device isn’t connected, and still lists its own chats', async () => {
    const { desktop, laptop, call } = await pair()
    await desktop.link.setRemoteEnabled(true)
    await desktop.link.disconnect()
    await vi.waitFor(() => expect(laptop.link.getState().devices.find((d) => d.id === desktop.instance)?.online).toBe(false))

    const list = await call('chat_list', {})
    expect(list.text).toContain('- "Lokale Notizen"')
    expect(list.text).toContain('The device "Desktop" is not connected right now')
    expect(await call('chat_send', { to: 'Desktop › Server-Umbau', text: 'x' })).toMatchObject({ error: true, text: expect.stringContaining('The device "Desktop" is not connected right now') })
    // A chat of this device is found as ever.
    expect(await call('chat_send', { to: 'Lokale Notizen', text: 'x' })).toMatchObject({ error: false })
  })
})
