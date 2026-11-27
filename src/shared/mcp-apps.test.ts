import { describe, expect, it } from 'vitest'
import { appContextText, appResultOf, boundedJson, claudeServerKey, cspOf, MAX_APP_CONTEXT, MAX_APP_RESULT_JSON, mcpAppCsp, toolUiOf, uiUri } from './mcp-apps'

describe('appContextText', () => {
  it('takes the text blocks, names other blocks and adds the structured content as JSON', () => {
    const params = {
      content: [
        { type: 'text', text: ' Köln ist gewählt ' },
        { type: 'image', data: 'x', mimeType: 'image/png' },
        'kein Block',
      ],
      structuredContent: { city: 'Köln' },
    }
    expect(appContextText(params)).toBe('Köln ist gewählt\n\n[image]\n\n{"city":"Köln"}')
  })

  it('takes nothing as taking the context back, and cuts what is too long', () => {
    expect(appContextText({})).toBeNull()
    expect(appContextText({ content: [], structuredContent: {} })).toBeNull()
    expect(appContextText(null)).toBeNull()
    expect(appContextText({ content: [{ type: 'text', text: 'x'.repeat(MAX_APP_CONTEXT + 10) }] })).toHaveLength(MAX_APP_CONTEXT + 1)
  })
})

describe('uiUri', () => {
  it('takes ui:// addresses only', () => {
    expect(uiUri('ui://weather/view.html')).toBe('ui://weather/view.html')
    expect(uiUri('ui://')).toBeNull()
    expect(uiUri('https://example.com')).toBeNull()
    expect(uiUri(`ui://${'x'.repeat(3000)}`)).toBeNull()
    expect(uiUri(42)).toBeNull()
  })
})

describe('toolUiOf', () => {
  it('reads the page and who may call the tool', () => {
    expect(toolUiOf({ ui: { resourceUri: 'ui://a/b', visibility: ['app'] } })).toEqual({ resourceUri: 'ui://a/b', visibility: ['app'] })
  })

  it('takes the older flat key, and both audiences without a visibility', () => {
    expect(toolUiOf({ 'ui/resourceUri': 'ui://old' })).toEqual({ resourceUri: 'ui://old', visibility: ['model', 'app'] })
    expect(toolUiOf(undefined)).toEqual({ resourceUri: null, visibility: ['model', 'app'] })
  })

  it('drops audiences it doesn’t know', () => {
    expect(toolUiOf({ ui: { visibility: ['model', 'admin'] } }).visibility).toEqual(['model'])
  })
})

describe('claudeServerKey', () => {
  it('names a server as Claude Code does in tool names', () => {
    expect(claudeServerKey('claude.ai Gmail')).toBe('claude_ai_Gmail')
    expect(claudeServerKey('my-server_2')).toBe('my-server_2')
  })
})

describe('boundedJson', () => {
  it('keeps small values and drops large or circular ones', () => {
    expect(boundedJson({ a: 1 }, 100)).toEqual({ a: 1 })
    expect(boundedJson('x'.repeat(200), 100)).toBeUndefined()
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(boundedJson(loop, 100)).toBeUndefined()
  })
})

describe('appResultOf', () => {
  it('keeps content blocks, structured content and _meta', () => {
    const raw = { content: [{ type: 'text', text: 'ok' }, 'junk'], structuredContent: { temp: 21 }, _meta: { k: 1 } }
    expect(appResultOf(raw)).toEqual({ content: [{ type: 'text', text: 'ok' }], structuredContent: { temp: 21 }, _meta: { k: 1 } })
  })

  it('makes one text block of text alone (Claude’s mcp_call, an error)', () => {
    expect(appResultOf({ content: 'Fertig' })).toEqual({ content: [{ type: 'text', text: 'Fertig' }] })
    expect(appResultOf('kaputt', true)).toEqual({ content: [{ type: 'text', text: 'kaputt' }], isError: true })
    expect(appResultOf({ content: [], isError: true }).isError).toBe(true)
  })

  it('leaves out structured content too large to keep', () => {
    const result = appResultOf({ content: [], structuredContent: { big: 'x'.repeat(MAX_APP_RESULT_JSON) } })
    expect(result).toEqual({ content: [] })
  })
})

describe('cspOf and mcpAppCsp', () => {
  it('allows nothing outside by default', () => {
    const csp = mcpAppCsp(cspOf(undefined))
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain("script-src 'unsafe-inline' blob:;")
  })

  it('takes well-formed origins and nothing that could end a directive', () => {
    const meta = {
      ui: {
        csp: {
          connectDomains: ['https://api.example.com', 'https://evil.com; script-src *', 'javascript:alert(1)'],
          resourceDomains: ['https://*.cdn.example.com', 'https://cdn.example.com:8443', 'https://cdn.example.com:8443'],
          frameDomains: ['https://www.youtube.com'],
        },
      },
    }
    const parsed = cspOf(meta)
    expect(parsed.connectDomains).toEqual(['https://api.example.com'])
    expect(parsed.resourceDomains).toEqual(['https://*.cdn.example.com', 'https://cdn.example.com:8443'])
    const csp = mcpAppCsp(parsed)
    expect(csp).toContain('connect-src https://api.example.com;')
    expect(csp).toContain('img-src data: blob: https://*.cdn.example.com https://cdn.example.com:8443;')
    expect(csp).toContain('frame-src https://www.youtube.com;')
    expect(csp).toContain("base-uri 'none'")
  })
})
