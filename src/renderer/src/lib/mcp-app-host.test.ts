import { describe, expect, it, vi } from 'vitest'
import { clampHeight, MAX_APP_HEIGHT, McpAppHost, type McpAppHostContext, type McpAppHostDeps, messageText, openableLink } from './mcp-app-host'

const CONTEXT: McpAppHostContext = {
  theme: 'dark',
  styles: { variables: {} },
  displayMode: 'inline',
  availableDisplayModes: ['inline'],
  containerDimensions: { maxHeight: MAX_APP_HEIGHT },
  locale: 'de-DE',
  timeZone: 'Europe/Berlin',
  platform: 'desktop',
  userAgent: 'Nexa/1.0.0',
  deviceCapabilities: { touch: false, hover: true },
}

function setup(overrides: Partial<McpAppHostDeps> = {}) {
  const posted: Record<string, unknown>[] = []
  const deps: McpAppHostDeps = {
    post: (message) => posted.push(message as Record<string, unknown>),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    readResource: vi.fn(async () => ({ contents: [] })),
    openLink: vi.fn(),
    message: vi.fn(),
    resize: vi.fn(),
    context: () => CONTEXT,
    version: '1.0.0',
    ...overrides,
  }
  const host = new McpAppHost(deps)
  const methods = () => posted.map((m) => m.method ?? `#${String(m.id)}`)
  return { host, deps, posted, methods }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function initialize(host: McpAppHost): Promise<void> {
  host.receive({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: { protocolVersion: '2026-01-26', appInfo: { name: 'w', version: '1' }, appCapabilities: {} } })
  await flush()
  host.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })
}

describe('McpAppHost', () => {
  it('answers ui/initialize and sends nothing before the page is initialized', async () => {
    const { host, posted } = setup()
    host.setInput({ city: 'Berlin' })
    host.setResult({ content: [{ type: 'text', text: '21 °C' }] })
    expect(posted).toEqual([])

    host.receive({ jsonrpc: '2.0', id: 1, method: 'ui/initialize', params: {} })
    await flush()
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ id: 1, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'Nexa' }, hostContext: { theme: 'dark', locale: 'de-DE' } } })
    expect((posted[0].result as { hostCapabilities: object }).hostCapabilities).not.toHaveProperty('updateModelContext')

    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })
    expect(posted.slice(1)).toEqual([
      { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { city: 'Berlin' } } },
      { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: '21 °C' }] } },
    ])
  })

  it('sends input and result once, as they come', async () => {
    const { host, methods } = setup()
    await initialize(host)
    host.setInput({ a: 1 })
    host.setInput({ a: 2 })
    const result = { content: [] }
    host.setResult(result)
    expect(methods()).toEqual(['#1', 'ui/notifications/tool-input', 'ui/notifications/tool-result'])
  })

  it('sends a cancellation, with an empty input before it if none came', async () => {
    const { host, posted } = setup()
    await initialize(host)
    host.cancel('Abgelehnt')
    expect(posted.slice(1)).toEqual([
      { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } },
      { jsonrpc: '2.0', method: 'ui/notifications/tool-cancelled', params: { reason: 'Abgelehnt' } },
    ])
  })

  it('gives a page that loads again its input and result again', async () => {
    const { host, methods } = setup()
    host.setInput({ a: 1 })
    await initialize(host)
    await initialize(host)
    expect(methods()).toEqual(['#1', 'ui/notifications/tool-input', '#1', 'ui/notifications/tool-input'])
  })

  it('calls tools and reads resources through Nexa', async () => {
    const { host, deps, posted } = setup()
    host.receive({ jsonrpc: '2.0', id: 'c1', method: 'tools/call', params: { name: 'refresh', arguments: { city: 'Köln' } } })
    host.receive({ jsonrpc: '2.0', id: 'r1', method: 'resources/read', params: { uri: 'ui://weather/data' } })
    await flush()
    expect(deps.callTool).toHaveBeenCalledWith('refresh', { city: 'Köln' })
    expect(deps.readResource).toHaveBeenCalledWith('ui://weather/data')
    expect(posted).toEqual([
      { jsonrpc: '2.0', id: 'c1', result: { content: [{ type: 'text', text: 'ok' }] } },
      { jsonrpc: '2.0', id: 'r1', result: { contents: [] } },
    ])
  })

  it('answers a refused call with an error, without Electron’s prefix', async () => {
    const callTool = vi.fn(async () => {
      throw new Error("Error invoking remote method 'mcp-apps:call-tool': Error: Das Werkzeug „x“ ist nicht für die Oberfläche freigegeben.")
    })
    const { host, posted } = setup({ callTool })
    host.receive({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'x' } })
    await flush()
    expect(posted).toEqual([{ jsonrpc: '2.0', id: 7, error: { code: -32000, message: 'Das Werkzeug „x“ ist nicht für die Oberfläche freigegeben.' } }])
  })

  it('opens http(s) links only and hands messages to the composer', async () => {
    const { host, deps, posted } = setup()
    host.receive({ jsonrpc: '2.0', id: 1, method: 'ui/open-link', params: { url: 'https://example.com/a' } })
    host.receive({ jsonrpc: '2.0', id: 2, method: 'ui/open-link', params: { url: 'file:///C:/Windows/system32/calc.exe' } })
    host.receive({ jsonrpc: '2.0', id: 3, method: 'ui/message', params: { role: 'user', content: { type: 'text', text: 'Zeig mir Köln' } } })
    await flush()
    expect(deps.openLink).toHaveBeenCalledExactlyOnceWith('https://example.com/a')
    expect(deps.message).toHaveBeenCalledWith('Zeig mir Köln')
    expect(posted.map((m) => [m.id, 'error' in m ? 'error' : 'ok'])).toEqual([
      [1, 'ok'],
      [2, 'error'],
      [3, 'ok'],
    ])
  })

  it('keeps the page inline, answers ping, refuses what it doesn’t know', async () => {
    const { host, posted } = setup()
    host.receive({ jsonrpc: '2.0', id: 1, method: 'ui/request-display-mode', params: { mode: 'fullscreen' } })
    host.receive({ jsonrpc: '2.0', id: 2, method: 'ping' })
    host.receive({ jsonrpc: '2.0', id: 3, method: 'ui/update-model-context', params: {} })
    await flush()
    expect(posted).toEqual([
      { jsonrpc: '2.0', id: 1, result: { mode: 'inline' } },
      { jsonrpc: '2.0', id: 2, result: {} },
      { jsonrpc: '2.0', id: 3, error: { code: -32601, message: 'Nexa kennt „ui/update-model-context“ nicht.' } },
    ])
  })

  it('takes the page’s height within bounds', () => {
    const { host, deps } = setup()
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 400, height: 5000 } })
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: 'tall' } })
    expect(deps.resize).toHaveBeenCalledExactlyOnceWith(MAX_APP_HEIGHT)
  })

  it('tells an initialized page of a new context, and stops after teardown', async () => {
    const { host, methods, posted } = setup()
    host.contextChanged()
    await initialize(host)
    host.contextChanged()
    host.teardown()
    host.receive({ jsonrpc: '2.0', id: 9, method: 'ping' })
    host.setResult({ content: [] })
    await flush()
    expect(methods()).toEqual(['#1', 'ui/notifications/host-context-changed', 'ui/resource-teardown'])
    expect(posted.at(-1)).toMatchObject({ method: 'ui/resource-teardown', id: 'nexa-1' })
  })

  it('ignores what isn’t JSON-RPC', () => {
    const { host, posted } = setup()
    host.receive('hello')
    host.receive({ id: 1, method: 'ping' })
    host.receive({ jsonrpc: '2.0', id: 1, result: {} })
    expect(posted).toEqual([])
  })
})

describe('helpers', () => {
  it('openableLink', () => {
    expect(openableLink('http://localhost:3000/x')).toBe('http://localhost:3000/x')
    expect(openableLink('javascript:alert(1)')).toBeNull()
    expect(openableLink('nexa-file://image?path=C:/x.png')).toBeNull()
    expect(openableLink('not a url')).toBeNull()
  })

  it('messageText', () => {
    expect(messageText({ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] })).toBe('a\n\nb')
    expect(messageText({ role: 'assistant', content: { type: 'text', text: 'a' } })).toBeNull()
    expect(messageText({ content: { type: 'text', text: '   ' } })).toBeNull()
  })

  it('clampHeight', () => {
    expect(clampHeight(10)).toBe(48)
    expect(clampHeight(300.4)).toBe(301)
    expect(clampHeight(Number.NaN)).toBeNull()
  })
})
