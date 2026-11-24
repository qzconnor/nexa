import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: {} }))

import { ApiServer, type ApiDeps } from './api-server'
import { buildOpenApi } from './openapi'

const TOKEN = 'test-token-0123456789'
const CHAT = { id: 'c1', projectId: 'p1', title: 'Demo', provider: 'claude', model: '', updatedAt: 1 }

let dir: string
let port: number
let server: ApiServer
let deps: ReturnType<typeof fakeDeps>

/** A port nothing listens on right now. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port: free } = probe.address() as AddressInfo
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return free
}

function fakeDeps(userDataDir: string, apiPort: number) {
  const off = () => undefined
  return {
    userDataDir,
    version: '1.2.3',
    settings: { get: () => ({ api: { enabled: true, port: apiPort } }), on: () => off },
    accounts: { list: vi.fn(() => []) },
    providers: { list: () => [], usage: () => [], on: () => off },
    projects: { list: () => [], get: (id: string) => (id === 'p1' ? { id } : undefined), create: vi.fn(async () => ({ id: 'p1' })) },
    sessions: { list: () => [CHAT], create: vi.fn(async () => CHAT), send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), on: () => off },
    show: vi.fn(),
  }
}

interface Answer {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

/** A request to the server; resolves once the head of the answer is there. */
function open(path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', agent: false, headers: options.headers }, resolve)
    req.on('error', reject)
    req.end(options.body)
  })
}

async function send(path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Answer> {
  const res = await open(path, options)
  let body = ''
  res.setEncoding('utf8')
  for await (const chunk of res) body += chunk
  return { status: res.statusCode ?? 0, headers: res.headers, body }
}

const auth = { authorization: `Bearer ${TOKEN}` }

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexa-api-'))
  port = await freePort()
  // A token as an older Nexa kept it, readable: no key store needed in the test.
  await writeFile(join(dir, 'api.json'), JSON.stringify({ version: 1, token: TOKEN }))
  deps = fakeDeps(dir, port)
  server = new ApiServer(deps as unknown as ApiDeps)
  await server.init()
  expect(server.status()).toMatchObject({ running: true, port, token: TOKEN })
})

afterEach(async () => {
  server.dispose()
  await rm(dir, { recursive: true, force: true, maxRetries: 3 })
})

describe('ApiServer and its description', () => {
  it('serves the docs page and the OpenAPI document without the token', async () => {
    const docs = await send('/docs')
    expect(docs.status).toBe(200)
    expect(docs.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(docs.headers['content-security-policy']).toBe("default-src 'none'; style-src 'unsafe-inline'")
    expect(docs.body).toContain(`http://127.0.0.1:${port}/api/status`)
    const openapi = await send('/openapi.json')
    expect(openapi.status).toBe(200)
    expect(JSON.parse(openapi.body)).toEqual(buildOpenApi(`http://127.0.0.1:${port}`, '1.2.3'))
  })

  it('answers every route the description names', async () => {
    const doc = buildOpenApi(`http://127.0.0.1:${port}`, '1.2.3') as { paths: Record<string, Record<string, unknown>> }
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const method of Object.keys(methods)) {
        const url = path.replace('{id}', CHAT.id)
        const body = method === 'post' ? JSON.stringify({ text: 'Hallo', projectId: 'p1' }) : undefined
        const res = await open(url, { method: method.toUpperCase(), headers: auth, body })
        // The event stream stays open: its head is enough.
        res.destroy()
        expect(res.statusCode, `${method.toUpperCase()} ${path}`).toBeLessThan(300)
      }
    }
    expect(deps.sessions.send).toHaveBeenCalledWith('c1', { text: 'Hallo' })
    expect(deps.sessions.interrupt).toHaveBeenCalledWith('c1')
    expect(deps.show).toHaveBeenCalledWith('c1')
  })

  it('wants the token for everything else, and refuses pages of other origins even the docs', async () => {
    expect((await send('/api/status')).status).toBe(401)
    expect((await send('/api/status', { headers: { authorization: 'Bearer falsch' } })).status).toBe(401)
    expect(deps.accounts.list).not.toHaveBeenCalled()
    for (const path of ['/docs', '/openapi.json', '/api/status']) {
      expect((await send(path, { headers: { ...auth, origin: 'https://site.example' } })).status, path).toBe(403)
      expect((await send(path, { headers: { ...auth, host: `rebind.example:${port}` } })).status, path).toBe(403)
    }
  })

  it('says what is not there: a path, a method, a chat, a project', async () => {
    expect(await send('/api/nothing', { headers: auth })).toMatchObject({ status: 404, body: JSON.stringify({ error: 'Gibt es nicht.' }) })
    const wrong = await send('/api/sessions', { method: 'DELETE', headers: auth })
    expect(wrong.status).toBe(405)
    expect(wrong.headers.allow).toBe('GET, POST')
    expect((await send('/api/sessions/gone/send', { method: 'POST', headers: auth, body: '{"text":"x"}' })).status).toBe(404)
    expect(deps.sessions.send).not.toHaveBeenCalled()
    expect((await send('/api/sessions', { method: 'POST', headers: auth, body: '{"projectId":"p9"}' })).status).toBe(404)
  })

  it('takes a folder that is not there as a bad request', async () => {
    deps.projects.create.mockRejectedValueOnce(new Error('Den Ordner „X:\\nix“ gibt es nicht.'))
    const answer = await send('/api/sessions', { method: 'POST', headers: auth, body: JSON.stringify({ path: 'X:\\nix' }) })
    expect(answer).toMatchObject({ status: 400, body: JSON.stringify({ error: 'Den Ordner „X:\\nix“ gibt es nicht.' }) })
    expect((await send('/api/sessions', { method: 'POST', headers: auth, body: '{}' })).status).toBe(400)
    expect(deps.sessions.create).not.toHaveBeenCalled()
  })
})
