import { homedir } from 'node:os'
import { isPlainObject } from '@shared/utils'
import type { CliBinary } from '../cli-binary'
import { cliEnv } from '../cli-binary'
import { JsonlProcess } from '../jsonl-process'

type Json = Record<string, unknown>

export interface CodexServerRequest {
  id: number | string
  method: string
  params: Json
}

export interface CodexHandlers {
  /** A notification; `threadId` is in the params of most of them. */
  notification(method: string, params: Json): void
  /** A request of the server (approvals, questions): answer with `respond`. */
  request(request: CodexServerRequest): void
  exited(error?: string): void
}

/**
 * Codex's app-server over stdio (`codex app-server --listen stdio://`): JSON-RPC 2.0, one message
 * per line. One process serves every thread of an account; the provider routes notifications by thread.
 * Protocol: docs/PROTOCOLS.md, types: `npm run codex:protocol`.
 */
export class CodexClient {
  private process: JsonlProcess | null = null
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void; method: string }>()
  private ready: Promise<void> | null = null

  constructor(
    private readonly binary: CliBinary,
    private readonly handlers: CodexHandlers,
    private readonly extraArgs: () => string[],
    private readonly env: () => Record<string, string>,
    /** Inherited variables the server must not see (another login than its account's). */
    private readonly unset: readonly string[] = [],
  ) {}

  get alive(): boolean {
    return !!this.process?.alive
  }

  /** Starts the server once and runs the handshake; later calls wait for the same start. */
  start(): Promise<void> {
    if (this.ready && this.process?.alive) return this.ready
    this.ready = this.launch().catch((error) => {
      this.ready = null
      throw error
    })
    return this.ready
  }

  private async launch(): Promise<void> {
    const args = ['app-server', '--listen', 'stdio://', ...this.extraArgs()]
    this.process = new JsonlProcess(this.binary.command(args), {
      cwd: homedir(),
      env: cliEnv(this.env(), this.unset),
      onMessage: (m) => this.onMessage(m),
      onExit: (code, stderr) => {
        for (const [, waiter] of this.pending) waiter.reject(new Error('Der Codex-App-Server wurde beendet.'))
        this.pending.clear()
        this.process = null
        this.ready = null
        this.handlers.exited(code === 0 ? undefined : stderr.split(/\r?\n/).slice(-6).join('\n') || `Codex wurde beendet (Code ${code ?? '?'}).`)
      },
    })
    await this.call('initialize', { clientInfo: { name: 'nexa', title: 'Nexa', version: '0.1.0' }, capabilities: null })
    this.process.write({ jsonrpc: '2.0', method: 'initialized', params: {} })
  }

  async request<T extends Json = Json>(method: string, params: Json): Promise<T> {
    await this.start()
    return (await this.call(method, params)) as T
  }

  private call(method: string, params: Json): Promise<Json> {
    const process = this.process
    if (!process) return Promise.reject(new Error('Der Codex-App-Server läuft nicht.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      try {
        process.write({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error as Error)
      }
    })
  }

  respond(id: number | string, result: Json): void {
    this.process?.write({ jsonrpc: '2.0', id, result })
  }

  respondError(id: number | string, message: string): void {
    this.process?.write({ jsonrpc: '2.0', id, error: { code: -32601, message } })
  }

  private onMessage(raw: unknown): void {
    if (!isPlainObject(raw)) return
    const m = raw
    const hasId = typeof m.id === 'number' || typeof m.id === 'string'
    if (hasId && typeof m.method !== 'string') {
      const waiter = typeof m.id === 'number' ? this.pending.get(m.id) : undefined
      if (!waiter) return
      this.pending.delete(m.id as number)
      if (isPlainObject(m.error)) waiter.reject(new Error(typeof m.error.message === 'string' ? m.error.message : `${waiter.method} ist fehlgeschlagen.`))
      else waiter.resolve(isPlainObject(m.result) ? m.result : {})
      return
    }
    if (typeof m.method !== 'string') return
    const params = isPlainObject(m.params) ? m.params : {}
    if (hasId) this.handlers.request({ id: m.id as number | string, method: m.method, params })
    else this.handlers.notification(m.method, params)
  }

  async stop(): Promise<void> {
    await this.process?.stop(2000)
    this.process = null
    this.ready = null
  }
}
