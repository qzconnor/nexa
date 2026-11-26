import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, SessionEvent, SessionRuntime } from '@shared/chat'
import type { RemoteEvent } from '@shared/remote'
import type { SessionDetail, SessionMeta } from '@shared/types'
import { TypedEmitter } from '../lib/typed-emitter'
import { FakeServer } from '../server-link/fake-server'
import type { SecretCodec } from '../server-link/link-store'
import { ServerLinkService } from '../server-link/server-link-service'
import { createRemote, type Remote, type RemoteSessions } from './remote'

vi.mock('electron', () => ({ safeStorage: {} }))

const codec: SecretCodec = {
  encrypt: async (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: async (text) => ({ plain: Buffer.from(text.slice(4), 'base64').toString(), reEncrypted: null }),
}

/** The chats of the host: one, with a prompt and an answer. */
class FakeSessions extends TypedEmitter<{ event: [SessionEvent]; changed: [SessionMeta[]] }> {
  readonly meta = { id: 'c1', projectId: 'p1', title: 'Server-Umbau', provider: 'claude', model: 'opus', createdAt: 1, updatedAt: 2, cli: {} } as unknown as SessionMeta
  readonly items: ChatItem[] = [
    { kind: 'user', id: 'u1', ts: 1, provider: 'claude', text: 'Bau den Server um' },
    { kind: 'assistant', id: 'a1', ts: 2, provider: 'claude', text: 'Mache ich.' },
  ]
  readonly prompts: string[] = []
  list = () => [this.meta]
  open = async (): Promise<SessionDetail> => ({ meta: this.meta, items: this.items, runtime: { status: 'idle', connected: false } })
  send = async (_id: string, input: { text: string }) => {
    this.prompts.push(input.text)
    this.fire({ type: 'runtime', sessionId: 'c1', runtime: { status: 'running', connected: true } })
    this.fire({ type: 'item', sessionId: 'c1', item: { kind: 'assistant', id: 'a2', ts: 3, provider: 'claude', text: '' } })
    this.fire({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Läuft' })
    this.fire({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: ' schon.' })
  }
  interrupt = async () => undefined
  respond = async () => undefined
  activeRuntimes = (): Record<string, SessionRuntime> => ({})
  fire(event: SessionEvent): void {
    this.emit('event', event)
  }
}

let server: FakeServer
const dirs: string[] = []
const links: ServerLinkService[] = []
const remotes: Remote[] = []

async function device(name: string, invite: () => Promise<string>, sessions = new FakeSessions()) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'nexa-remote-'))
  dirs.push(userDataDir)
  const link = new ServerLinkService({ userDataDir, defaultName: name, fetch: server.fetch, socket: server.socket, codec })
  links.push(link)
  await link.init()
  await link.pair({ url: 'https://nexa.test', code: await invite(), name })
  await vi.waitFor(() => expect(link.getState().status).toBe('online'))
  const remote = createRemote({
    link,
    sessions: sessions as unknown as RemoteSessions,
    projects: { list: () => [{ id: 'p1', name: 'nexa', path: 'F:\\nexa', createdAt: 1, updatedAt: 1 }], sections: () => [] },
    version: '1.0.0',
  })
  remotes.push(remote)
  return { link, remote, sessions, instance: link.getState().instance! }
}

/** Desktop (host) and Laptop (controller), paired and trusting each other. */
async function pair() {
  const desktop = await device('Desktop', async () => server.invite())
  const laptop = await device('Laptop', async () => (await desktop.link.invite()).code)
  const trusted = (link: ServerLinkService) => link.getState().devices.filter((d) => d.trusted).length === 2
  await vi.waitFor(() => expect(trusted(desktop.link) && trusted(laptop.link)).toBe(true))
  return { desktop, laptop }
}

beforeEach(() => {
  server = new FakeServer()
})

afterEach(async () => {
  for (const remote of remotes.splice(0)) remote.dispose()
  for (const link of links.splice(0)) await link.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('Remote Control over the server', () => {
  it('lets a paired device read the chats once the host turns it on', async () => {
    const { desktop, laptop } = await pair()
    const client = laptop.remote.client

    expect(await client.request(desktop.instance, 'hello', {})).toMatchObject({ name: 'Desktop', enabled: false, level: 'off' })
    await expect(client.request(desktop.instance, 'chats', {})).rejects.toMatchObject({ body: { code: 'disabled' } })

    await desktop.link.setRemoteEnabled(true)
    expect(await client.request(desktop.instance, 'hello', {})).toMatchObject({ enabled: true, level: 'read' })
    expect(await client.request(desktop.instance, 'chats', {})).toMatchObject({ projects: [{ name: 'nexa' }], sessions: [{ id: 'c1', title: 'Server-Umbau' }] })
    expect(await client.request(desktop.instance, 'open', { id: 'c1' })).toMatchObject({ total: 2, items: [{ id: 'u1' }, { id: 'a1' }] })
    // Only reading: prompts need the next level.
    await expect(client.request(desktop.instance, 'send', { id: 'c1', text: 'Weiter' })).rejects.toMatchObject({ body: { code: 'forbidden' } })
  })

  it('sends prompts with the level for it, and streams what the agent does back in order', async () => {
    const { desktop, laptop } = await pair()
    await desktop.link.setRemoteEnabled(true)
    await desktop.link.setRemoteLevel(laptop.instance, 'prompt')
    const client = laptop.remote.client
    const events: RemoteEvent[] = []
    client.on('events', (instance, list) => instance === desktop.instance && events.push(...list))

    client.setWatch([{ instance: desktop.instance, ids: ['c1'] }])
    await vi.waitFor(() => expect(desktop.remote.host.controllers()).toMatchObject([{ name: 'Laptop', level: 'prompt' }]))
    await client.request(desktop.instance, 'send', { id: 'c1', text: 'Weiter' })
    expect(desktop.sessions.prompts).toEqual(['Weiter'])

    await vi.waitFor(() => expect(events.some((e) => e.type === 'delta')).toBe(true))
    expect(events).toEqual([
      { type: 'runtime', sessionId: 'c1', runtime: { status: 'running', connected: true } },
      { type: 'item', sessionId: 'c1', item: { kind: 'assistant', id: 'a2', ts: 3, provider: 'claude', text: '' } },
      { type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Läuft schon.' },
    ])
  })

  it('stays within a server that takes only small messages, without losing the connection', async () => {
    server.limits = { maxMessageBytes: 48 * 1024, rateLimit: 100 }
    const { desktop, laptop } = await pair()
    expect(desktop.link.limits()).toEqual({ maxMessageBytes: 48 * 1024, rateLimit: 100 })
    await desktop.link.setRemoteEnabled(true)
    // A long chat with long answers, umlauts and all.
    for (let i = 0; i < 60; i++) desktop.sessions.items.push({ kind: 'assistant', id: `x${i}`, ts: 10 + i, provider: 'claude', text: 'Größe '.repeat(2_000) })
    const client = laptop.remote.client
    const events: RemoteEvent[] = []
    client.on('events', (_instance, list) => events.push(...list))
    client.setWatch([{ instance: desktop.instance, ids: ['c1'] }])

    const page = await client.request(desktop.instance, 'open', { id: 'c1' })
    expect(page.total).toBe(62)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.start).toBeGreaterThan(0)
    const older = await client.request(desktop.instance, 'open', { id: 'c1', before: page.start })
    expect(older.start).toBeLessThan(page.start)

    // An answer far larger than a message: it arrives cut, as an event.
    desktop.sessions.fire({ type: 'item', sessionId: 'c1', item: { kind: 'assistant', id: 'big', ts: 99, provider: 'claude', text: 'Ü'.repeat(200_000) } })
    await vi.waitFor(() => expect(events.some((e) => e.type === 'item' && e.item.id === 'big')).toBe(true))
    expect(server.oversized).toBe(0)
    expect(laptop.link.getState().status).toBe('online')
    expect(desktop.link.getState().status).toBe('online')
  })

  it('tells a device that doesn’t keep up apart from one that isn’t connected', async () => {
    const { desktop, laptop } = await pair()
    server.busy.add(desktop.instance)
    await expect(laptop.remote.client.request(desktop.instance, 'hello', {})).rejects.toMatchObject({ body: { code: 'busy' } })
  })

  it('takes the defaults of a server that doesn’t name its limits', async () => {
    server.limits = null
    const { desktop } = await pair()
    expect(desktop.link.limits()).toEqual({ maxMessageBytes: 1024 * 1024, rateLimit: 100 })
  })

  it('stops answering a device whose level the host takes away', async () => {
    const { desktop, laptop } = await pair()
    await desktop.link.setRemoteEnabled(true)
    laptop.remote.client.setWatch([{ instance: desktop.instance, ids: [] }])
    await vi.waitFor(() => expect(desktop.remote.host.controllers()).toHaveLength(1))

    await desktop.remote.host.disconnect(laptop.instance)
    expect(desktop.remote.host.controllers()).toEqual([])
    expect(desktop.link.getState().devices.find((d) => d.id === laptop.instance)?.level).toBe('off')
    await expect(laptop.remote.client.request(desktop.instance, 'chats', {})).rejects.toMatchObject({ body: { code: 'forbidden' } })
  })
})
