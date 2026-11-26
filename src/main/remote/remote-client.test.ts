import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcEvent, IpcInvoke } from '@shared/ipc'
import { RemoteKind, WATCH_RENEW_MS, type RemoteBroadcast, type RemoteHostInfo } from '@shared/remote'
import { MessageTooLargeError } from '../server-link/device-channel'
import { RemoteClient, RemoteError } from './remote-client'

interface Sent {
  id: string
  to: string
  kind: string
  m: string
  p: unknown
}

const chat = (id: string, title = `Chat ${id}`) => ({ id, title })
const info: RemoteHostInfo = { name: 'Desktop', enabled: true, level: 'read', version: '1.2.3' }

function setup() {
  const sent: Sent[] = []
  const link = {
    up: true,
    /** What `sendToDevice` does instead of sending: null (not passed on) or an error to throw. */
    fail: undefined as null | Error | undefined,
    /** The server refuses the next request before its send returned, with this code. */
    refuseEarly: null as string | null,
  }
  let client: RemoteClient
  client = new RemoteClient({
    link: {
      online: () => link.up,
      sendToDevice: async (to, kind, data) => {
        if (link.fail === null) return null
        if (link.fail) throw link.fail
        const { m, p } = data as { m: string; p: unknown }
        const id = `m${sent.length + 1}`
        sent.push({ id, to, kind, m, p })
        if (link.refuseEarly) client.onSendFailed(id, link.refuseEarly)
        return id
      },
    },
    timeoutMs: 1_000,
  })
  const answer = (from: string, re: string, r: unknown) => client.onDeviceMessage(from, RemoteKind.response, { re, r })
  const fail = (from: string, re: string, code: string, message = code) => client.onDeviceMessage(from, RemoteKind.response, { re, e: { code, message } })
  const events = (from: string, list: unknown[]) => client.onDeviceMessage(from, RemoteKind.events, { events: list })
  const got: { instance: string; events: RemoteBroadcast[] }[] = []
  const resyncs: string[] = []
  const infos: { instance: string; info: RemoteHostInfo }[] = []
  client.on('events', (instance, list) => got.push({ instance, events: list }))
  client.on('resync', (instance) => resyncs.push(instance))
  client.on('info', (instance, i) => infos.push({ instance, info: i }))
  /** The last request of `m`; fails the test when there is none. */
  const last = (m: string) => {
    const request = sent.findLast((s) => s.m === m)
    if (!request) throw new Error(`no ${m} sent`)
    return request
  }
  return { client, sent, link, answer, fail, events, got, resyncs, infos, last }
}

/** A device the client watches, its first watch answered. */
async function watching(instance = 'desktop', ids: string[] = []) {
  const t = setup()
  t.client.setWatch([{ instance, ids }])
  await vi.advanceTimersByTimeAsync(0)
  t.answer(instance, t.last('watch').id, { ...info, renewed: false })
  await vi.advanceTimersByTimeAsync(0)
  return t
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RemoteClient', () => {
  it('makes a call of the window API at the device and gives back its answer', async () => {
    const { client, sent, answer } = setup()
    const list = client.invoke('desktop', IpcInvoke.sessionsList, [])
    await vi.advanceTimersByTimeAsync(0)
    expect(sent).toEqual([{ id: 'm1', to: 'desktop', kind: RemoteKind.request, m: 'invoke', p: { ch: IpcInvoke.sessionsList, args: [] } }])
    answer('desktop', 'm1', [chat('c1')])
    await expect(list).resolves.toEqual([chat('c1')])
  })

  it('settles a request with the answer of the device asked, and of no other', async () => {
    const { client, sent, answer } = setup()
    const hello = client.request('desktop', 'hello', {})
    await vi.advanceTimersByTimeAsync(0)
    answer('intruder', sent[0].id, { name: 'Fake' })
    answer('desktop', sent[0].id, info)
    // A second answer to the same request finds nothing waiting.
    answer('desktop', sent[0].id, { name: 'Später' })
    await expect(hello).resolves.toEqual(info)
  })

  it('turns the host’s errors into German ones, keeping its own words for a failure', async () => {
    const { client, sent, fail } = setup()
    const off = client.invoke('desktop', IpcInvoke.sessionsList, [])
    const forbidden = client.invoke('desktop', IpcInvoke.sessionsSend, ['c1', { text: 'Los' }])
    const failed = client.invoke('desktop', IpcInvoke.sessionsRemove, [['c1']])
    const odd = client.invoke('desktop', IpcInvoke.sessionsList, [])
    await vi.advanceTimersByTimeAsync(0)
    fail('desktop', sent[0].id, 'disabled', 'remote control is off')
    fail('desktop', sent[1].id, 'forbidden', 'needs level prompt')
    fail('desktop', sent[2].id, 'failed', 'Die Session läuft noch.')
    fail('desktop', sent[3].id, 'exploded', 'Etwas Neues')
    await expect(off).rejects.toThrow(/Fernsteuerung aus/)
    await expect(off).rejects.toBeInstanceOf(RemoteError)
    await expect(forbidden).rejects.toMatchObject({ body: { code: 'forbidden' }, message: expect.stringMatching(/darf dieses Gerät dort nicht/) })
    await expect(failed).rejects.toMatchObject({ body: { code: 'failed' }, message: 'Die Session läuft noch.' })
    await expect(odd).rejects.toMatchObject({ body: { code: 'failed' }, message: 'Etwas Neues' })
  })

  it('gives up when no answer comes in time', async () => {
    const { client, sent, answer } = setup()
    const late = client.invoke('desktop', IpcInvoke.sessionsList, [])
    const caught = late.catch((error: RemoteError) => error.body.code)
    await vi.advanceTimersByTimeAsync(999)
    answer('other', sent[0].id, [])
    await vi.advanceTimersByTimeAsync(2)
    expect(await caught).toBe('timeout')
    // Too late: nothing waits for it any more.
    answer('desktop', sent[0].id, [])
  })

  it('tells why a request didn’t reach the device', async () => {
    const { client, sent } = setup()
    const unreachable = client.request('desktop', 'hello', {})
    const busy = client.request('desktop', 'hello', {})
    const gone = client.request('old-laptop', 'hello', {})
    await vi.advanceTimersByTimeAsync(0)
    client.onSendFailed(sent[0].id, 'unreachable')
    client.onSendFailed(sent[1].id, 'busy')
    client.onSendFailed(sent[2].id, 'unknown-instance')
    await expect(unreachable).rejects.toMatchObject({ body: { code: 'unreachable' } })
    await expect(busy).rejects.toThrow(/kommt gerade nicht hinterher/)
    await expect(gone).rejects.toMatchObject({ body: { code: 'gone' } })
  })

  it('fails a request the server refused before its send returned', async () => {
    const { client, link } = setup()
    link.refuseEarly = 'busy'
    await expect(client.request('desktop', 'hello', {})).rejects.toMatchObject({ body: { code: 'busy' } })
  })

  it('doesn’t send while offline, and tells what kept a request from leaving', async () => {
    const { client, link, sent } = setup()
    link.up = false
    await expect(client.request('desktop', 'hello', {})).rejects.toMatchObject({ body: { code: 'offline' } })
    expect(sent).toEqual([])

    link.up = true
    link.fail = null
    await expect(client.request('desktop', 'hello', {})).rejects.toMatchObject({ body: { code: 'unreachable' } })
    link.fail = new MessageTooLargeError(5_000_000)
    await expect(client.invoke('desktop', IpcInvoke.appSaveImage, ['x', 'image/png'])).rejects.toMatchObject({ body: { code: 'too-large' } })
    link.fail = new Error('kaputt')
    await expect(client.request('desktop', 'hello', {})).rejects.toThrow('kaputt')
  })

  it('watches what the windows show, renews it, and stops for devices no longer shown', async () => {
    const { client, sent, answer } = setup()
    client.setWatch([
      { instance: 'desktop', ids: ['c2'] },
      { instance: 'desktop', ids: ['c1', 'c2'] },
    ])
    await vi.advanceTimersByTimeAsync(0)
    // Begun: nothing of before here.
    expect(sent).toMatchObject([{ to: 'desktop', m: 'watch', p: { ids: ['c1', 'c2'], fresh: true } }])
    answer('desktop', sent[0].id, { ...info, renewed: false })

    // The same again sends nothing; the renewal comes on its own.
    client.setWatch([{ instance: 'desktop', ids: ['c2', 'c1'] }])
    await vi.advanceTimersByTimeAsync(WATCH_RENEW_MS)
    expect(sent.map((s) => s.m)).toEqual(['watch', 'watch'])
    expect(sent[1].p).toEqual({ ids: ['c1', 'c2'] })

    // Other chats: at once, as a renewal.
    client.setWatch([{ instance: 'desktop', ids: ['c3'] }])
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.at(-1)).toMatchObject({ m: 'watch', p: { ids: ['c3'] } })

    client.setWatch([])
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.at(-1)).toMatchObject({ m: 'unwatch', to: 'desktop' })
    const count = sent.length
    await vi.advanceTimersByTimeAsync(WATCH_RENEW_MS * 2)
    expect(sent).toHaveLength(count)
  })

  it('renews the watches when this device logs in again, and when a device comes back', async () => {
    const { client, sent } = await watching()
    client.onConnected()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.map((s) => s.m)).toEqual(['watch', 'watch'])
    client.onDeviceStatus('desktop', true)
    client.onDeviceStatus('elsewhere', true)
    client.onDeviceStatus('desktop', false)
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.map((s) => `${s.m} ${s.to}`)).toEqual(['watch desktop', 'watch desktop', 'watch desktop'])
  })

  it('reads anew when the host lost the watch, but not right after starting it', async () => {
    const { client, sent, answer, resyncs, infos } = await watching()
    expect(resyncs).toEqual([])
    expect(infos).toEqual([{ instance: 'desktop', info }])

    client.onDeviceStatus('desktop', true)
    await vi.advanceTimersByTimeAsync(0)
    answer('desktop', sent[1].id, { ...info, renewed: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(resyncs).toEqual([])

    // The host restarted: it comes back online and knows no watch.
    client.onDeviceStatus('desktop', true)
    await vi.advanceTimersByTimeAsync(0)
    answer('desktop', sent[2].id, { ...info, renewed: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(resyncs).toEqual(['desktop'])
    expect(infos).toHaveLength(3)
  })

  it('learns from a refused watch how far it may go there', async () => {
    const { client, sent, fail, infos } = setup()
    client.setWatch([
      { instance: 'desktop', ids: [] },
      { instance: 'laptop', ids: [] },
      { instance: 'tablet', ids: [] },
    ])
    await vi.advanceTimersByTimeAsync(0)
    fail('desktop', sent[0].id, 'disabled')
    fail('laptop', sent[1].id, 'forbidden')
    fail('tablet', sent[2].id, 'busy')
    await vi.advanceTimersByTimeAsync(0)
    expect(infos).toEqual([
      { instance: 'desktop', info: { name: '', enabled: false, level: 'off', version: '' } },
      { instance: 'laptop', info: { name: '', enabled: true, level: 'off', version: '' } },
    ])
  })

  it('passes on events only of devices it watches, and only what looks like events', async () => {
    const { events, got, client } = setup()
    const settings = { ch: IpcEvent.settingsChanged, args: [{ theme: 'dark' }] }
    events('desktop', [settings])
    client.setWatch([{ instance: 'desktop', ids: [] }])
    events('desktop', [settings, { ch: IpcEvent.showSession, args: ['c1'] }, { type: 'chats' }])
    events('desktop', [{ ch: 'bogus', args: [] }])
    events('elsewhere', [settings])
    expect(got).toEqual([{ instance: 'desktop', events: [settings] }])
  })

  it('makes the lists whole again from what changed, per device and per list', async () => {
    const { got, events, client, answer, last } = await watching()
    client.setWatch([
      { instance: 'desktop', ids: [] },
      { instance: 'laptop', ids: [] },
    ])
    await vi.advanceTimersByTimeAsync(0)
    answer('laptop', last('watch').id, { ...info, renewed: false })

    events('desktop', [
      { ch: IpcEvent.sessionsChanged, diff: { ids: ['a', 'b'], changed: [chat('a'), chat('b')] } },
      { ch: IpcEvent.projectsChanged, diff: { ids: ['p'], changed: [chat('p')] } },
    ])
    events('laptop', [{ ch: IpcEvent.sessionsChanged, diff: { ids: ['x'], changed: [chat('x')] } }])
    // Added, changed, removed and reordered, by what changed alone.
    events('desktop', [{ ch: IpcEvent.sessionsChanged, diff: { ids: ['c', 'b'], changed: [chat('c'), chat('b', 'Umbenannt')] } }])
    events('desktop', [{ ch: IpcEvent.sessionsChanged, diff: { ids: ['b', 'c'], changed: [] } }])
    events('desktop', [{ ch: IpcEvent.projectsChanged, diff: { ids: ['p'], changed: [] } }])
    expect(got).toEqual([
      {
        instance: 'desktop',
        events: [
          { ch: IpcEvent.sessionsChanged, args: [[chat('a'), chat('b')]] },
          { ch: IpcEvent.projectsChanged, args: [[chat('p')]] },
        ],
      },
      { instance: 'laptop', events: [{ ch: IpcEvent.sessionsChanged, args: [[chat('x')]] }] },
      { instance: 'desktop', events: [{ ch: IpcEvent.sessionsChanged, args: [[chat('c'), chat('b', 'Umbenannt')]] }] },
      { instance: 'desktop', events: [{ ch: IpcEvent.sessionsChanged, args: [[chat('b', 'Umbenannt'), chat('c')]] }] },
      { instance: 'desktop', events: [{ ch: IpcEvent.projectsChanged, args: [[chat('p')]] }] },
    ])
  })

  it('starts the watch anew when a change comes without its base, and reads anew', async () => {
    const { got, events, sent, answer, resyncs, last } = await watching('desktop', ['c1'])
    const settings = { ch: IpcEvent.settingsChanged, args: [{ theme: 'dark' }] }
    const runtime = { ch: IpcEvent.sessionEvent, args: [{ type: 'runtime', sessionId: 'c1', runtime: { status: 'idle', connected: true } }] }
    // `a` never came here: something was lost on the way.
    events('desktop', [settings, { ch: IpcEvent.sessionsChanged, diff: { ids: ['a', 'b'], changed: [chat('b')] } }, runtime])
    // What came before the gap still goes; what came after it is read anew.
    expect(got).toEqual([{ instance: 'desktop', events: [settings] }])
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.at(-1)).toMatchObject({ m: 'watch', p: { ids: ['c1'], fresh: true } })
    expect(resyncs).toEqual([])
    answer('desktop', last('watch').id, { ...info, renewed: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(resyncs).toEqual(['desktop'])

    // The host starts whole again.
    events('desktop', [{ ch: IpcEvent.sessionsChanged, diff: { ids: ['a', 'b'], changed: [chat('a'), chat('b')] } }])
    expect(got.at(-1)).toEqual({ instance: 'desktop', events: [{ ch: IpcEvent.sessionsChanged, args: [[chat('a'), chat('b')]] }] })
  })

  it('forgets the lists of a device it stops watching', async () => {
    const { client, events, got, sent, answer, last } = await watching()
    events('desktop', [{ ch: IpcEvent.sessionsChanged, diff: { ids: ['a'], changed: [chat('a')] } }])
    client.setWatch([])
    await vi.advanceTimersByTimeAsync(0)
    client.setWatch([{ instance: 'desktop', ids: [] }])
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.at(-1)).toMatchObject({ m: 'watch', p: { fresh: true } })
    answer('desktop', last('watch').id, { ...info, renewed: true })
    await vi.advanceTimersByTimeAsync(0)
    // A change against the list of before no longer applies: it goes for the whole list again.
    events('desktop', [{ ch: IpcEvent.sessionsChanged, diff: { ids: ['a'], changed: [] } }])
    expect(got).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.at(-1)).toMatchObject({ m: 'watch', p: { fresh: true } })
  })

  it('fails what still waits when disposed, and stops watching', async () => {
    const { client, sent } = await watching()
    const pending = client.invoke('desktop', IpcInvoke.sessionsList, [])
    await vi.advanceTimersByTimeAsync(0)
    client.dispose()
    await expect(pending).rejects.toMatchObject({ body: { code: 'offline' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(sent.at(-1)).toMatchObject({ m: 'unwatch', to: 'desktop' })
    const count = sent.length
    await vi.advanceTimersByTimeAsync(WATCH_RENEW_MS * 2)
    expect(sent.filter((s) => s.m === 'watch')).toHaveLength(1)
    expect(sent).toHaveLength(count)
  })
})
