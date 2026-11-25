import { describe, expect, it, vi } from 'vitest'
import { MAX_APP_HTML } from '@shared/mcp-apps'

vi.mock('electron', () => ({ protocol: { handle: vi.fn() } }))

const { appPageOf, McpAppViews } = await import('./mcp-app-views')

const page = (html: string, meta: object = {}) => ({ contents: [{ uri: 'ui://w/view', mimeType: 'text/html;profile=mcp-app', text: html, _meta: meta }] })

describe('appPageOf', () => {
  it('takes the HTML as text or base64 blob, with its _meta', () => {
    expect(appPageOf(page('<p>hi</p>', { ui: { prefersBorder: false } }))).toEqual({ html: '<p>hi</p>', meta: { ui: { prefersBorder: false } } })
    const blob = { contents: [{ uri: 'ui://w', mimeType: 'text/html', blob: Buffer.from('<b>Grüße</b>').toString('base64') }] }
    expect(appPageOf(blob)).toEqual({ html: '<b>Grüße</b>', meta: {} })
  })

  it('refuses what isn’t an HTML page, or too large a one', () => {
    expect(() => appPageOf({ contents: [] })).toThrow('keine Oberfläche')
    expect(() => appPageOf({ contents: [{ mimeType: 'application/json', text: '{}' }] })).toThrow('kein HTML')
    expect(() => appPageOf(page('x'.repeat(MAX_APP_HTML + 1)))).toThrow('zu groß')
  })
})

describe('McpAppViews', () => {
  it('serves a page at its own address with the CSP of its resource', async () => {
    const views = new McpAppViews()
    const read = vi.fn(async () => page('<p>hi</p>', { ui: { csp: { connectDomains: ['https://api.example.com'] }, prefersBorder: true } }))
    const opened = await views.open('s1', 'tool-1', read)
    expect(opened.url).toMatch(/^nexa-app:\/\/[0-9a-f-]{36}\/$/)
    expect(opened.prefersBorder).toBe(true)

    const response = views.respond(opened.url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<p>hi</p>')
    expect(response.headers.get('content-security-policy')).toContain('connect-src https://api.example.com;')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('gives the same item its page again without reading it anew', async () => {
    const views = new McpAppViews()
    const read = vi.fn(async () => page('<p>hi</p>'))
    const first = await views.open('s1', 'tool-1', read)
    const again = await views.open('s1', 'tool-1', read)
    const other = await views.open('s1', 'tool-2', read)
    expect(again.url).toBe(first.url)
    expect(other.url).not.toBe(first.url)
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('serves nothing at unknown addresses or other paths', async () => {
    const views = new McpAppViews()
    const { url } = await views.open('s1', 'tool-1', async () => page('<p>hi</p>'))
    expect(views.respond('nexa-app://unknown/').status).toBe(404)
    expect(views.respond(`${url}favicon.ico`).status).toBe(404)
    expect(views.respond('::').status).toBe(404)
  })

  it('lets the oldest pages go when it holds too many', async () => {
    const views = new McpAppViews()
    const first = await views.open('s1', 'tool-0', async () => page('<p>0</p>'))
    for (let i = 1; i <= 40; i++) await views.open('s1', `tool-${i}`, async () => page(`<p>${i}</p>`))
    expect(views.respond(first.url).status).toBe(404)
  })
})
