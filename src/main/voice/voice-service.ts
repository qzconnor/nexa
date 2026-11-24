import { randomUUID } from 'node:crypto'
import type { Account } from '@shared/accounts'
import {
  parseVoiceMessage,
  voiceCandidates,
  voiceKeyterms,
  voiceLanguage,
  VOICE_SAMPLE_RATE,
  type VoiceStartInput,
  type VoiceUpdate,
} from '@shared/voice'

/**
 * Claude's speech recognition, as Claude Code's `/voice` uses it: a WebSocket to the API with the
 * OAuth token of a claude.ai login, PCM in, the words so far out. The window records; this only
 * forwards and keeps the stream alive. Also in Codex chats: there is no other recognition, so without
 * Claude there is no voice input. Protocol: docs/PROTOCOLS.md, „Spracheingabe“.
 */

const BASE_URL = 'wss://api.anthropic.com/api/ws/speech_to_text/voice_stream'
const KEEP_ALIVE = '{"type":"KeepAlive"}'
const CLOSE_STREAM = '{"type":"CloseStream"}'
/** The server drops a stream that sends nothing for a while (a pause, a slow start). */
const KEEP_ALIVE_MS = 8_000
const CONNECT_TIMEOUT_MS = 10_000
/** After CloseStream: the last words come within these, else they won't come (as Claude Code waits). */
const FINALIZE_MAX_MS = 5_000
const FINALIZE_SILENT_MS = 1_500
/** What is recorded before the connection stands waits for it, up to about half a minute. */
const MAX_QUEUED_BYTES = 30 * VOICE_SAMPLE_RATE * 2

/** The part of a WebSocket the service needs; the global one in production, a fake in tests. */
export interface VoiceSocket {
  readonly readyState: number
  send(data: string | Uint8Array): void
  close(code?: number): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: (() => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
}

const OPEN = 1

export interface VoiceAccounts {
  list(): Account[]
  /** The account's OAuth token for claude.ai, if it has a usable one now. */
  token(id: string): string | null
}

export interface VoiceSettings {
  /** Claude Code is switched on in Nexa: switched off, Nexa doesn't talk to Anthropic for it at all. */
  claudeEnabled: boolean
  /** The Claude account to use; `''`: the chat's, else the first that is signed in. */
  account: string
  /** `''`: the system's. */
  language: string
}

/** Where a session's updates go: the window that started it. */
export interface VoiceOwner {
  send(id: string, update: VoiceUpdate): void
  /** Calls back once when the window goes away; returns what takes the callback back. */
  onGone(cb: () => void): () => void
}

export interface VoiceDeps {
  accounts: VoiceAccounts
  settings: () => VoiceSettings
  locale: () => string
  userAgent: string
  connect?: (url: string, headers: Record<string, string>) => VoiceSocket
}

/** Why no account could be used, for the toast. */
export function noAccountMessage(accounts: readonly Account[], setting: string): string {
  const candidates = voiceCandidates(accounts, setting)
  const expired = candidates.find((a) => a.authState === 'expired')
  if (expired) return `Die Anmeldung von „${expired.name}“ bei claude.ai ist abgelaufen. Claude Code erneuert sie mit dem nächsten Chat dieses Accounts.`
  return 'Die Spracheingabe nutzt die Spracherkennung von Claude und braucht dafür einen bei claude.ai angemeldeten Claude-Account.'
}

interface Session {
  id: string
  owner: VoiceOwner
  socket: VoiceSocket
  opened: boolean
  queue: Uint8Array[]
  queued: number
  /** The utterance heard so far, not yet closed by the server. */
  pending: string
  /** Stop was asked for before the connection stood. */
  stopWanted: boolean
  /** CloseStream went out: no more audio. */
  closing: boolean
  /** Over: cancelled, failed or finished. */
  ended: boolean
  timers: NodeJS.Timeout[]
  keepAlive: NodeJS.Timeout | null
  silentTimer: NodeJS.Timeout | null
  finished: Promise<void>
  finish: () => void
  release: () => void
}

export class VoiceService {
  private readonly sessions = new Map<string, Session>()
  private readonly connect: (url: string, headers: Record<string, string>) => VoiceSocket

  constructor(private readonly deps: VoiceDeps) {
    this.connect = deps.connect ?? ((url, headers) => new WebSocket(url, { headers }) as unknown as VoiceSocket)
  }

  /** Opens a session; throws (with a message for the user) when no Claude account has a usable login. */
  start(owner: VoiceOwner, input: VoiceStartInput): string {
    const settings = this.deps.settings()
    // The window offers no microphone then; this is for a call that comes anyway.
    if (!settings.claudeEnabled) throw new Error('Die Spracheingabe läuft über Claude, und Claude Code ist in Nexa ausgeschaltet.')
    const accounts = this.deps.accounts.list()
    let token: string | null = null
    for (const account of voiceCandidates(accounts, settings.account, input.account)) {
      token = this.deps.accounts.token(account.id)
      if (token) break
    }
    if (!token) throw new Error(noAccountMessage(accounts, settings.account))

    const params = new URLSearchParams({
      encoding: 'linear16',
      sample_rate: String(VOICE_SAMPLE_RATE),
      channels: '1',
      endpointing_ms: '300',
      utterance_end_ms: '1000',
      language: voiceLanguage(settings.language, this.deps.locale()),
      use_conversation_engine: 'true',
    })
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'User-Agent': this.deps.userAgent, 'x-app': 'cli' }
    const keyterms = voiceKeyterms(input.keyterms ?? [])
    if (keyterms) headers['x-config-keyterms'] = keyterms

    const id = randomUUID()
    let finish = () => {}
    const finished = new Promise<void>((resolve) => (finish = resolve))
    const session: Session = {
      id,
      owner,
      socket: this.connect(`${BASE_URL}?${params}`, headers),
      opened: false,
      queue: [],
      queued: 0,
      pending: '',
      stopWanted: false,
      closing: false,
      ended: false,
      timers: [],
      keepAlive: null,
      silentTimer: null,
      finished,
      finish,
      release: () => {},
    }
    this.sessions.set(id, session)
    this.wire(session)
    session.release = owner.onGone(() => this.cancel(id))
    return id
  }

  audio(id: string, chunk: Uint8Array): void {
    const s = this.sessions.get(id)
    if (!s || s.ended || s.closing || !chunk.byteLength) return
    if (s.opened && s.socket.readyState === OPEN) {
      s.socket.send(chunk)
      return
    }
    if (s.queued + chunk.byteLength > MAX_QUEUED_BYTES) return
    s.queue.push(chunk)
    s.queued += chunk.byteLength
  }

  /** The recording is over: resolves when the last words came, or it is clear they won't. */
  stop(id: string): Promise<void> {
    const s = this.sessions.get(id)
    if (!s) return Promise.resolve()
    if (s.opened) this.closeStream(s)
    else s.stopWanted = true
    return s.finished
  }

  cancel(id: string): void {
    const s = this.sessions.get(id)
    if (s) this.end(s, false)
  }

  dispose(): void {
    for (const s of [...this.sessions.values()]) this.end(s, false)
  }

  private wire(s: Session): void {
    s.timers.push(
      setTimeout(() => {
        if (s.opened || s.ended) return
        this.fail(s, 'Die Spracherkennung von Claude antwortet nicht. Prüfe die Internetverbindung.')
      }, CONNECT_TIMEOUT_MS),
    )
    s.socket.onopen = () => {
      if (s.ended) return
      s.opened = true
      s.socket.send(KEEP_ALIVE)
      s.keepAlive = setInterval(() => {
        if (s.socket.readyState === OPEN) s.socket.send(KEEP_ALIVE)
      }, KEEP_ALIVE_MS)
      for (const chunk of s.queue) s.socket.send(chunk)
      s.queue = []
      s.queued = 0
      if (s.stopWanted) this.closeStream(s)
    }
    s.socket.onmessage = (event) => {
      if (s.ended) return
      const message = typeof event.data === 'string' ? parseVoiceMessage(event.data) : null
      if (!message) return
      if (message.kind === 'text') {
        s.pending = message.text
        // Words still come: the server is not done after all.
        if (s.silentTimer) clearTimeout(s.silentTimer)
        s.silentTimer = null
        s.owner.send(s.id, { type: 'transcript', text: message.text, final: false })
      } else if (message.kind === 'endpoint') {
        this.commit(s)
        if (s.closing) this.end(s, true)
      } else {
        this.fail(s, `Die Spracherkennung meldet einen Fehler: ${message.message}`)
      }
    }
    // A close event always follows; it says what happened.
    s.socket.onerror = () => {}
    s.socket.onclose = (event) => {
      if (s.ended) return
      if (s.closing || event.code === 1000 || event.code === 1005) {
        this.end(s, true)
        return
      }
      this.fail(
        s,
        s.opened
          ? `Die Verbindung zur Spracherkennung ist abgebrochen (Code ${event.code}${event.reason ? `: ${event.reason}` : ''}).`
          : 'Die Spracherkennung von Claude war nicht erreichbar oder hat die Anmeldung abgelehnt.',
      )
    }
  }

  private closeStream(s: Session): void {
    if (s.closing || s.ended) return
    s.closing = true
    s.timers.push(setTimeout(() => this.end(s, true), FINALIZE_MAX_MS))
    s.silentTimer = setTimeout(() => this.end(s, true), FINALIZE_SILENT_MS)
    if (s.socket.readyState === OPEN) s.socket.send(CLOSE_STREAM)
    else this.end(s, true)
  }

  /** The utterance heard so far counts as said. */
  private commit(s: Session): void {
    if (!s.pending) return
    const text = s.pending
    s.pending = ''
    s.owner.send(s.id, { type: 'transcript', text, final: true })
  }

  private fail(s: Session, message: string): void {
    if (s.ended) return
    // What was heard before the failure stays.
    this.commit(s)
    s.owner.send(s.id, { type: 'error', message })
    this.end(s, false)
  }

  /** `keep`: what was heard last still counts (a normal end); else it is dropped with the session. */
  private end(s: Session, keep: boolean): void {
    if (s.ended) return
    if (keep) this.commit(s)
    s.ended = true
    for (const timer of s.timers) clearTimeout(timer)
    if (s.silentTimer) clearTimeout(s.silentTimer)
    if (s.keepAlive) clearInterval(s.keepAlive)
    s.queue = []
    this.sessions.delete(s.id)
    s.release()
    try {
      s.socket.close(1000)
    } catch {
      // Closed already.
    }
    s.finish()
  }
}
