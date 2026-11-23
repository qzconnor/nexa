import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import { PROVIDER_IDS, type ProviderId, type SessionRuntime } from '@shared/chat'
import type { ApiStatus } from '@shared/types'
import { readJsonSync, writeJsonAtomic } from '../lib/json-file'
import { decryptSecret, encryptSecret } from '../lib/secrets'
import type { ProjectService } from '../services/project-service'
import type { AccountService } from '../accounts/account-service'
import type { ProviderService } from '../services/provider-service'
import type { SessionService } from '../services/session-service'
import type { SettingsService } from '../services/settings-service'

const HOST = '127.0.0.1'
const MAX_BODY = 1024 * 1024
const HEARTBEAT_MS = 25_000

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface ApiDeps {
  userDataDir: string
  version: string
  settings: SettingsService
  accounts: AccountService
  providers: ProviderService
  projects: ProjectService
  sessions: SessionService
  /** Brings the window to the front, with the session if one is given. */
  show(sessionId?: string): void
}

/**
 * Local HTTP API on 127.0.0.1 with a bearer token, for Stream Deck buttons, scripts and the like.
 * Off until switched on in the settings. Routes:
 *
 *   GET  /api/status                       app, CLIs, usage, sessions that run or wait
 *   GET  /api/usage                        usage of every account's plan
 *   GET  /api/accounts                     accounts of every CLI with their login
 *   GET  /api/projects                     projects
 *   GET  /api/sessions                     sessions with their state
 *   POST /api/sessions                     { path | projectId, provider?, account?, prompt?, show? } new chat
 *   POST /api/sessions/:id/send            { text }
 *   POST /api/sessions/:id/interrupt
 *   POST /api/sessions/:id/show
 *   POST /api/window/show
 *   GET  /api/events                       Server-Sent Events: sessions, runtime, usage
 */
export class ApiServer {
  private server: Server | null = null
  private port = 0
  private token = ''
  private error: string | null = null
  private readonly clients = new Set<ServerResponse>()
  private readonly runtimes = new Map<string, SessionRuntime>()
  private queue: Promise<void> = Promise.resolve()
  private readonly file: string
  private readonly offs: (() => void)[] = []

  constructor(private readonly deps: ApiDeps) {
    this.file = join(deps.userDataDir, 'api.json')
  }

  async init(): Promise<void> {
    this.token = await this.loadToken()
    const { settings, sessions, providers } = this.deps
    this.offs.push(
      settings.on('changed', () => void this.sync()),
      sessions.on('changed', (list) => this.broadcast('sessions', list)),
      sessions.on('event', (event) => {
        if (event.type !== 'runtime') return
        this.runtimes.set(event.sessionId, event.runtime)
        this.broadcast('runtime', { sessionId: event.sessionId, runtime: event.runtime })
      }),
      providers.on('usage', (list) => this.broadcast('usage', list)),
    )
    await this.sync()
  }

  status(): ApiStatus {
    const running = this.server !== null
    return { running, port: running ? this.port : null, token: this.token || null, error: this.error ?? undefined }
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off()
    void this.stop()
  }

  private async loadToken(): Promise<string> {
    const saved = readJsonSync<{ token?: string; encrypted?: boolean }>(this.file)
    if (saved?.token && !saved.encrypted) return saved.token
    if (saved?.token) {
      const decrypted = await decryptSecret(saved.token)
      if (decrypted) {
        if (decrypted.reEncrypted) await this.saveToken(decrypted.reEncrypted, true)
        return decrypted.plain
      }
      // A token of another Windows user or a reinstalled system: a new one below.
    }
    const token = randomBytes(24).toString('base64url')
    // Without the system's key store the token stays readable: the API only listens on 127.0.0.1 and
    // the settings show the token anyway, unlike the secrets of accounts.
    const encrypted = await encryptSecret(token).catch(() => null)
    await this.saveToken(encrypted ?? token, encrypted !== null)
    return token
  }

  private saveToken(token: string, encrypted: boolean): Promise<void> {
    return writeJsonAtomic(this.file, { version: 1, encrypted, token }).catch(() => undefined)
  }

  private sync(): Promise<void> {
    this.queue = this.queue
      .then(async () => {
        const { enabled, port } = this.deps.settings.get().api
        if (this.server && (!enabled || port !== this.port)) await this.stop()
        if (!enabled) this.error = null
        if (enabled && !this.server) await this.start(port)
      })
      .catch((error) => console.error('[api] sync failed', error))
    return this.queue
  }

  private async start(port: number): Promise<void> {
    const server = createServer((req, res) => void this.handle(req, res))
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, HOST, () => {
          server.off('error', reject)
          resolve()
        })
      })
      this.server = server
      this.port = port
      this.error = null
    } catch (error) {
      this.error = (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${port} ist schon belegt.` : String(error)
    }
  }

  private async stop(): Promise<void> {
    const server = this.server
    this.server = null
    for (const res of this.clients) res.end()
    this.clients.clear()
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private authorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? ''
    const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
    const expected = Buffer.from(this.token)
    return given.length === expected.length && timingSafeEqual(given, expected)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      // Pages in a browser must not reach the API (DNS rebinding, CSRF).
      const host = (req.headers.host ?? '').replace(/:\d+$/, '')
      if (req.headers.origin || (host !== HOST && host !== 'localhost')) throw new HttpError(403, 'Nicht erlaubt.')
      if (!this.authorized(req)) throw new HttpError(401, 'Token fehlt oder ist falsch.')
      const url = new URL(req.url ?? '/', `http://${HOST}`)
      const parts = url.pathname.split('/').filter(Boolean)
      if (parts[0] !== 'api') throw new HttpError(404, 'Gibt es nicht.')
      const result = await this.route(req.method ?? 'GET', parts.slice(1), req, res)
      if (result === STREAM) return
      send(res, result === undefined ? 204 : 200, result)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      send(res, status, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async route(method: string, parts: string[], req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    const { providers, projects, sessions } = this.deps
    const [first, id, action] = parts
    const key = `${method} ${first ?? ''}${id ? (action ? '/:id/' + action : '/:id') : ''}`
    switch (key) {
      case 'GET status':
        return {
          app: { name: 'Nexa', version: this.deps.version },
          providers: providers.list(),
          usage: providers.usage(),
          sessions: this.sessionList().filter((s) => s.status !== 'idle'),
        }
      case 'GET usage':
        return providers.usage()
      case 'GET accounts':
        return this.deps.accounts.list()
      case 'GET projects':
        return projects.list()
      case 'GET sessions':
        return this.sessionList()
      case 'POST sessions': {
        const body = await readBody(req)
        let projectId = typeof body.projectId === 'string' ? body.projectId : null
        if (!projectId) {
          if (typeof body.path !== 'string') throw new HttpError(400, '„path“ oder „projectId“ fehlt.')
          projectId = (await projects.create({ path: body.path })).id
        }
        const provider = PROVIDER_IDS.includes(body.provider as ProviderId) ? (body.provider as ProviderId) : undefined
        const account = typeof body.account === 'string' ? body.account : undefined
        const meta = await sessions.create({ projectId, provider, account })
        if (typeof body.prompt === 'string' && body.prompt.trim()) await sessions.send(meta.id, { text: body.prompt })
        if (body.show !== false) this.deps.show(meta.id)
        return meta
      }
      case 'POST sessions/:id/send': {
        const body = await readBody(req)
        if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError(400, '„text“ fehlt.')
        await sessions.send(id, { text: body.text })
        return undefined
      }
      case 'POST sessions/:id/interrupt':
        await sessions.interrupt(id)
        return undefined
      case 'POST sessions/:id/show':
        this.deps.show(id)
        return undefined
      case 'POST window/show':
        this.deps.show()
        return undefined
      case 'GET events':
        this.openStream(res)
        return STREAM
      default:
        throw new HttpError(404, 'Gibt es nicht.')
    }
  }

  private sessionList() {
    return this.deps.sessions.list().map((meta) => {
      const runtime = this.runtimes.get(meta.id)
      return {
        id: meta.id,
        projectId: meta.projectId,
        title: meta.title,
        provider: meta.provider,
        model: meta.model,
        updatedAt: meta.updatedAt,
        status: runtime?.status ?? 'idle',
      }
    })
  }

  private openStream(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    res.write(': nexa\n\n')
    this.clients.add(res)
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
    res.on('close', () => {
      clearInterval(heartbeat)
      this.clients.delete(res)
    })
  }

  private broadcast(event: string, data: unknown): void {
    if (!this.clients.size) return
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const res of this.clients) res.write(payload)
  }
}

const STREAM = Symbol('stream')

function send(res: ServerResponse, status: number, body: unknown): void {
  if (status === 204) {
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    res.end()
    return
  }
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new HttpError(413, 'Zu groß.')
    chunks.push(chunk as Buffer)
  }
  if (!size) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // below
  }
  throw new HttpError(400, 'Der Body muss ein JSON-Objekt sein.')
}
