import { verifyAuth } from '@shared/nexa-server/auth'
import { BROADCAST, CloseCode, parseClientMessage, type InstanceInfo, type ServerLimits, type ServerMessage } from '@shared/nexa-server/protocol'
import type { SocketLike } from './connection'

/**
 * nexa-server in small, for the tests of the connection and the service: `/v1/info`, `/v1/join` with
 * invites, login with a real signature check, the relay and the requests, as its docs/PROTOCOL.md says.
 * Only for tests; nothing in the app imports it.
 */
export class FakeServer {
  readonly url = 'https://nexa.test'
  readonly invites = new Set<string>()
  readonly instances = new Map<string, InstanceInfo>()
  readonly sockets: FakeSocket[] = []
  /** Every `send` the server relayed, for tests that look at what went where. */
  readonly relayed: { from: string; to: string; kind: string }[] = []
  info: unknown = { name: 'nexa-server', version: '0.1.0', protocol: 1, pwa: false }
  /** The server's clock, for tests of a device whose clock is off. */
  now = (): number => Date.now()
  /** As `ready` tells them (null: it doesn't, like a server from before `limits`); the size is enforced. */
  limits: ServerLimits | null = { maxMessageBytes: 1024 * 1024, rateLimit: 100 }
  /** Instances that don't keep up with reading: what is sent to them gets `busy`. */
  readonly busy = new Set<string>()
  /** Connections closed for a message over the limit. */
  oversized = 0
  private counter = 0

  invite(): string {
    const code = `CODE-${++this.counter}`
    this.invites.add(code)
    return code
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url === `${this.url}/v1/info`) return Response.json(this.info)
    if (url === `${this.url}/v1/join` && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { invite: string; name: string; role: 'host' | 'controller'; signKey: string; dhKey: string }
      if (!this.invites.delete(body.invite)) return Response.json({ error: 'invite-invalid', message: 'invalid' }, { status: 403 })
      const id = `inst${++this.counter}`.padEnd(22, 'x')
      const info: InstanceInfo = { id, name: body.name, role: body.role, signKey: body.signKey, dhKey: body.dhKey, createdAt: Date.now(), lastSeen: null, online: false }
      this.instances.set(id, info)
      this.broadcast({ t: 'instance', event: 'joined', instance: info })
      return Response.json({ namespace: 'test', instance: id }, { status: 201 })
    }
    return Response.json({ error: 'not-found', message: 'not found' }, { status: 404 })
  }) as typeof fetch

  readonly socket = (url: string): SocketLike => {
    if (url !== 'wss://nexa.test/v1/ws') throw new Error(`unexpected url ${url}`)
    const socket = new FakeSocket(this)
    this.sockets.push(socket)
    queueMicrotask(() => socket.hello())
    return socket
  }

  /** The open sockets that logged in, by instance. */
  connected(id: string): FakeSocket | undefined {
    return this.sockets.find((s) => s.instance === id && s.open)
  }

  /** Removes an instance as the admin would: closed with 4403, the others told. */
  remove(id: string): void {
    this.instances.delete(id)
    this.connected(id)?.drop(CloseCode.Removed)
    this.broadcast({ t: 'removed', instance: id })
  }

  broadcast(msg: ServerMessage, except?: string): void {
    for (const socket of this.sockets) if (socket.open && socket.instance && socket.instance !== except) socket.deliver(msg)
  }

  handle(socket: FakeSocket, text: string): void {
    // Like `maxPayload` of the real one: a message too large closes the connection (1009).
    if (new TextEncoder().encode(text).length > (this.limits?.maxMessageBytes ?? 1024 * 1024)) {
      this.oversized++
      return socket.drop(1009)
    }
    const parsed = parseClientMessage(text)
    if (!parsed.ok) return socket.deliver({ t: 'error', re: parsed.re, code: 'bad-request', message: parsed.message })
    const msg = parsed.msg
    if (msg.t === 'auth') {
      const info = this.instances.get(msg.instance)
      void (info ? verifyAuth(info.signKey, socket.nonce, msg.sig) : Promise.resolve(false)).then((ok) => {
        if (!ok || !info) return socket.drop(CloseCode.AuthFailed)
        // A newer connection of the same instance takes over.
        this.connected(info.id)?.drop(CloseCode.Replaced)
        socket.instance = info.id
        info.online = true
        // Like the real one, which stamps the login before `ready`.
        info.lastSeen = this.now()
        const ready = { t: 'ready', instance: info.id, namespace: 'test', instances: [...this.instances.values()] }
        socket.deliver((this.limits ? { ...ready, limits: this.limits } : ready) as ServerMessage)
        this.broadcast({ t: 'instance', event: 'online', instance: info }, info.id)
      })
      return
    }
    const from = socket.instance
    if (!from) return socket.drop(CloseCode.AuthFailed)
    switch (msg.t) {
      case 'send': {
        this.relayed.push({ from, to: msg.to, kind: msg.kind })
        const relayed: ServerMessage = { t: 'msg', id: msg.id, from, to: msg.to, kind: msg.kind, body: msg.body }
        if (msg.to === BROADCAST) return this.broadcast(relayed, from)
        const target = this.connected(msg.to)
        if (!target) return socket.deliver({ t: 'error', re: msg.id, code: 'unreachable', message: 'not connected' })
        if (this.busy.has(msg.to)) return socket.deliver({ t: 'error', re: msg.id, code: 'busy', message: 'does not keep up' })
        return target.deliver(relayed)
      }
      case 'invite':
        return socket.deliver({ t: 'invite', re: msg.id, code: this.invite(), expiresAt: Date.now() + 15 * 60_000 })
      case 'instances':
        return socket.deliver({ t: 'instances', re: msg.id, instances: [...this.instances.values()] })
      case 'remove':
        if (!this.instances.has(msg.instance)) return socket.deliver({ t: 'error', re: msg.id, code: 'unknown-instance', message: 'unknown' })
        socket.deliver({ t: 'ok', re: msg.id })
        return this.remove(msg.instance)
      case 'rename': {
        const info = this.instances.get(msg.instance ?? from)
        if (!info) return socket.deliver({ t: 'error', re: msg.id, code: 'unknown-instance', message: 'unknown' })
        info.name = msg.name
        socket.deliver({ t: 'ok', re: msg.id })
        return this.broadcast({ t: 'instance', event: 'renamed', instance: info })
      }
    }
  }

  closed(socket: FakeSocket): void {
    const info = socket.instance ? this.instances.get(socket.instance) : undefined
    if (!info || this.connected(info.id)) return
    info.online = false
    info.lastSeen = Date.now()
    this.broadcast({ t: 'instance', event: 'offline', instance: info }, info.id)
  }
}

export class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  open = true
  instance: string | null = null
  readonly nonce = `nonce${Math.random().toString(36).slice(2)}`

  constructor(private readonly server: FakeServer) {}

  hello(): void {
    if (this.open) this.deliver({ t: 'hello', v: 1, nonce: this.nonce })
  }

  /** What was sent before a close still arrives, in order: the server answers `remove` before it closes. */
  deliver(msg: ServerMessage): void {
    if (this.open) queueMicrotask(() => this.onmessage?.({ data: JSON.stringify(msg) }))
  }

  /** Closed by the server. */
  drop(code: number): void {
    if (!this.open) return
    this.open = false
    this.server.closed(this)
    queueMicrotask(() => this.onclose?.({ code, reason: '' }))
  }

  send(data: string): void {
    if (this.open) this.server.handle(this, data)
  }

  /** Closed by the client. */
  close(code = 1000): void {
    if (!this.open) return
    this.open = false
    this.server.closed(this)
    queueMicrotask(() => this.onclose?.({ code, reason: '' }))
  }
}
