import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Account } from '@shared/accounts'
import type { VoiceUpdate } from '@shared/voice'
import { noAccountMessage, voiceCandidates, VoiceService, type VoiceOwner, type VoiceSocket } from './voice-service'

function account(id: string, patch: Partial<Account> = {}): Account {
  return { id, name: id, provider: 'claude', kind: 'oauth', authState: 'ok', ...patch } as Account
}

class FakeSocket implements VoiceSocket {
  readyState = 0
  sent: (string | Uint8Array)[] = []
  closedWith: number | null = null
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null

  constructor(
    readonly url: string,
    readonly headers: Record<string, string>,
  ) {}

  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }
  close(code?: number): void {
    this.closedWith = code ?? null
    this.readyState = 3
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  drop(code: number, reason = ''): void {
    this.readyState = 3
    this.onclose?.({ code, reason })
  }
  /** What went out as text (KeepAlive, CloseStream), and the audio in bytes. */
  get texts(): string[] {
    return this.sent.filter((d): d is string => typeof d === 'string')
  }
  get audio(): number[] {
    return this.sent.filter((d): d is Uint8Array => typeof d !== 'string').map((d) => d.byteLength)
  }
}

function setup(options: { accounts?: Account[]; tokens?: Record<string, string>; setting?: string; language?: string } = {}) {
  const sockets: FakeSocket[] = []
  const updates: VoiceUpdate[] = []
  const gone: (() => void)[] = []
  const owner: VoiceOwner = {
    send: (_id, update) => updates.push(update),
    onGone: (cb) => {
      gone.push(cb)
      return () => gone.splice(gone.indexOf(cb), 1)
    },
  }
  const tokens = options.tokens ?? { a: 'tok-a' }
  const service = new VoiceService({
    accounts: { list: () => options.accounts ?? [account('a')], token: (id) => tokens[id] ?? null },
    settings: () => ({ account: options.setting ?? '', language: options.language ?? '' }),
    locale: () => 'de-DE',
    userAgent: 'nexa/test',
    connect: (url, headers) => {
      const socket = new FakeSocket(url, headers)
      sockets.push(socket)
      return socket
    },
  })
  return { service, sockets, updates, owner, gone }
}

const chunk = (bytes: number) => new Uint8Array(bytes)

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('voiceCandidates', () => {
  const list = [account('system', { kind: 'system' }), account('b'), account('key', { kind: 'apiKey' }), account('c'), { ...account('x'), provider: 'codex' } as Account]

  it('tries the chat’s account first, then the others; never API keys or other CLIs', () => {
    expect(voiceCandidates(list, '', 'c').map((a) => a.id)).toEqual(['c', 'b', 'system'])
  })

  it('tries only the account set, unless it was removed', () => {
    expect(voiceCandidates(list, 'b', 'c').map((a) => a.id)).toEqual(['b'])
    expect(voiceCandidates(list, 'gone', 'c').map((a) => a.id)).toEqual(['c', 'b', 'system'])
  })

  it('says why no account could be used', () => {
    expect(noAccountMessage([{ ...account('b'), authState: 'expired' }], '')).toContain('„b“ bei claude.ai ist abgelaufen')
    expect(noAccountMessage([], '')).toContain('angemeldeten Claude-Account')
  })
})

describe('VoiceService', () => {
  it('connects with the first account that has a token, in the language set or the system’s', () => {
    const { service, sockets, owner } = setup({ accounts: [account('a'), account('b')], tokens: { b: 'tok-b' } })
    service.start(owner, { keyterms: ['Nexa', 'nexa-app'] })
    const socket = sockets[0]!
    expect(socket.headers.Authorization).toBe('Bearer tok-b')
    expect(socket.headers['x-config-keyterms']).toBe('Nexa,nexa-app')
    const url = new URL(socket.url)
    expect(url.origin + url.pathname).toBe('wss://api.anthropic.com/api/ws/speech_to_text/voice_stream')
    expect(url.searchParams.get('language')).toBe('de')
    expect(url.searchParams.get('encoding')).toBe('linear16')
    expect(url.searchParams.get('sample_rate')).toBe('16000')
  })

  it('throws with a message when no account can be used', () => {
    const { service, owner, sockets } = setup({ tokens: {} })
    expect(() => service.start(owner, {})).toThrow('angemeldeten Claude-Account')
    expect(sockets).toHaveLength(0)
  })

  it('keeps the audio until the connection stands, then keeps it alive', () => {
    const { service, sockets, owner } = setup()
    const id = service.start(owner, {})
    service.audio(id, chunk(2048))
    service.audio(id, chunk(1024))
    const socket = sockets[0]!
    expect(socket.sent).toHaveLength(0)
    socket.open()
    expect(socket.texts).toEqual(['{"type":"KeepAlive"}'])
    expect(socket.audio).toEqual([2048, 1024])
    service.audio(id, chunk(512))
    expect(socket.audio).toEqual([2048, 1024, 512])
    vi.advanceTimersByTime(8_000)
    expect(socket.texts).toEqual(['{"type":"KeepAlive"}', '{"type":"KeepAlive"}'])
  })

  it('passes on the words so far and closes an utterance at its endpoint', () => {
    const { service, sockets, owner, updates } = setup()
    service.start(owner, {})
    const socket = sockets[0]!
    socket.open()
    socket.receive({ type: 'TranscriptText', data: 'Bitte' })
    socket.receive({ type: 'TranscriptText', data: 'Bitte erstelle' })
    socket.receive({ type: 'TranscriptEndpoint' })
    socket.receive({ type: 'TranscriptText', data: 'Danke' })
    expect(updates).toEqual([
      { type: 'transcript', text: 'Bitte', final: false },
      { type: 'transcript', text: 'Bitte erstelle', final: false },
      { type: 'transcript', text: 'Bitte erstelle', final: true },
      { type: 'transcript', text: 'Danke', final: false },
    ])
  })

  it('stops with CloseStream and resolves with the last words at the endpoint', async () => {
    const { service, sockets, owner, updates, gone } = setup()
    const id = service.start(owner, {})
    const socket = sockets[0]!
    socket.open()
    socket.receive({ type: 'TranscriptText', data: 'Fast' })
    let done = false
    const stopped = service.stop(id).then(() => (done = true))
    expect(socket.texts.at(-1)).toBe('{"type":"CloseStream"}')
    // No more audio after CloseStream.
    service.audio(id, chunk(100))
    expect(socket.audio).toEqual([])
    socket.receive({ type: 'TranscriptText', data: 'Fast fertig.' })
    await Promise.resolve()
    expect(done).toBe(false)
    socket.receive({ type: 'TranscriptEndpoint' })
    await stopped
    expect(updates.at(-1)).toEqual({ type: 'transcript', text: 'Fast fertig.', final: true })
    expect(socket.closedWith).toBe(1000)
    expect(gone).toHaveLength(0)
  })

  it('gives up waiting when nothing more comes, keeping what was heard', async () => {
    const { service, sockets, owner, updates } = setup()
    const id = service.start(owner, {})
    const socket = sockets[0]!
    socket.open()
    socket.receive({ type: 'TranscriptText', data: 'Halb' })
    const stopped = service.stop(id)
    vi.advanceTimersByTime(1_500)
    await stopped
    expect(updates.at(-1)).toEqual({ type: 'transcript', text: 'Halb', final: true })
  })

  it('stops a take that ends before the connection stands, once it does', async () => {
    const { service, sockets, owner } = setup()
    const id = service.start(owner, {})
    service.audio(id, chunk(640))
    const stopped = service.stop(id)
    const socket = sockets[0]!
    socket.open()
    expect(socket.audio).toEqual([640])
    expect(socket.texts).toEqual(['{"type":"KeepAlive"}', '{"type":"CloseStream"}'])
    socket.receive({ type: 'TranscriptEndpoint' })
    await stopped
  })

  it('reports a connection that never stands', async () => {
    const { service, sockets, owner, updates } = setup()
    const id = service.start(owner, {})
    const stopped = service.stop(id)
    sockets[0]!.drop(1006)
    await stopped
    expect(updates).toEqual([{ type: 'error', message: expect.stringContaining('nicht erreichbar') }])
  })

  it('reports the recognition’s errors and keeps the words before them', () => {
    const { service, sockets, owner, updates } = setup()
    service.start(owner, {})
    const socket = sockets[0]!
    socket.open()
    socket.receive({ type: 'TranscriptText', data: 'Bis hier' })
    socket.receive({ type: 'TranscriptError', description: 'quota exceeded' })
    expect(updates).toEqual([
      { type: 'transcript', text: 'Bis hier', final: false },
      { type: 'transcript', text: 'Bis hier', final: true },
      { type: 'error', message: 'Die Spracherkennung meldet einen Fehler: quota exceeded' },
    ])
    expect(socket.closedWith).toBe(1000)
  })

  it('times out a connection that does not answer', () => {
    const { service, sockets, owner, updates } = setup()
    service.start(owner, {})
    vi.advanceTimersByTime(10_000)
    expect(updates).toEqual([{ type: 'error', message: expect.stringContaining('antwortet nicht') }])
    expect(sockets[0]!.closedWith).toBe(1000)
  })

  it('ends a take silently when cancelled or when its window goes away', () => {
    const { service, sockets, owner, updates, gone } = setup()
    const first = service.start(owner, {})
    sockets[0]!.open()
    sockets[0]!.receive({ type: 'TranscriptText', data: 'weg' })
    service.cancel(first)
    expect(sockets[0]!.closedWith).toBe(1000)
    service.start(owner, {})
    expect(gone).toHaveLength(1)
    gone[0]!()
    expect(sockets[1]!.closedWith).toBe(1000)
    expect(updates).toEqual([{ type: 'transcript', text: 'weg', final: false }])
  })
})
