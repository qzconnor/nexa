import type { ChatItem, ChatOrigin, ProviderId } from '@shared/chat'
import {
  MAX_REMOTE_CHATS,
  MAX_REMOTE_FOUND,
  parseChatResult,
  type RemoteChat,
  type RemoteChatMethod,
  type RemoteChatMethods,
  type RemoteChatRequest,
  type RemoteChatSender,
} from '@shared/remote-chats'
import type { SessionSearchHit } from '@shared/types'
import { chatTranscript, findChats, nameKey, RATE_LIMIT, RATE_WINDOW_MS, searchWords, type ChatDevice, type DeviceChatPeers } from '../mcp/chat-tools'
import type { PeerChat } from '../services/session-service'
import { RemoteError } from './remote-client'
import { Refused } from './remote-host'

/*
 * Messages between chats across devices (PROTOCOLS.md, „Nachrichten zwischen Chats“): the chat tools of
 * this device's agents reach the chats of the other devices (`DeviceChats`), and this device answers
 * theirs (`RemoteChatsHost`). The requests go over Remote Control (`chats.*`), end-to-end encrypted for
 * the two devices; the receiving one decides.
 */

// --- This device as the receiver ---------------------------------------------------------------------

/** Messages one chat of another device may send here within `RATE_WINDOW_MS`, as chat-tools allows a chat. */
const SENDER_LIMIT = RATE_LIMIT
/** And all chats of one device together: a device doesn't get around the limit with ever new chats. */
const DEVICE_LIMIT = 3 * RATE_LIMIT

export interface RemoteChatsHostDeps {
  /** „Nachrichten zwischen Chats“ is on here (`settings.tools.chatTools`). */
  enabled(): boolean
  link: {
    /** A confirmed member of the namespace (`LinkedDevice.trusted`). */
    trusted(id: string): boolean
    deviceName(id: string): string | null
  }
  chats: {
    list(): PeerChat[]
    items(id: string): Promise<readonly ChatItem[] | null>
    search(query: string): Promise<SessionSearchHit[]>
    projects(): { id: string; name: string; path: string }[]
    /** In like a message of a chat here (`SessionService.send` with `from`): its place in the chain is kept. */
    send(to: string, text: string, from: { origin: ChatOrigin; chain: number }): Promise<void>
    /** A new chat with the message as its first prompt (`SessionService.newFromDevice`). */
    create(input: { projectId: string; provider: ProviderId; text: string; title?: string }, from: { origin: ChatOrigin; chain: number }): Promise<{ id: string; title: string }>
  }
  /** Messages between chats in a row without the user (`MAX_CHAT_CHAIN`). */
  maxChain: number
  now?: () => number
}

/** A chat as it goes to another device: what `RemoteChat` names, nothing more of what `PeerChat` may gain. */
function wire(chat: PeerChat): RemoteChat {
  const { id, title, provider, projectId, project, folder, status, updatedAt, archived } = chat
  return { id, title, provider, projectId, project, folder, status, updatedAt, archived }
}

/**
 * This device as the receiver of other devices' chat tools (`chats.*`). The level the sender has here
 * is checked before (`RemoteHost.check`, `CHAT_METHOD_LEVEL`: `read` to look, `prompt` to write); here
 * the rest: a confirmed device, the setting „Nachrichten zwischen Chats“, the chain of messages without
 * the user, and how many messages one chat and one device send. Its refusals are English, for the
 * sending agent (`DeviceChats` puts the device's name in front).
 */
export class RemoteChatsHost {
  /** When the latest messages came, per sending chat (`device:session`) and per device. */
  private readonly byChat = new Map<string, number[]>()
  private readonly byDevice = new Map<string, number[]>()

  constructor(private readonly deps: RemoteChatsHostDeps) {}

  async handle(from: string, request: RemoteChatRequest): Promise<unknown> {
    if (!this.deps.link.trusted(from)) throw new Refused({ code: 'forbidden', message: 'it does not know this device as a confirmed one.' })
    if (!this.deps.enabled()) throw new Refused({ code: 'forbidden', message: 'messages between chats are turned off there (Einstellungen › Chat).' })
    const { chats } = this.deps
    switch (request.m) {
      case 'chats.list':
        return { chats: chats.list().slice(0, MAX_REMOTE_CHATS).map(wire) }
      case 'chats.read': {
        const chat = this.chat(request.p.id)
        const items = await chats.items(chat.id)
        if (!items) throw new Refused({ code: 'not-found', message: 'that chat is gone.' })
        return { chat: wire(chat), transcript: chatTranscript(items, request.p.last) }
      }
      case 'chats.search': {
        const words = searchWords(request.p.query)
        if (!words.length) throw new Refused({ code: 'bad-request', message: 'no words to search for' })
        const found = await findChats(chats.list(), (query) => chats.search(query), words, nameKey(request.p.project ?? ''))
        return { found: found.slice(0, MAX_REMOTE_FOUND).map(({ chat, hit }) => (hit ? { chat: wire(chat), hit } : { chat: wire(chat) })), total: found.length }
      }
      case 'chats.send': {
        const chat = this.chat(request.p.to)
        const origin = this.admit(from, request.p.from, request.p.chain)
        await chats.send(chat.id, request.p.text, { origin, chain: request.p.chain })
        return { chat: wire(chat) }
      }
      case 'chats.new': {
        const project = this.project(request.p.project, request.p.near)
        const origin = this.admit(from, request.p.from, request.p.chain)
        const { provider, text, title } = request.p
        const made = await chats.create({ projectId: project.id, provider, text, ...(title ? { title } : {}) }, { origin, chain: request.p.chain })
        return { id: made.id, title: made.title, project: project.name }
      }
    }
  }

  private chat(id: string): PeerChat {
    const chat = this.deps.chats.list().find((c) => c.id === id)
    if (!chat) throw new Refused({ code: 'not-found', message: `there is no chat with the id ${id} (any more). chat_list shows the chats there are.` })
    return chat
  }

  /** The project a new chat goes into: the one named (as a whole, else in its name or folder), else the one called like the sender's. */
  private project(wanted: string | undefined, near: string | undefined): { id: string; name: string } {
    const projects = this.deps.chats.projects()
    const names = projects.length ? `Its projects: ${projects.map((p) => `"${p.name}"`).join(', ')}.` : 'It has no projects.'
    if (wanted) {
      const key = nameKey(wanted)
      const exact = projects.filter((p) => nameKey(p.name) === key)
      const fits = exact.length ? exact : projects.filter((p) => nameKey(p.name).includes(key) || nameKey(p.path).includes(key))
      if (fits.length === 1) return fits[0]!
      throw new Refused({
        code: 'not-found',
        message: fits.length ? `"${wanted}" fits ${fits.length} projects; name one as a whole. ${names}` : `no project is called "${wanted}". ${names}`,
      })
    }
    const same = near ? projects.filter((p) => nameKey(p.name) === nameKey(near)) : []
    if (same.length === 1) return same[0]!
    throw new Refused({
      code: 'not-found',
      message: `${near ? `no project is called "${near}" like your chat's.` : 'name the project for the new chat.'} Pass one with project. ${names}`,
    })
  }

  /**
   * Whether a message of the chat `sender` on the device `from` comes in now; counted if so. Its origin
   * as the chat here shows it: the device by this device's own knowledge, not by what the sender says.
   */
  private admit(from: string, sender: RemoteChatSender, chain: number): ChatOrigin {
    if (chain > this.deps.maxChain) {
      throw new Error(
        `Nexa stopped this: ${this.deps.maxChain} messages between chats in a row without the user. Tell your user what is open; the chain starts anew once they write in a chat.`,
      )
    }
    const now = this.deps.now?.() ?? Date.now()
    const byChat = recent(this.byChat, `${from}:${sender.sessionId}`, now)
    const byDevice = recent(this.byDevice, from, now)
    if (byChat.length >= SENDER_LIMIT || byDevice.length >= DEVICE_LIMIT) {
      throw new Refused({
        code: 'forbidden',
        message: `too many messages (at most ${SENDER_LIMIT} from one chat and ${DEVICE_LIMIT} from one device within ${RATE_WINDOW_MS / 60_000} minutes). Tell your user what is open instead.`,
      })
    }
    byChat.push(now)
    byDevice.push(now)
    return { ...sender, device: { id: from, name: this.deps.link.deviceName(from) ?? from } }
  }
}

/** The times in `map` under `key` within the window, kept so; a key without any goes. */
function recent(map: Map<string, number[]>, key: string, now: number): number[] {
  const times = (map.get(key) ?? []).filter((at) => at > now - RATE_WINDOW_MS)
  map.set(key, times)
  // Keys of chats that went quiet don't pile up: the next one that sends cleans them away.
  for (const [other, list] of map) if (other !== key && !list.some((at) => at > now - RATE_WINDOW_MS)) map.delete(other)
  return times
}

// --- This device as the sender -----------------------------------------------------------------------

/** How long list, read and search wait for a device: an agent shouldn't hang on one that sleeps. */
const LOOK_TIMEOUT_MS = 10_000

export interface DeviceChatsDeps {
  /** A request to another device (`RemoteClient.request`); waits up to its own limit (30 s). */
  request<M extends RemoteChatMethod>(device: string, m: M, p: RemoteChatMethods[M]['params']): Promise<unknown>
  /** The other confirmed devices (`ServerLinkState.devices` with `trusted`), connected or not. */
  devices(): ChatDevice[]
  selfName(): string | null
  /** Where a message of the chat `from` comes from, and its place in the chain (`SessionService.chatOrigin`); throws past the limit. */
  outgoing(from: string): { origin: ChatOrigin; chain: number }
  /** The name of the chat's project: a new chat on another device goes into the one called alike. */
  projectOf(from: string): string | null
  lookTimeoutMs?: number
}

/**
 * The chats of the user's other devices for this device's chat tools (`DeviceChatPeers`), over Remote
 * Control. Only confirmed devices; one that isn't connected isn't asked. What goes wrong comes back as
 * an error in words for the agent, with the device's name.
 */
export class DeviceChats implements DeviceChatPeers {
  constructor(private readonly deps: DeviceChatsDeps) {}

  devices(): ChatDevice[] {
    return this.deps.devices()
  }

  selfName(): string | null {
    return this.deps.selfName()
  }

  async list(device: ChatDevice): Promise<RemoteChat[]> {
    return (await this.ask(device, 'chats.list', {}, this.lookMs())).chats
  }

  read(device: ChatDevice, id: string, last: number): Promise<{ chat: RemoteChat; transcript: string }> {
    return this.ask(device, 'chats.read', { id, last }, this.lookMs())
  }

  search(device: ChatDevice, query: string, project: string): Promise<RemoteChatMethods['chats.search']['result']> {
    return this.ask(device, 'chats.search', project ? { query, project } : { query }, this.lookMs())
  }

  async send(device: ChatDevice, from: string, to: string, text: string): Promise<RemoteChat> {
    const { origin, chain } = this.deps.outgoing(from)
    return (await this.ask(device, 'chats.send', { from: senderOf(origin), chain, to, text })).chat
  }

  create(device: ChatDevice, from: string, input: { provider: ProviderId; text: string; title?: string; project?: string }): Promise<RemoteChatMethods['chats.new']['result']> {
    const { origin, chain } = this.deps.outgoing(from)
    const near = this.deps.projectOf(from) || undefined
    return this.ask(device, 'chats.new', {
      from: senderOf(origin),
      chain,
      provider: input.provider,
      text: input.text,
      ...(input.title ? { title: input.title } : {}),
      ...(input.project ? { project: input.project } : {}),
      ...(near ? { near } : {}),
    })
  }

  private lookMs(): number {
    return this.deps.lookTimeoutMs ?? LOOK_TIMEOUT_MS
  }

  /** `m` at `device`, its answer checked; `timeoutMs`: gives up sooner than the request itself would. */
  private async ask<M extends RemoteChatMethod>(device: ChatDevice, m: M, p: RemoteChatMethods[M]['params'], timeoutMs?: number): Promise<RemoteChatMethods[M]['result']> {
    if (!device.online) throw new Error(notConnected(device))
    let timer: ReturnType<typeof setTimeout> | undefined
    let answer: unknown
    try {
      const request = this.deps.request(device.id, m, p)
      const late = new Promise<never>((_, reject) => {
        if (timeoutMs !== undefined) timer = setTimeout(() => reject(RemoteError.of('timeout')), timeoutMs)
      })
      answer = await (timeoutMs === undefined ? request : Promise.race([request, late]))
    } catch (error) {
      throw new Error(explain(device, m, error))
    } finally {
      clearTimeout(timer)
    }
    const parse = parseChatResult[m] as (value: unknown) => RemoteChatMethods[M]['result'] | null
    const result = parse(answer)
    if (!result) throw new Error(`The device "${device.name}" gave an answer this Nexa doesn't understand; it may run another version of Nexa.`)
    return result
  }
}

function senderOf(origin: ChatOrigin): RemoteChatSender {
  return { sessionId: origin.sessionId, title: origin.title, provider: origin.provider }
}

function notConnected(device: ChatDevice): string {
  return `The device "${device.name}" is not connected right now, so its chats are out of reach. Try again later or tell your user.`
}

/** What went wrong at a device, for the agent. */
function explain(device: ChatDevice, m: RemoteChatMethod, error: unknown): string {
  const name = `"${device.name}"`
  if (!(error instanceof RemoteError)) return `The device ${name} couldn't be asked: ${error instanceof Error ? error.message : String(error)}`
  const { code, message } = error.body
  const writes = m === 'chats.send' || m === 'chats.new'
  switch (code) {
    case 'offline':
      return "This device is not connected to its server right now, so it reaches none of the user's other devices."
    case 'unreachable':
    case 'gone':
      return notConnected(device)
    case 'timeout':
      return writes
        ? `The device ${name} did not answer in time; the message may or may not have arrived. chat_read shows whether it did.`
        : `The device ${name} did not answer in time; it may be asleep or its connection slow.`
    case 'busy':
      return `The device ${name} doesn't keep up with its messages right now; try again in a moment.`
    case 'disabled':
      return `The device ${name} lets no other device in: its Remote Control is off (the user turns it on there under Einstellungen › Geräte).`
    case 'forbidden': {
      const level = /^needs level (\w+)$/.exec(message)?.[1]
      if (level) {
        const what = level === 'read' ? 'read its chats' : 'write to its chats or start new ones'
        return `The device ${name} doesn't let this device ${what}; the user can allow it there under Einstellungen › Geräte › Fernsteuerung.`
      }
      return `The device ${name} refused: ${message}`
    }
    case 'too-large':
      return `That is too large to send to the device ${name}.`
    case 'bad-request':
      return `The device ${name} did not understand the request; it may run an older version of Nexa.`
    case 'not-found':
    case 'failed':
      return `On the device ${name}: ${message}`
  }
}
