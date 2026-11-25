import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isPlainObject } from '@shared/utils'
import type { McpCallLog } from './call-log'
import { handleRpc, INVALID_REQUEST, isRequest, PARSE_ERROR, rpcError, type McpServerSpec } from './mcp-protocol'

const HOST = '127.0.0.1'
const MAX_BODY = 4 * 1024 * 1024
/** Keeps a long tool call's stream open (Claude Code's HTTP client gives up after 5 min of silence). */
const KEEPALIVE_MS = 20_000

/**
 * Who calls: a Nexa session (its id). Claude gets the token through `--mcp-config`, Codex per
 * thread in its config (`mcp_servers.nexa.http_headers`); null for a caller that belongs to no chat.
 */
export interface McpCaller {
  sessionId: string | null
  /** Keeps the arguments of its tool calls, for a CLI that doesn't report them (Gemini CLI). */
  calls?: McpCallLog
}

/**
 * Nexa's MCP server (Streamable HTTP on 127.0.0.1, a free port) for the CLIs it starts. Each caller
 * gets its own bearer token, which also says whose browser its browser tools drive; requests from
 * pages (an Origin) or other host names are refused. Only POST is answered; a tool call that may take
 * long (the user has the browser) is answered as a stream that comments keep open.
 */
export class NexaMcpServer {
  private server: Server | null = null
  private port = 0
  private readonly tokens = new Map<string, McpCaller>()

  constructor(private readonly spec: (caller: McpCaller) => McpServerSpec) {}

  async start(): Promise<void> {
    const server = createServer((req, res) => void this.handle(req, res).catch((error) => fail(res, error)))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, HOST, () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.on('error', (error) => console.error('[mcp] server error', error))
    const address = server.address()
    this.port = typeof address === 'object' && address ? address.port : 0
    this.server = server
  }

  get running(): boolean {
    return this.server !== null
  }

  get url(): string {
    return `http://${HOST}:${this.port}/mcp`
  }

  grant(caller: McpCaller, token = randomBytes(32).toString('base64url')): string {
    this.tokens.set(token, caller)
    return token
  }

  revoke(token: string): void {
    this.tokens.delete(token)
  }

  dispose(): void {
    this.tokens.clear()
    this.server?.close()
    this.server?.closeAllConnections()
    this.server = null
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = req.headers.host ?? ''
    if ((host !== `${HOST}:${this.port}` && host !== `localhost:${this.port}`) || req.headers.origin !== undefined) {
      return sendPlain(res, 403, 'Forbidden')
    }
    if (new URL(req.url ?? '/', `http://${host}`).pathname !== '/mcp') return sendPlain(res, 404, 'Not found')
    const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.authorization ?? '')
    const caller = match ? this.tokens.get(match[1]) : undefined
    if (!caller) return sendPlain(res, 401, 'Unauthorized')
    if (req.method === 'DELETE') return sendPlain(res, 200, '')
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST, DELETE' })
      return void res.end()
    }
    let body: string
    try {
      body = await readBody(req)
    } catch {
      return sendJson(res, 413, rpcError(null, INVALID_REQUEST, 'Request too large.'))
    }
    let message: unknown
    try {
      message = JSON.parse(body)
    } catch {
      return sendJson(res, 400, rpcError(null, PARSE_ERROR, 'Invalid JSON.'))
    }
    const spec = this.spec(caller)
    if (caller.calls && isToolCall(message)) {
      const params = (message as { params?: unknown }).params
      const name = isPlainObject(params) && typeof params.name === 'string' ? params.name : null
      if (name) caller.calls.record(name, isPlainObject(params) && isPlainObject(params.arguments) ? params.arguments : {})
    }
    if (isToolCall(message) && (req.headers.accept ?? '').includes('text/event-stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
      res.flushHeaders()
      const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS)
      try {
        const answer = await handleRpc(spec, message)
        if (!res.writableEnded && !res.destroyed) res.write(`event: message\ndata: ${JSON.stringify(answer)}\n\n`)
      } finally {
        clearInterval(keepalive)
        res.end()
      }
      return
    }
    const answer = await handleRpc(spec, message)
    if (answer === null || (!Array.isArray(message) && !isRequest(message))) {
      res.writeHead(202)
      return void res.end()
    }
    sendJson(res, 200, answer)
  }
}

function isToolCall(message: unknown): boolean {
  return isRequest(message) && (message as { method: string }).method === 'tools/call'
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY) throw new Error('too large')
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), 'Cache-Control': 'no-store' })
  res.end(payload)
}

function sendPlain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(text)
}

function fail(res: ServerResponse, error: unknown): void {
  console.error('[mcp] request failed', error)
  if (!res.headersSent) sendPlain(res, 500, 'Internal error')
  else res.end()
}
