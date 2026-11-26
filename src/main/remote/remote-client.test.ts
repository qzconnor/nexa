import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteKind, WATCH_RENEW_MS } from '@shared/remote'
import { RemoteClient, RemoteError } from './remote-client'

interface Sent {
  id: string
  to: string
  m: string
  p: unknown
}

function setup() {
  const sent: Sent[] = []
  const link = { up: true }
  const client = new RemoteClient({
    link: {
      online: () => link.up,
      sendToDevice: async (to, _kind, data) => {
        const { m, p } = data as { m: string; p: unknown }
        const id = `m${sent.length + 1}`
        sent.push({ id, to, m, p })
        return id
      },
    },
    timeoutMs: 1_000,
  })
  const answer = (from: string, re: string, r: unknown) => client.onDeviceMessage(from, RemoteKind.response, { re, r })
  const resyncs: string[] = []
  client.on('resync', (instance) => resyncs.push(instance))
  return { client, sent, link, answer, resyncs }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RemoteClient', () => {
  it('settles a request with the answer of the device asked, and of no other', async () => {
    const { client, sent, answer } = setup()
    const hello = client.request('desktop', 'hello', {})
    await vi.advanceTimersByTimeAsync(0)
    answer('intruder', sent[0].id, { name: 'Fake' })
    answer('desktop', sent[0].id, { name: 'Desktop', enabled: true, level: 'read', version: '1' })
    await expect(hello).resolves.toMatchObject({ name: 'Desktop' })
  })

  it('turns the host’s errors into German ones', async () => {
    const { client, sent } = setup()
    const chats = client.request('desktop', 'chats', {})
    await vi.advanceTimersByTimeAsync(0)
    client.onDeviceMessage('desktop', RemoteKind.response, { re: sent[0].id, e: { code: 'disabled', message: 'off' } })
    await expect(chats).rejects.toThrow(/Fernsteuerung aus/)
  })

  it('gives up when no answer comes, the server couldn’t pass it on, or this device is offline', async () => {
    const { client, sent, link } = setup()
    const late = client.request('desktop', 'chats', {})
    const caught = late.catch((error: RemoteError) => error.body.code)
    await vi.advanceTimersByTimeAsync(1_100)
    expect(await caught).toBe('timeout')

    const lost = client.request('desktop', 'chats', {})
    await vi.advanceTimersByTimeAsync(0)
    client.onSendFailed(sent[1].id)
    await expect(lost).rejects.toMatchObject({ body: { code: 'unreachable' } })

    link.up = false
    await expect(client.request('desktop', 'chats', {})).rejects.toMatchObject({ body: { code: 'offline' } })
  })

  it('watches what the windows show, renews it, and stops for devices no longer shown', async () => {
    const { client, sent, answer } = setup()
    client.setWatch([
      { instance: 'desktop', ids: ['c1'] },
      { instance: 'desktop', ids: ['c2', 'c1'] },
    ])
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toMatchObject([{ to: 'desktop', m: 'watch', p: { ids: ['c1', 'c2'] } }])
    answer('desktop', sent[0].id, { renewed: false })

    // The same again sends nothing; the renewal comes on its own.
    client.setWatch([{ instance: 'desktop', ids: ['c2', 'c1'] }])
    await vi.advanceTimersByTimeAsync(WATCH_RENEW_MS)
    expect(sent.map((s) => s.m)).toEqual(['watch', 'watch'])

    client.setWatch([])
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.at(-1)).toMatchObject({ m: 'unwatch' })
    await vi.advanceTimersByTimeAsync(WATCH_RENEW_MS)
    expect(sent.at(-1)).toMatchObject({ m: 'unwatch' })
  })

  it('reads anew when the host lost the watch, but not right after starting it', async () => {
    const { client, sent, answer, resyncs } = setup()
    client.setWatch([{ instance: 'desktop', ids: [] }])
    await vi.advanceTimersByTimeAsync(0)
    answer('desktop', sent[0].id, { renewed: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(resyncs).toEqual([])

    // The host restarted: it comes back online and knows no watch.
    client.onDeviceStatus('desktop', true)
    await vi.advanceTimersByTimeAsync(0)
    answer('desktop', sent[1].id, { renewed: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(resyncs).toEqual(['desktop'])
  })

  it('passes on events only of devices it watches', async () => {
    const { client } = setup()
    const got: string[] = []
    client.on('events', (instance, events) => got.push(`${instance}:${events.map((e) => e.type).join()}`))
    client.onDeviceMessage('desktop', RemoteKind.events, { events: [{ type: 'chats' }] })
    client.setWatch([{ instance: 'desktop', ids: [] }])
    client.onDeviceMessage('desktop', RemoteKind.events, { events: [{ type: 'chats' }, { type: 'bogus' }] })
    expect(got).toEqual(['desktop:chats'])
  })
})
