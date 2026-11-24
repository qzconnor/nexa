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
import { renderDocsPage } from './docs-page'
import { buildOpenApi } from './openapi'
import { matchRoute, type ApiRouteKey } from './routes'

const HOST = '127.0.0.1'
const MAX_BODY = 1024 * 1024
const HEARTBEAT_MS = 25_000
/** The docs page runs nothing and loads nothing from elsewhere. */
const DOCS_CSP = "default-src 'none'; style-src 'unsafe-inline'"

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
  settings: Pick<SettingsService, 'get' | 'on'>
  accounts: Pick<AccountService, 'list'>
  providers: Pick<ProviderService, 'list' | 'usage' | 'on'>
  projects: Pick<ProjectService, 'list' | 'get' | 'create'>
  sessions: Pick<SessionService, 'list' | 'create' | 'send' | 'interrupt' | 'on'>
  /** Brings the window to the front, with the session if one is given. */
  show(sessionId?: string): void
}

/** What a route's handler gets of the request. */
interface RouteContext {
  params: Record<string, string>
  req: IncomingMessage
  res: ServerResponse
}

/** Answers a route: a value as JSON (200), undefined as 204, `HANDLED` when it wrote the response itself. */
type Handler = (ctx: RouteContext) => unknown

/**
 * Local HTTP API on 127.0.0.1 with a bearer token, for Stream Deck buttons, scripts and the like.
 * Off until switched on in the settings. Its routes and what they take and give are in `routes.ts`;
 * `/openapi.json` and the page `/docs` describe them, without the token.
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
      // Pages in a browser must not reach the API (DNS rebinding, CSRF), its description included.
      const host = (req.headers.host ?? '').replace(/:\d+$/, '')
      if (req.headers.origin || (host !== HOST && host !== 'localhost')) throw new HttpError(403, 'Nicht erlaubt.')
      const url = new URL(req.url ?? '/', `http://${HOST}`)
      const found = matchRoute(req.method ?? 'GET', url.pathname)
      if (!('route' in found)) {
        if (!found.allowed.length) throw new HttpError(404, 'Gibt es nicht.')
        res.setHeader('Allow', found.allowed.join(', '))
        throw new HttpError(405, 'Diese Methode gibt es hier nicht.')
      }
      if (!found.route.public && !this.authorized(req)) {
        res.setHeader('WWW-Authenticate', 'Bearer')
        throw new HttpError(401, 'Token fehlt oder ist falsch.')
      }
      const result = await this.handlers[found.key]({ params: found.params, req, res })
      if (result === HANDLED) return
      send(res, result === undefined ? 204 : 200, result)
    } catch (error) {
      // A stream that broke off has its head sent already.
      if (res.headersSent) return void res.end()
      const status = error instanceof HttpError ? error.status : 500
      send(res, status, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** The routes the server answers, as `GET /api/status` (for the test that the description names each). */
  routes(): ApiRouteKey[] {
    return Object.keys(this.handlers) as ApiRouteKey[]
  }

  /** What the server does for each route; keyed by `API_ROUTES`, so none goes without its description. */
  private readonly handlers: Record<ApiRouteKey, Handler> = {
    'GET /api/status': () => ({
      app: { name: 'Nexa', version: this.deps.version },
      providers: this.deps.providers.list(),
      usage: this.deps.providers.usage(),
      sessions: this.sessionList().filter((s) => s.status !== 'idle'),
    }),
    'GET /api/usage': () => this.deps.providers.usage(),
    'GET /api/accounts': () => this.deps.accounts.list(),
    'GET /api/projects': () => this.deps.projects.list(),
    'GET /api/sessions': () => this.sessionList(),
    'POST /api/sessions': ({ req }) => this.createSession(req),
    'POST /api/sessions/{id}/send': async ({ req, params }) => {
      const id = this.chatId(params.id)
      const body = await readBody(req)
      if (typeof body.text !== 'string' || !body.text.trim()) throw new HttpError(400, '„text“ fehlt.')
      await this.deps.sessions.send(id, { text: body.text })
    },
    'POST /api/sessions/{id}/interrupt': async ({ params }) => {
      await this.deps.sessions.interrupt(this.chatId(params.id))
    },
    'POST /api/sessions/{id}/show': ({ params }) => {
      this.deps.show(this.chatId(params.id))
    },
    'POST /api/window/show': () => {
      this.deps.show()
    },
    'GET /api/events': ({ res }) => {
      this.openStream(res)
      return HANDLED
    },
    'GET /openapi.json': () => buildOpenApi(this.baseUrl(), this.deps.version),
    'GET /docs': ({ res }) => {
      sendHtml(res, renderDocsPage(this.baseUrl(), this.deps.version))
      return HANDLED
    },
  }

  private baseUrl(): string {
    return `http://${HOST}:${this.port}`
  }

  /** The id of a chat that exists, else 404 (instead of the session service's 500). */
  private chatId(id: string | undefined): string {
    if (!id || !this.deps.sessions.list().some((s) => s.id === id)) throw new HttpError(404, 'Den Chat gibt es nicht.')
    return id
  }

  private async createSession(req: IncomingMessage): Promise<unknown> {
    const { projects, sessions } = this.deps
    const body = await readBody(req)
    let projectId = typeof body.projectId === 'string' ? body.projectId : null
    if (projectId && !projects.get(projectId)) throw new HttpError(404, 'Das Projekt gibt es nicht.')
    if (!projectId) {
      if (typeof body.path !== 'string') throw new HttpError(400, '„path“ oder „projectId“ fehlt.')
      try {
        projectId = (await projects.create({ path: body.path })).id
      } catch (error) {
        // A folder that isn't there (or no folder) is the caller's mistake.
        throw new HttpError(400, error instanceof Error ? error.message : String(error))
      }
    }
    const provider = PROVIDER_IDS.includes(body.provider as ProviderId) ? (body.provider as ProviderId) : undefined
    const account = typeof body.account === 'string' ? body.account : undefined
    const meta = await sessions.create({ projectId, provider, account })
    if (typeof body.prompt === 'string' && body.prompt.trim()) await sessions.send(meta.id, { text: body.prompt })
    if (body.show !== false) this.deps.show(meta.id)
    return meta
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

const HANDLED = Symbol('handled')

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Content-Security-Policy': DOCS_CSP,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(html)
}

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
