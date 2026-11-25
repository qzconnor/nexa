import { isPlainObject } from '@shared/utils'
import type { ResolvedCommand } from '../cli-binary'
import { JsonlProcess } from '../jsonl-process'
import { errorText } from './gemini-items'

type Json = Record<string, unknown>

/** An error answer of the agent, with ACP's code (`-32000`: authentication required). */
export class AcpError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message)
  }
}

export interface AcpHandlers {
  notification(method: string, params: Json): void
  /** A request of the agent (permissions): answered with `respond`. */
  request(id: number | string, method: string, params: Json): void
  exited(code: number | null, stderr: string): void
}

/**
 * The client side of the Agent Client Protocol over a CLI's stdio: JSON-RPC 2.0, one message per
 * line (Gemini CLI `--acp`). One process per conversation.
 */
export class AcpConnection {
  private readonly process: JsonlProcess
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: Json) => void; reject: (error: Error) => void; method: string }>()

  constructor(command: ResolvedCommand, options: { cwd: string; env: Record<string, string> }, private readonly handlers: AcpHandlers) {
    this.process = new JsonlProcess(command, {
      cwd: options.cwd,
      env: options.env,
      onMessage: (m) => this.onMessage(m),
      onExit: (code, stderr) => {
        for (const [, waiter] of this.pending) waiter.reject(new AcpError('Gemini CLI wurde beendet.', null))
        this.pending.clear()
        handlers.exited(code, stderr)
      },
    })
  }

  get alive(): boolean {
    return this.process.alive
  }

  get pid(): number | undefined {
    return this.process.pid
  }

  request<T extends Json = Json>(method: string, params: Json): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: Json) => void, reject, method })
      try {
        this.process.write({ jsonrpc: '2.0', id, method, params })
      } catch (error) {
        this.pending.delete(id)
        reject(error as Error)
      }
    })
  }

  notify(method: string, params: Json): void {
    if (this.process.alive) this.process.write({ jsonrpc: '2.0', method, params })
  }

  respond(id: number | string, result: Json): void {
    if (this.process.alive) this.process.write({ jsonrpc: '2.0', id, result })
  }

  respondError(id: number | string, message: string): void {
    if (this.process.alive) this.process.write({ jsonrpc: '2.0', id, error: { code: -32601, message } })
  }

  stop(graceMs = 3000): Promise<void> {
    return this.process.stop(graceMs)
  }

  private onMessage(raw: unknown): void {
    if (!isPlainObject(raw)) return
    const hasId = typeof raw.id === 'number' || typeof raw.id === 'string'
    if (hasId && typeof raw.method !== 'string') {
      const waiter = typeof raw.id === 'number' ? this.pending.get(raw.id) : undefined
      if (!waiter) return
      this.pending.delete(raw.id as number)
      if (isPlainObject(raw.error)) waiter.reject(acpError(raw.error, waiter.method))
      else waiter.resolve(isPlainObject(raw.result) ? raw.result : {})
      return
    }
    if (typeof raw.method !== 'string') return
    const params = isPlainObject(raw.params) ? raw.params : {}
    if (hasId) this.handlers.request(raw.id as number | string, raw.method, params)
    else this.handlers.notification(raw.method, params)
  }
}

/** An error answer in words: ACP's generic „Internal error“ keeps the reason in `data.details`. */
export function acpError(error: Json, method: string): AcpError {
  const data = isPlainObject(error.data) ? error.data : {}
  const message = typeof data.details === 'string' && data.details.trim() ? data.details : typeof error.message === 'string' ? error.message : `${method} ist fehlgeschlagen.`
  return new AcpError(errorText(message), typeof error.code === 'number' ? error.code : null)
}
