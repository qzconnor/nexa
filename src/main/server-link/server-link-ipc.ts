import { ServerLinkEvent, ServerLinkInvoke, type PairInput } from '@shared/server-link'
import { broadcast, handle } from '../ipc'
import type { ServerLinkService } from './server-link-service'

function text(value: unknown, name: string, max = 4096): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Ungültiger Parameter: ${name}`)
  return value
}

function pairInput(value: unknown): PairInput {
  if (typeof value !== 'object' || value === null) throw new Error('Ungültiger Parameter: input')
  const { url, code, name } = value as Record<string, unknown>
  return { url: text(url, 'url', 2048), code: text(code, 'code'), name: text(name, 'name', 256) }
}

/** The window's side of the pairing with nexa-server (Einstellungen › Geräte). */
export function registerServerLinkIpc(link: ServerLinkService): void {
  handle(ServerLinkInvoke.state, () => link.getState())
  handle(ServerLinkInvoke.pair, (_e, input: unknown) => link.pair(pairInput(input)))
  handle(ServerLinkInvoke.invite, () => link.invite())
  handle(ServerLinkInvoke.rename, (_e, instance: unknown, name: unknown) =>
    link.rename(instance === null ? null : text(instance, 'instance', 64), text(name, 'name', 256)),
  )
  handle(ServerLinkInvoke.remove, (_e, instance: unknown) => link.remove(text(instance, 'instance', 64)))
  handle(ServerLinkInvoke.unpair, () => link.unpair())
  handle(ServerLinkInvoke.connect, () => link.connect())
  handle(ServerLinkInvoke.disconnect, () => link.disconnect())
  link.on('changed', (state) => broadcast(ServerLinkEvent.changed, state))
}
