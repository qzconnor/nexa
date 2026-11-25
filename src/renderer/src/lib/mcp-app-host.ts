import { MCP_APP_PROTOCOL, type McpAppToolResult } from '@shared/mcp-apps'
import type { ThemeColors } from '@shared/themes/types'
import { isPlainObject } from '@shared/utils'
import { errorMessage } from './errors'

/**
 * Nexa as the host of an MCP App page (spec 2026-01-26, „Host ↔ View“): JSON-RPC 2.0 over
 * `postMessage`. The page asks `ui/initialize`, says `ui/notifications/initialized`, and only then
 * gets the tool's input and result; what it asks of its server goes through the chat's CLI. Kept free
 * of the DOM so it can be tested; McpAppBlock.vue wires it to the frame.
 */

/** How large a page may grow in the chat; it scrolls beyond. */
export const MAX_APP_HEIGHT = 720
export const MIN_APP_HEIGHT = 48
const MAX_MESSAGE_TEXT = 20_000

export interface McpAppHostContext {
  theme: 'light' | 'dark'
  styles: { variables: Record<string, string> }
  displayMode: 'inline'
  availableDisplayModes: ['inline']
  containerDimensions: { maxHeight: number; width?: number }
  locale: string
  timeZone: string
  platform: 'desktop'
  userAgent: string
  deviceCapabilities: { touch: boolean; hover: boolean }
  toolInfo?: { tool: { name: string } }
}

export interface McpAppHostDeps {
  /** To the page's window. */
  post(message: unknown): void
  callTool(name: string, args: Record<string, unknown>): Promise<McpAppToolResult>
  readResource(uri: string): Promise<unknown>
  /** An http(s) link the page asked to open, in the user's browser. */
  openLink(url: string): void
  /** Text the page wants to send to the agent: the composer gets it, the user sends it. */
  message(text: string): void
  /** The height the page needs for its content. */
  resize(height: number): void
  context(): McpAppHostContext
  version: string
}

type Id = string | number

/** JSON-RPC errors: the spec's codes. */
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const SERVER_ERROR = -32000

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

/** A link a page may open: http(s) only, no `javascript:`, `file:` or the app's own schemes. */
export function openableLink(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

/** The text of a `ui/message`: its text blocks, as one, within reason. */
export function messageText(params: unknown): string | null {
  const p = isPlainObject(params) ? params : {}
  if (p.role !== undefined && p.role !== 'user') return null
  const blocks = Array.isArray(p.content) ? p.content : [p.content]
  const text = blocks
    .filter(isPlainObject)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n\n')
    .trim()
  return text ? text.slice(0, MAX_MESSAGE_TEXT) : null
}

/** The height a page asked for, within bounds; rounded up, as a fraction of a pixel too few gives the frame a scroll bar. */
export function clampHeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.ceil(Math.min(MAX_APP_HEIGHT, Math.max(MIN_APP_HEIGHT, value)))
}

export class McpAppHost {
  private initialized = false
  private input: Record<string, unknown> | null = null
  private inputSent = false
  /** The result or cancellation to send, and the one sent, so a repeated update doesn't send it twice. */
  private outcome: { method: string; params: unknown } | null = null
  private outcomeSent: { method: string; params: unknown } | null = null
  private nextId = 1
  private closed = false

  constructor(private readonly deps: McpAppHostDeps) {}

  /** The tool's arguments, as soon as they are known; the page gets them once. */
  setInput(input: unknown): void {
    if (this.input || !isPlainObject(input)) return
    this.input = input
    this.flush()
  }

  setResult(result: McpAppToolResult): void {
    this.outcome = { method: 'ui/notifications/tool-result', params: result }
    this.flush()
  }

  /** The call ended without a result (denied, interrupted). */
  cancel(reason: string): void {
    this.outcome = { method: 'ui/notifications/tool-cancelled', params: { reason } }
    this.flush()
  }

  /** Theme, size or the like changed: an initialized page hears of it. */
  contextChanged(): void {
    if (this.initialized && !this.closed) this.notify('ui/notifications/host-context-changed', this.deps.context())
  }

  /**
   * The frame goes away: the page hears so (`ui/resource-teardown`), though it may not get to answer
   * before the frame is gone; after this, nothing more is sent or done for it.
   */
  teardown(): void {
    if (this.closed) return
    if (this.initialized) this.deps.post({ jsonrpc: '2.0', id: `nexa-${this.nextId++}`, method: 'ui/resource-teardown', params: {} })
    this.closed = true
  }

  /** A message from the page's window. */
  receive(data: unknown): void {
    if (this.closed || !isPlainObject(data) || data.jsonrpc !== '2.0') return
    const method = typeof data.method === 'string' ? data.method : null
    const id = typeof data.id === 'string' || typeof data.id === 'number' ? data.id : null
    // Answers to Nexa's own requests (teardown) need nothing.
    if (!method) return
    if (id === null) return this.notification(method, data.params)
    void this.request(id, method, data.params)
  }

  private notification(method: string, params: unknown): void {
    const p = isPlainObject(params) ? params : {}
    if (method === 'ui/notifications/initialized') {
      this.initialized = true
      this.flush()
    } else if (method === 'ui/notifications/size-changed') {
      const height = clampHeight(p.height)
      if (height !== null) this.deps.resize(height)
    }
    // `notifications/message` (the page's log) and anything else: nothing for the user to see.
  }

  private async request(id: Id, method: string, params: unknown): Promise<void> {
    try {
      const result = await this.handle(method, isPlainObject(params) ? params : {})
      if (!this.closed) this.deps.post({ jsonrpc: '2.0', id, result })
    } catch (error) {
      if (this.closed) return
      const code = error instanceof RpcError ? error.code : SERVER_ERROR
      this.deps.post({ jsonrpc: '2.0', id, error: { code, message: errorMessage(error) } })
    }
  }

  private async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'ui/initialize':
        // The page loaded (again, if it reloaded itself): it gets the input and result anew once initialized.
        this.initialized = false
        this.inputSent = false
        this.outcomeSent = null
        return {
          protocolVersion: MCP_APP_PROTOCOL,
          hostInfo: { name: 'Nexa', version: this.deps.version },
          // No `updateModelContext`: the CLIs take no context from Nexa between turns.
          hostCapabilities: { openLinks: {}, serverTools: {}, serverResources: {}, logging: {}, message: { text: {} } },
          hostContext: this.deps.context(),
        }
      case 'ping':
        return {}
      case 'tools/call': {
        if (typeof params.name !== 'string' || !params.name) throw new RpcError(INVALID_PARAMS, 'Werkzeugname fehlt.')
        return this.deps.callTool(params.name, isPlainObject(params.arguments) ? params.arguments : {})
      }
      case 'resources/read': {
        if (typeof params.uri !== 'string' || !params.uri) throw new RpcError(INVALID_PARAMS, 'Adresse fehlt.')
        return this.deps.readResource(params.uri)
      }
      case 'ui/open-link': {
        const url = openableLink(params.url)
        if (!url) throw new RpcError(INVALID_PARAMS, 'Nur Links mit http oder https lassen sich öffnen.')
        this.deps.openLink(url)
        return {}
      }
      case 'ui/message': {
        const text = messageText(params)
        if (!text) throw new RpcError(INVALID_PARAMS, 'Die Nachricht hat keinen Text.')
        this.deps.message(text)
        return {}
      }
      case 'ui/request-display-mode':
        // The chat shows pages inline only; the answer is the mode the page has.
        return { mode: 'inline' }
      default:
        throw new RpcError(METHOD_NOT_FOUND, `Nexa kennt „${method}“ nicht.`)
    }
  }

  /** What the page is owed once it is initialized: the input first, then the result. */
  private flush(): void {
    if (!this.initialized || this.closed) return
    if (this.input && !this.inputSent) {
      this.inputSent = true
      this.notify('ui/notifications/tool-input', { arguments: this.input })
    }
    if (this.outcome && this.outcome !== this.outcomeSent) {
      // A result without the input before it would leave the page guessing what it is about.
      if (!this.inputSent) {
        this.inputSent = true
        this.notify('ui/notifications/tool-input', { arguments: {} })
      }
      this.outcomeSent = this.outcome
      this.notify(this.outcome.method, this.outcome.params)
    }
  }

  private notify(method: string, params: unknown): void {
    this.deps.post({ jsonrpc: '2.0', method, params })
  }
}

/** The spec's style variables (`hostContext.styles.variables`) from the theme, so a page can look like the app. */
export function appStyleVariables(colors: ThemeColors, fonts: { sans: string; mono: string }): Record<string, string> {
  const tint = (color: string, percent: number) => `color-mix(in srgb, ${color} ${percent}%, transparent)`
  return {
    '--color-background-primary': colors.background,
    '--color-background-secondary': colors.surface,
    '--color-background-tertiary': colors.popover,
    '--color-background-inverse': colors.foreground,
    '--color-background-danger': tint(colors.destructive, 14),
    '--color-text-primary': colors.foreground,
    '--color-text-secondary': colors.mutedForeground,
    '--color-text-inverse': colors.background,
    '--color-text-info': colors.primary,
    '--color-text-danger': colors.destructive,
    '--color-text-success': colors.success,
    '--color-text-warning': colors.warning,
    '--color-border-primary': tint(colors.foreground, 16),
    '--color-border-secondary': tint(colors.foreground, 10),
    '--color-ring-primary': colors.primary,
    '--font-sans': fonts.sans,
    '--font-mono': fonts.mono,
    '--border-radius-md': '8px',
  }
}
