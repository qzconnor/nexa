import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: {} }))

import { ApiServer, type ApiDeps } from './api-server'
import { renderDocsPage } from './docs-page'
import { API_SCHEMAS, buildOpenApi } from './openapi'
import { API_ROUTES, matchRoute } from './routes'

const BASE = 'http://127.0.0.1:47615'
const doc = buildOpenApi(BASE, '1.2.3') as {
  paths: Record<string, Record<string, { operationId: string; parameters?: { name: string; in: string }[]; responses: Record<string, unknown>; security?: unknown[] }>>
  components: { schemas: Record<string, unknown> }
}
const operations = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ key: `${method.toUpperCase()} ${path}`, path, op })))

/** Every `$ref` anywhere in a value. */
function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([key, inner]) => (key === '$ref' && typeof inner === 'string' ? [inner] : refs(inner)))
}

describe('the OpenAPI document', () => {
  it('describes every route the server answers, and no other', () => {
    // The server's handlers, not the table: a route answered without a description fails here.
    const server = new ApiServer({ userDataDir: 'unused', version: '1.2.3' } as unknown as ApiDeps)
    expect(operations.map((o) => o.key).sort()).toEqual(server.routes().sort())
  })

  it('names each parameter of a path, and only those', () => {
    for (const { key, path, op } of operations) {
      const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
      expect((op.parameters ?? []).filter((p) => p.in === 'path').map((p) => p.name), key).toEqual(inPath)
    }
  })

  it('has unique operation ids, a success and the errors of each route', () => {
    const ids = operations.map((o) => o.op.operationId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const { key, op } of operations) {
      expect(Object.keys(op.responses).some((status) => status === '200' || status === '204'), key).toBe(true)
      expect(op.responses['403'], key).toBeDefined()
      // The description itself is there without the token, everything else needs it.
      if (op.security) expect(op.responses['401'], key).toBeUndefined()
      else expect(op.responses['401'], key).toBeDefined()
    }
    expect(doc.paths['/docs']!.get!.security).toEqual([])
    expect(doc.paths['/api/sessions/{id}/send']!.post!.responses['404']).toBeDefined()
  })

  it('refers only to shapes it has', () => {
    const known = new Set(Object.keys(API_SCHEMAS).map((name) => `#/components/schemas/${name}`))
    for (const ref of refs(doc)) expect(known.has(ref), ref).toBe(true)
  })
})

describe('matchRoute', () => {
  it('finds a route with its parameters, without minding slashes at the end', () => {
    expect(matchRoute('POST', '/api/sessions/abc%20d/send/')).toMatchObject({ key: 'POST /api/sessions/{id}/send', params: { id: 'abc d' } })
    expect(matchRoute('GET', '/api/status')).toMatchObject({ key: 'GET /api/status', params: {} })
  })

  it('names the methods a path has for another one, and none for a path it doesn’t know', () => {
    expect(matchRoute('DELETE', '/api/sessions')).toEqual({ allowed: ['GET', 'POST'] })
    expect(matchRoute('GET', '/api/nothing')).toEqual({ allowed: [] })
    expect(matchRoute('GET', '/api/sessions/a/b/c')).toEqual({ allowed: [] })
  })
})

describe('the docs page', () => {
  const page = renderDocsPage(BASE, '1.2.3')

  it('shows every route and every shape', () => {
    for (const route of API_ROUTES) expect(page, route.path).toContain(`id="${route.operationId}"`)
    for (const name of Object.keys(API_SCHEMAS)) expect(page, name).toContain(`id="schema-${name}"`)
  })

  it('runs nothing and loads nothing from elsewhere', () => {
    expect(page).not.toMatch(/<script|<link|<img|<iframe|@import|url\(/i)
    // Addresses only of the API itself.
    for (const url of page.match(/https?:\/\/[^\s"'<]+/g) ?? []) expect(url.startsWith(BASE), url).toBe(true)
  })
})
