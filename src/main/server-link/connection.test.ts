import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstanceInfo } from '@shared/nexa-server/protocol'
import { ServerConnection, ServerError, type StopReason } from './connection'
import { FakeServer } from './fake-server'
import { generateIdentity } from './link-store'

vi.mock('electron', () => ({ safeStorage: {} }))

let server: FakeServer
const connections: ServerConnection[] = []

async function registered(id = 'dev1'.padEnd(22, 'x')): Promise<{ connection: ServerConnection; stops: StopReason[] }> {
  const { identity } = await generateIdentity()
  const info: InstanceInfo = { id, name: 'Desktop', role: 'host', signKey: identity.signKey, dhKey: identity.dhKey, createdAt: 0, lastSeen: null, online: false }
  server.instances.set(id, info)
  const connection = new ServerConnection({ url: 'wss://nexa.test/v1/ws', instance: id, signKey: identity.signPrivate, socket: server.socket })
  const stops: StopReason[] = []
  connection.on('stopped', (reason) => stops.push(reason))
  connections.push(connection)
  return { connection, stops }
}

beforeEach(() => {
  server = new FakeServer()
})

afterEach(() => {
  for (const connection of connections.splice(0)) connection.stop()
  vi.useRealTimers()
})

describe('ServerConnection', () => {
  it('logs in with a signature of the server’s nonce', async () => {
    const { connection } = await registered()
    const ready = new Promise((resolve) => connection.on('ready', resolve))
    connection.start()
    expect(connection.status).toBe('connecting')
    await expect(ready).resolves.toMatchObject({ t: 'ready', namespace: 'test' })
    expect(connection.status).toBe('online')
  })

  it('pairs answers with requests and turns errors into ServerError', async () => {
    const { connection } = await registered()
    connection.start()
    await vi.waitFor(() => expect(connection.status).toBe('online'))
    await expect(connection.request({ t: 'invite' })).resolves.toMatchObject({ t: 'invite', code: expect.stringMatching(/^CODE-/) })
    const error = await connection.request({ t: 'remove', instance: 'nobody'.padEnd(22, 'x') }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ServerError)
    expect((error as ServerError).code).toBe('unknown-instance')
  })

  it('refuses requests while not connected', async () => {
    const { connection } = await registered()
    await expect(connection.request({ t: 'instances' })).rejects.toMatchObject({ code: 'offline' })
  })

  it('stops for good when the server refuses the login', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const { connection, stops } = await registered()
    server.instances.clear()
    connection.start()
    await vi.waitFor(() => expect(stops).toEqual(['auth-failed']))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(server.sockets).toHaveLength(1)
    expect(connection.status).toBe('stopped')
  })

  it('does not fight a newer connection of the same instance', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const { connection, stops } = await registered()
    connection.start()
    await vi.waitFor(() => expect(connection.status).toBe('online'))
    // Another app with the same pairing logs in.
    const info = server.instances.get(connection['options'].instance)!
    const twin = new ServerConnection({ url: 'wss://nexa.test/v1/ws', instance: info.id, signKey: connection['options'].signKey, socket: server.socket })
    connections.push(twin)
    twin.start()
    await vi.waitFor(() => expect(stops).toEqual(['replaced']))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(server.sockets).toHaveLength(2)
    expect(twin.status).toBe('online')
  })

  it('reports a removal', async () => {
    const { connection, stops } = await registered()
    connection.start()
    await vi.waitFor(() => expect(connection.status).toBe('online'))
    server.remove(connection['options'].instance)
    await vi.waitFor(() => expect(stops).toEqual(['removed']))
  })

  it('connects again after a loss, waiting a little first', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const { connection } = await registered()
    let readies = 0
    connection.on('ready', () => readies++)
    connection.start()
    await vi.waitFor(() => expect(readies).toBe(1))
    server.connected(connection['options'].instance)!.drop(1006)
    await vi.waitFor(() => expect(connection.status).toBe('offline'))
    expect(connection.retryAt).toBeGreaterThan(Date.now())
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.waitFor(() => expect(readies).toBe(2))
    expect(connection.status).toBe('online')
  })

  it('stops on another protocol version', async () => {
    const { connection, stops } = await registered()
    const socket = server.socket
    connection['options'].socket = (url) => {
      const s = socket(url)
      // The fake greets with version 1 in a microtask; this greeting comes first.
      queueMicrotask(() => s.onmessage?.({ data: JSON.stringify({ t: 'hello', v: 2, nonce: 'abc' }) }))
      return s
    }
    connection.start()
    await vi.waitFor(() => expect(stops).toEqual(['protocol']))
  })
})
