import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, SessionEvent } from '@shared/chat'
import { IpcEvent, IpcInvoke } from '@shared/ipc'
import type { RemoteBroadcast } from '@shared/remote'
import type { SessionDetail, SessionMeta } from '@shared/types'
import { PART_KIND } from '../server-link/device-channel'
import { FakeServer } from '../server-link/fake-server'
import type { SecretCodec } from '../server-link/link-store'
import { ServerLinkService } from '../server-link/server-link-service'
import { createRemote, type Remote } from './remote'

vi.mock('electron', () => ({ safeStorage: {} }))

const codec: SecretCodec = {
  encrypt: async (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: async (text) => ({ plain: Buffer.from(text.slice(4), 'base64').toString(), reEncrypted: null }),
}

/**
 * The host's windows as Remote Control sees them: the handlers of its window API, and the events it
 * broadcasts. One chat, with a prompt and an answer.
 */
class FakeWindows {
  readonly meta = { id: 'c1', projectId: 'p1', title: 'Server-Umbau', provider: 'claude', model: 'opus', createdAt: 1, updatedAt: 2, cli: {} } as unknown as SessionMeta
  readonly items: ChatItem[] = [
    { kind: 'user', id: 'u1', ts: 1, provider: 'claude', text: 'Bau den Server um' },
    { kind: 'assistant', id: 'a1', ts: 2, provider: 'claude', text: 'Mache ich.' },
  ]
  readonly prompts: string[] = []
  readonly images: { bytes: number; mime: unknown }[] = []
  private readonly listeners = new Set<(channel: string, args: unknown[]) => void>()

  readonly invoke = async (channel: string, args: unknown[]): Promise<unknown> => {
    switch (channel) {
      case IpcInvoke.sessionsList:
        return [this.meta]
      case IpcInvoke.sessionsOpen:
        return { meta: this.meta, items: this.items, runtime: { status: 'idle', connected: false } } satisfies SessionDetail
      case IpcInvoke.sessionsSend:
        this.prompts.push((args[1] as { text: string }).text)
        this.fire({ type: 'runtime', sessionId: 'c1', runtime: { status: 'running', connected: true } })
        this.fire({ type: 'item', sessionId: 'c1', item: { kind: 'assistant', id: 'a2', ts: 3, provider: 'claude', text: '' } })
        this.fire({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Läuft' })
        this.fire({ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: ' schon.' })
        return undefined
      case IpcInvoke.appSaveImage:
        this.images.push({ bytes: (args[0] as Buffer).length, mime: args[1] })
        return 'C:\\Nexa\\bild.png'
      default:
        throw new Error(`no handler for ${channel}`)
    }
  }

  readonly onBroadcast = (listener: (channel: string, args: unknown[]) => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  broadcast(channel: string, ...args: unknown[]): void {
    for (const listener of this.listeners) listener(channel, args)
  }

  fire(event: SessionEvent): void {
    this.broadcast(IpcEvent.sessionEvent, event)
  }
}

let server: FakeServer
const dirs: string[] = []
const links: ServerLinkService[] = []
const remotes: Remote[] = []

async function device(name: string, invite: () => Promise<string>) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'nexa-remote-'))
  dirs.push(userDataDir)
  const link = new ServerLinkService({ userDataDir, defaultName: name, fetch: server.fetch, socket: server.socket, codec })
  links.push(link)
  await link.init()
  await link.pair({ url: 'https://nexa.test', code: await invite(), name })
  await vi.waitFor(() => expect(link.getState().status).toBe('online'))
  const windows = new FakeWindows()
  const remote = createRemote({ link, invoke: windows.invoke, onBroadcast: windows.onBroadcast, version: '1.0.0' })
  remotes.push(remote)
  return { link, remote, windows, instance: link.getState().instance! }
}

/** Desktop (host) and Laptop (controller), paired and trusting each other. */
async function pair() {
  const desktop = await device('Desktop', async () => server.invite())
  const laptop = await device('Laptop', async () => (await desktop.link.invite()).code)
  const trusted = (link: ServerLinkService) => link.getState().devices.filter((d) => d.trusted).length === 2
  await vi.waitFor(() => expect(trusted(desktop.link) && trusted(laptop.link)).toBe(true))
  return { desktop, laptop }
}

/** The window events the laptop gets of `instance`. */
function collect(remote: Remote, instance: string): RemoteBroadcast[] {
  const events: RemoteBroadcast[] = []
  remote.client.on('events', (from, list) => from === instance && events.push(...list))
  return events
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
  it('lets a paired device use the window API once the host turns it on', async () => {
    const { desktop, laptop } = await pair()
    const client = laptop.remote.client

    expect(await client.request(desktop.instance, 'hello', {})).toMatchObject({ name: 'Desktop', enabled: false, level: 'off' })
    await expect(client.invoke(desktop.instance, IpcInvoke.sessionsList, [])).rejects.toMatchObject({ body: { code: 'disabled' } })

    await desktop.link.setRemoteEnabled(true)
    expect(await client.request(desktop.instance, 'hello', {})).toMatchObject({ enabled: true, level: 'read', version: '1.0.0' })
    expect(await client.invoke(desktop.instance, IpcInvoke.sessionsList, [])).toMatchObject([{ id: 'c1', title: 'Server-Umbau' }])
    expect(await client.invoke(desktop.instance, IpcInvoke.sessionsOpen, ['c1'])).toMatchObject({ meta: { id: 'c1' }, items: [{ id: 'u1' }, { id: 'a1' }] })
    // Only reading: prompts need the next level, and the host's own windows are no one else's.
    await expect(client.invoke(desktop.instance, IpcInvoke.sessionsSend, ['c1', { text: 'Weiter' }])).rejects.toMatchObject({ body: { code: 'forbidden' } })
    await expect(client.invoke(desktop.instance, IpcInvoke.settingsExport, [])).rejects.toMatchObject({ body: { code: 'forbidden' } })
    expect(desktop.windows.prompts).toEqual([])
  })

  it('sends prompts with the level for it, and streams what the agent does back in order', async () => {
    const { desktop, laptop } = await pair()
    await desktop.link.setRemoteEnabled(true)
    await desktop.link.setRemoteLevel(laptop.instance, 'prompt')
    const client = laptop.remote.client
    const events = collect(laptop.remote, desktop.instance)

    client.setWatch([{ instance: desktop.instance, ids: ['c1'] }])
    await vi.waitFor(() => expect(desktop.remote.host.controllers()).toMatchObject([{ name: 'Laptop', level: 'prompt' }]))
    await client.invoke(desktop.instance, IpcInvoke.sessionsSend, ['c1', { text: 'Weiter' }])
    expect(desktop.windows.prompts).toEqual(['Weiter'])

    await vi.waitFor(() => expect(events.some((e) => (e.args[0] as SessionEvent).type === 'delta')).toBe(true))
    expect(events).toEqual([
      { ch: IpcEvent.sessionEvent, args: [{ type: 'runtime', sessionId: 'c1', runtime: { status: 'running', connected: true } }] },
      { ch: IpcEvent.sessionEvent, args: [{ type: 'item', sessionId: 'c1', item: { kind: 'assistant', id: 'a2', ts: 3, provider: 'claude', text: '' } }] },
      { ch: IpcEvent.sessionEvent, args: [{ type: 'delta', sessionId: 'c1', itemId: 'a2', field: 'text', text: 'Läuft schon.' }] },
    ])
  })

  // Handlers without a result (sessions:send, :interrupt, :respond, :stop … return Promise<void>): their
  // call has to settle at once, not with the timeout 30 s later.
  it('settles a call whose handler gives back nothing', async () => {
    const { desktop, laptop } = await pair()
    await desktop.link.setRemoteEnabled(true)
    await desktop.link.setRemoteLevel(laptop.instance, 'prompt')
    const send = laptop.remote.client.invoke(desktop.instance, IpcInvoke.sessionsSend, ['c1', { text: 'Weiter' }])
    send.catch(() => undefined)
    const late = new Promise((resolve) => setTimeout(() => resolve('still waiting'), 1_500))
    expect(await Promise.race([send.then(() => 'settled'), late])).toBe('settled')
    expect(desktop.windows.prompts).toEqual(['Weiter'])
  })

  it('brings the lists over whole, though only what changed goes', async () => {
    const { desktop, laptop } = await pair()
    await desktop.link.setRemoteEnabled(true)
    const events = collect(laptop.remote, desktop.instance)
    laptop.remote.client.setWatch([{ instance: desktop.instance, ids: [] }])
    await vi.waitFor(() => expect(desktop.remote.host.controllers()).toHaveLength(1))

    const a = { ...desktop.windows.meta, id: 'a' }
    const b = { ...desktop.windows.meta, id: 'b' }
    desktop.windows.broadcast(IpcEvent.sessionsChanged, [a, b])
    await vi.waitFor(() => expect(events).toHaveLength(1))
    const renamed = { ...b, title: 'Umbenannt' }
    desktop.windows.broadcast(IpcEvent.sessionsChanged, [renamed, a])
    await vi.waitFor(() => expect(events).toHaveLength(2))
    expect(events).toEqual([
      { ch: IpcEvent.sessionsChanged, args: [[a, b]] },
      { ch: IpcEvent.sessionsChanged, args: [[renamed, a]] },
    ])
  })

  it('stays within a server that takes only small messages: what is larger goes in pieces', async () => {
    server.limits = { maxMessageBytes: 48 * 1024, rateLimit: 100 }
    const { desktop, laptop } = await pair()
    expect(desktop.link.limits()).toEqual({ maxMessageBytes: 48 * 1024, rateLimit: 100 })
    await desktop.link.setRemoteEnabled(true)
    await desktop.link.setRemoteLevel(laptop.instance, 'prompt')
    // A long chat with long answers, umlauts and all: far more than one message holds.
    for (let i = 0; i < 60; i++) desktop.windows.items.push({ kind: 'assistant', id: `x${i}`, ts: 10 + i, provider: 'claude', text: 'Größe "1" \\ '.repeat(1_000) })
    const client = laptop.remote.client
    const events = collect(laptop.remote, desktop.instance)
    client.setWatch([{ instance: desktop.instance, ids: ['c1'] }])
    await vi.waitFor(() => expect(desktop.remote.host.controllers()).toHaveLength(1))

    const detail = (await client.invoke(desktop.instance, IpcInvoke.sessionsOpen, ['c1'])) as SessionDetail
    expect(detail.items).toHaveLength(62)
    expect(detail.items.at(-1)).toEqual(desktop.windows.items.at(-1))
    const parts = (from: string, to: string) => server.relayed.filter((r) => r.from === from && r.to === to && r.kind === PART_KIND).length
    expect(parts(desktop.instance, laptop.instance)).toBeGreaterThan(10)

    // The other way too: a picture for a prompt, larger than a message.
    const picture = Buffer.alloc(200_000, 7)
    expect(await client.invoke(desktop.instance, IpcInvoke.appSaveImage, [picture.toString('base64'), 'image/png'])).toBe('C:\\Nexa\\bild.png')
    expect(desktop.windows.images).toEqual([{ bytes: 200_000, mime: 'image/png' }])
    expect(parts(laptop.instance, desktop.instance)).toBeGreaterThan(5)

    // An answer far larger than a message: it arrives cut, in pieces, as an event.
    desktop.windows.fire({ type: 'item', sessionId: 'c1', item: { kind: 'assistant', id: 'big', ts: 99, provider: 'claude', text: 'Ü'.repeat(200_000) } })
    await vi.waitFor(() => expect(events.some((e) => (e.args[0] as Extract<SessionEvent, { type: 'item' }>).item?.id === 'big')).toBe(true))
    expect(server.oversized).toBe(0)
    expect(laptop.link.getState().status).toBe('online')
    expect(desktop.link.getState().status).toBe('online')
  })

  it('answers that something is too large when not even its pieces would carry it', async () => {
    server.limits = { maxMessageBytes: 16 * 1024, rateLimit: 100 }
    const { desktop, laptop } = await pair()
    await desktop.link.setRemoteEnabled(true)
    // At 16 KiB 64 pieces hold about 700 KB; each answer is cut to 256 KB, but there are four.
    for (let i = 0; i < 4; i++) desktop.windows.items.push({ kind: 'assistant', id: `x${i}`, ts: 10 + i, provider: 'claude', text: 'y'.repeat(300_000) })
    await expect(laptop.remote.client.invoke(desktop.instance, IpcInvoke.sessionsOpen, ['c1'])).rejects.toMatchObject({ body: { code: 'too-large' } })
    expect(server.oversized).toBe(0)
    // The next call still goes.
    expect(await laptop.remote.client.invoke(desktop.instance, IpcInvoke.sessionsList, [])).toHaveLength(1)
  })

  it('tells a device that doesn’t keep up apart from one that isn’t connected, for pieces too', async () => {
    server.limits = { maxMessageBytes: 16 * 1024, rateLimit: 100 }
    const { desktop, laptop } = await pair()
    server.busy.add(desktop.instance)
    await expect(laptop.remote.client.request(desktop.instance, 'hello', {})).rejects.toMatchObject({ body: { code: 'busy' } })
    // A request in pieces fails as one.
    const picture = Buffer.alloc(50_000, 1).toString('base64')
    await expect(laptop.remote.client.invoke(desktop.instance, IpcInvoke.appSaveImage, [picture, 'image/png'])).rejects.toMatchObject({ body: { code: 'busy' } })
    expect(server.relayed.filter((r) => r.kind === PART_KIND).length).toBeGreaterThan(1)
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
    await expect(laptop.remote.client.invoke(desktop.instance, IpcInvoke.sessionsList, [])).rejects.toMatchObject({ body: { code: 'forbidden' } })
  })
})
