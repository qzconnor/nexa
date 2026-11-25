import { randomUUID } from 'node:crypto'
import { protocol } from 'electron'
import { cspOf, MAX_APP_HTML, MCP_APP_SCHEME, mcpAppCsp, type McpAppOpened } from '@shared/mcp-apps'
import { isPlainObject } from '@shared/utils'

/** All pages held at once; the oldest go first, a frame that shows one again reads it anew. */
const MAX_VIEWS_BYTES = 24 * 1024 * 1024
const MAX_VIEWS = 40

/** A page as a server gave it: its HTML and the `_meta` of its resource (CSP, border). */
export interface McpAppPage {
  html: string
  meta: Record<string, unknown>
}

interface View {
  key: string
  html: string
  csp: string
  prefersBorder: boolean | null
}

/**
 * The page in the result of `resources/read` (`{ contents: [...] }`): the first HTML entry, as text or
 * base64 `blob`. Anything else, or more than `MAX_APP_HTML`, is refused with a message for the chat.
 */
export function appPageOf(read: unknown): McpAppPage {
  const contents = isPlainObject(read) && Array.isArray(read.contents) ? read.contents.filter(isPlainObject) : []
  const entry = contents.find((c) => typeof c.text === 'string' || typeof c.blob === 'string')
  if (!entry) throw new Error('Der Server hat keine Oberfläche geliefert.')
  const mime = typeof entry.mimeType === 'string' ? entry.mimeType.toLowerCase() : ''
  if (mime && !mime.startsWith('text/html')) throw new Error(`Die Oberfläche ist kein HTML (${String(entry.mimeType)}).`)
  let html: string
  if (typeof entry.text === 'string') html = entry.text
  else {
    const blob = entry.blob as string
    // Checked before decoding: base64 is a third larger than what it holds.
    if (blob.length > Math.ceil((MAX_APP_HTML * 4) / 3) + 4) throw new Error('Die Oberfläche ist zu groß.')
    html = Buffer.from(blob, 'base64').toString('utf8')
  }
  if (html.length > MAX_APP_HTML) throw new Error('Die Oberfläche ist zu groß.')
  return { html, meta: isPlainObject(entry._meta) ? entry._meta : {} }
}

/** Whether the page wants a frame around it (`_meta.ui.prefersBorder`); null when it leaves it open. */
function prefersBorderOf(meta: Record<string, unknown>): boolean | null {
  const ui = isPlainObject(meta.ui) ? meta.ui : {}
  return typeof ui.prefersBorder === 'boolean' ? ui.prefersBorder : null
}

/**
 * The pages of MCP tools, each at an address of its own (`nexa-app://<token>/`) with the CSP its
 * resource asks for in the response: the renderer's own CSP couldn't hold a page's domains, and a
 * `srcdoc` frame would take over the renderer's. The frame is sandboxed without `allow-same-origin`,
 * so the page has no origin of its own either and reaches Nexa only through `postMessage`.
 */
export class McpAppViews {
  /** Token → page, oldest first. */
  private readonly views = new Map<string, View>()
  /** Session and item → token: a frame that comes again gets the page it had. */
  private readonly tokens = new Map<string, string>()

  /** The address of a tool item's page, read with `read` unless Nexa still holds it. */
  async open(sessionId: string, itemId: string, read: () => Promise<unknown>): Promise<McpAppOpened> {
    const key = `${sessionId}\n${itemId}`
    const held = this.tokens.get(key)
    const view = held ? this.views.get(held) : undefined
    if (held && view) {
      // Newest again, so a page in view outlives the ones scrolled away.
      this.views.delete(held)
      this.views.set(held, view)
      return { url: this.url(held), prefersBorder: view.prefersBorder }
    }
    const page = appPageOf(await read())
    const token = randomUUID()
    const prefersBorder = prefersBorderOf(page.meta)
    this.views.set(token, { key, html: page.html, csp: mcpAppCsp(cspOf(page.meta)), prefersBorder })
    this.tokens.set(key, token)
    this.trim()
    return { url: this.url(token), prefersBorder }
  }

  /** What the scheme serves for a request: the page with its headers, else 404. */
  respond(url: string): Response {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return new Response('Not found', { status: 404 })
    }
    const view = parsed.pathname === '/' ? this.views.get(parsed.hostname) : undefined
    if (!view) return new Response('Not found', { status: 404 })
    return new Response(view.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': view.csp,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  }

  /** Serves the scheme; it is registered with the others before the app is ready (index.ts). */
  handle(): void {
    protocol.handle(MCP_APP_SCHEME, (request) => this.respond(request.url))
  }

  private url(token: string): string {
    return `${MCP_APP_SCHEME}://${token}/`
  }

  private trim(): void {
    let bytes = 0
    for (const view of this.views.values()) bytes += view.html.length
    for (const [token, view] of this.views) {
      if (this.views.size <= 1 || (bytes <= MAX_VIEWS_BYTES && this.views.size <= MAX_VIEWS)) break
      bytes -= view.html.length
      this.views.delete(token)
      this.tokens.delete(view.key)
    }
  }
}

/** The scheme's privileges: a standard, secure address, so pages resolve relative URLs and get a secure context. */
export const MCP_APP_SCHEME_PRIVILEGES = { scheme: MCP_APP_SCHEME, privileges: { standard: true, secure: true } }
