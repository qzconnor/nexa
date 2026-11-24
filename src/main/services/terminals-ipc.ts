import { TerminalsEvent, TerminalsInvoke, type TerminalSize } from '@shared/terminals'
import { broadcast, handle } from '../ipc'
import type { Terminals } from './terminals'

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${what} fehlt.`)
  return value
}

function size(value: unknown): TerminalSize {
  const { cols, rows } = (value ?? {}) as Partial<TerminalSize>
  return { cols: Number(cols), rows: Number(rows) }
}

/**
 * The window's side of the user's terminals. The window names a chat, never a folder or a program:
 * where a terminal starts and with which shell comes from Nexa itself.
 */
export function registerTerminalsIpc(terminals: Terminals): void {
  handle(TerminalsInvoke.list, () => terminals.list())
  handle(TerminalsInvoke.create, (_e, sessionId: unknown, value: unknown) => terminals.create(str(sessionId, 'Der Chat'), size(value)))
  handle(TerminalsInvoke.buffer, (_e, id: unknown) => terminals.buffer(str(id, 'Das Terminal')))
  handle(TerminalsInvoke.write, (_e, id: unknown, data: unknown) => terminals.write(str(id, 'Das Terminal'), typeof data === 'string' ? data : ''))
  handle(TerminalsInvoke.resize, (_e, id: unknown, value: unknown) => terminals.resize(str(id, 'Das Terminal'), size(value)))
  handle(TerminalsInvoke.kill, (_e, id: unknown) => terminals.kill(str(id, 'Das Terminal')))
  terminals.on('data', (id, data, end) => broadcast(TerminalsEvent.data, id, data, end))
  terminals.on('changed', (list) => broadcast(TerminalsEvent.changed, list))
}
