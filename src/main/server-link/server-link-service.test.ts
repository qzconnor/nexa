import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodePairingCode } from '@shared/nexa-server/pairing-code'
import type { ServerLinkState } from '@shared/server-link'
import { FakeServer } from './fake-server'
import type { SecretCodec } from './link-store'
import { ServerLinkService } from './server-link-service'

vi.mock('electron', () => ({ safeStorage: {} }))

/** Stands in for the system's key store: marks what it "encrypted", and can be made to fail. */
const codec = (broken = false): SecretCodec => ({
  encrypt: async (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: async (text) => (broken || !text.startsWith('enc:') ? null : { plain: Buffer.from(text.slice(4), 'base64').toString(), reEncrypted: null }),
})

let server: FakeServer
let dirs: string[] = []
const services: ServerLinkService[] = []

async function service(dir?: string, broken = false): Promise<{ link: ServerLinkService; dir: string }> {
  const userDataDir = dir ?? (await mkdtemp(join(tmpdir(), 'nexa-link-')))
  if (!dir) dirs.push(userDataDir)
  // The fetch looked up at each call, so a test can make the server's fail.
  const fetch: typeof server.fetch = (input, init) => server.fetch(input, init)
  const link = new ServerLinkService({ userDataDir, defaultName: 'Testrechner', fetch, socket: server.socket, codec: codec(broken) })
  services.push(link)
  await link.init()
  return { link, dir: userDataDir }
}

const until = (link: ServerLinkService, check: (state: ServerLinkState) => boolean) => vi.waitFor(() => expect(check(link.getState())).toBe(true))
const trustedNames = (state: ServerLinkState) => state.devices.filter((d) => d.trusted).map((d) => d.name).sort()

beforeEach(() => {
  server = new FakeServer()
})

afterEach(async () => {
  for (const link of services.splice(0)) await link.dispose()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('ServerLinkService', () => {
  it('starts unpaired and suggests the computer’s name', async () => {
    const { link } = await service()
    expect(link.getState()).toMatchObject({ status: 'unpaired', devices: [], defaultName: 'Testrechner' })
  })

  it('pairs the first device with the admin’s invite and stores the keys encrypted', async () => {
    const { link, dir } = await service()
    const state = await link.pair({ url: 'nexa.test', code: server.invite(), name: 'Desktop' })
    expect(state).toMatchObject({ url: 'https://nexa.test', namespace: 'test', name: 'Desktop' })
    await until(link, (s) => s.status === 'online')
    expect(link.getState().devices).toMatchObject([{ name: 'Desktop', self: true, trusted: true, online: true, role: 'host' }])

    const stored = JSON.parse(await readFile(join(dir, 'nexa-server.json'), 'utf8')) as Record<string, unknown>
    expect(stored).toMatchObject({ url: 'https://nexa.test', namespace: 'test', role: 'host' })
    expect(String(stored.secrets).startsWith('enc:')).toBe(true)
    expect(JSON.stringify(stored)).not.toMatch(/pkcs8|"raw"/)
  })

  it('pairs a second device with the pairing code of the first; both take each other in', async () => {
    const { link: first } = await service()
    await first.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(first, (s) => s.status === 'online')
    const invite = await first.invite()
    expect(decodePairingCode(invite.code)).toMatchObject({ url: 'https://nexa.test', gen: 1 })

    const { link: second } = await service()
    // The address field is ignored: the code holds it.
    await second.pair({ url: '', code: invite.code, name: 'Laptop' })
    await until(second, (s) => trustedNames(s).join() === 'Desktop,Laptop')
    await until(first, (s) => trustedNames(s).join() === 'Desktop,Laptop')
  })

  it('pushes sealed for one member by the server; a member without a subscription gets nothing', async () => {
    const { link: first } = await service()
    await first.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(first, (s) => s.status === 'online')
    const { link: second } = await service()
    await second.pair({ url: '', code: (await first.invite()).code, name: 'Laptop' })
    await until(first, (s) => trustedNames(s).join() === 'Desktop,Laptop')
    const [from, to] = [first.getState().instance!, second.getState().instance!]

    expect(await first.push(to, 'push.notify', { n: 1 }, { urgency: 'normal', ttl: 60 })).toBe(false)
    server.subscribed.add(to)
    expect(await first.push(to, 'push.notify', { n: 2 }, { urgency: 'high', ttl: 3600 })).toBe(true)
    expect(server.pushed).toMatchObject([{ to, urgency: 'high', ttl: 3600, payload: { t: 'msg', from, to, kind: 'push.notify' } }])
    // What the push service gets is a sealed message, not the data.
    expect(JSON.stringify(server.pushed[0]!.payload)).not.toContain('"n":2')
    await expect(first.push('unknownxxxxxxxxxxxxxxx', 'push.notify', {}, { urgency: 'normal', ttl: 60 })).rejects.toThrow(/no member/)
  })

  it('links the server’s web app with the pairing code only when the server serves it', async () => {
    const { link } = await service()
    await link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(link, (s) => s.status === 'online')
    expect((await link.invite()).webApp).toBeUndefined()

    server.info = { name: 'nexa-server', version: '0.2.0', protocol: 1, pwa: true }
    const invite = await link.invite()
    expect(invite.webApp).toBe(`https://nexa.test/app/#${invite.code}`)

    // The web app is only extra: the code comes without it when `/v1/info` fails.
    const fetch = server.fetch
    vi.spyOn(server, 'fetch').mockImplementation((input, init) => (String(input).endsWith('/v1/info') ? Promise.reject(new Error('down')) : fetch(input, init)))
    const without = await link.invite()
    expect(without.webApp).toBeUndefined()
    expect(decodePairingCode(without.code)).toMatchObject({ url: 'https://nexa.test' })
  })

  it('tells how far this device’s clock is off from the server’s', async () => {
    const { link } = await service()
    await link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(link, (s) => s.status === 'online')
    expect(Math.abs(link.getState().clockSkew!)).toBeLessThan(5_000)

    // The server's clock an hour ahead: this device's is an hour behind.
    server.now = () => Date.now() + 60 * 60_000
    await link.disconnect()
    await link.connect()
    await until(link, (s) => s.status === 'online' && s.clockSkew !== null && Math.abs(s.clockSkew + 60 * 60_000) < 5_000)
    await link.disconnect()
    expect(link.getState().clockSkew).toBeNull()
  })

  it('does not trust a device the server added on its own', async () => {
    const { link } = await service()
    await link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(link, (s) => s.status === 'online')
    // Joins with an invite of the server, but never had the namespace's key.
    const { link: stranger } = await service()
    await stranger.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Fremd' })
    await until(link, (s) => s.devices.some((d) => d.name === 'Fremd' && d.online))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(link.getState().devices.find((d) => d.name === 'Fremd')?.trusted).toBe(false)
  })

  it('removes another device: it forgets the pairing, the others change the key', async () => {
    const { link: first } = await service()
    await first.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(first, (s) => s.status === 'online')
    const { link: second } = await service()
    await second.pair({ url: '', code: (await first.invite()).code, name: 'Laptop' })
    await until(first, (s) => trustedNames(s).length === 2)

    await first.remove(second.getState().instance!)
    await until(second, (s) => s.status === 'unpaired')
    expect(second.getState().error).toMatch(/entfernt/)
    await until(first, (s) => s.devices.length === 1)
    // The leader (the only one left) made a new key: the next code carries generation 2.
    await vi.waitFor(async () => expect(decodePairingCode((await first.invite()).code)?.gen).toBe(2))
  })

  it('leaves the namespace: removed at the server, keys forgotten', async () => {
    const { link, dir } = await service()
    await link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(link, (s) => s.status === 'online')
    await link.unpair()
    // Left on purpose: the close that follows is no news of a removal.
    expect(link.getState()).toMatchObject({ status: 'unpaired', error: null })
    expect(server.instances.size).toBe(0)
    await expect(readFile(join(dir, 'nexa-server.json'))).rejects.toThrow()
  })

  it('connects again after a restart, and stays disconnected when paused', async () => {
    const { link, dir } = await service()
    await link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(link, (s) => s.status === 'online')
    await link.dispose()

    const { link: again } = await service(dir)
    await until(again, (s) => s.status === 'online' && s.name === 'Desktop')
    await again.disconnect()
    await again.dispose()

    const { link: paused } = await service(dir)
    expect(paused.getState().status).toBe('paused')
    expect(server.sockets.filter((s) => s.open)).toHaveLength(0)
  })

  it('shows a pairing whose keys no longer decrypt, until the user forgets it', async () => {
    const { link, dir } = await service()
    await link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await link.dispose()
    const { link: locked } = await service(dir, true)
    expect(locked.getState()).toMatchObject({ status: 'stopped', url: 'https://nexa.test', error: expect.stringMatching(/entschlüsseln/) })
    await locked.unpair()
    expect(locked.getState().status).toBe('unpaired')
  })

  it('tells what went wrong in German', async () => {
    const { link } = await service()
    await expect(link.pair({ url: 'https://nexa.test', code: 'FALSCH', name: 'Desktop' })).rejects.toThrow(/ungültig, schon benutzt oder abgelaufen/)
    await expect(link.pair({ url: 'http://nexa.test', code: 'X', name: 'Desktop' })).rejects.toThrow(/HTTPS/)
    await expect(link.pair({ url: 'https://nexa.test', code: 'nexa1:kaputt', name: 'Desktop' })).rejects.toThrow(/Kopplungscode/)
    await expect(link.pair({ url: 'https://nexa.test', code: server.invite(), name: '   ' })).rejects.toThrow(/Name/)
    server.info = { name: 'something-else' }
    await expect(link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })).rejects.toThrow(/kein nexa-server/)
    server.info = { name: 'nexa-server', protocol: 2 }
    await expect(link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })).rejects.toThrow(/Aktualisiere Nexa/)
    expect(link.getState().status).toBe('unpaired')
  })

  it('renames this device and others', async () => {
    const { link } = await service()
    await link.pair({ url: 'https://nexa.test', code: server.invite(), name: 'Desktop' })
    await until(link, (s) => s.status === 'online')
    await link.rename(null, '  Arbeitsplatz  ')
    await until(link, (s) => s.name === 'Arbeitsplatz')
    await expect(link.rename(null, '')).rejects.toThrow(/Name/)
  })
})
