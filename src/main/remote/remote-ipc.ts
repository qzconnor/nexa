import { parseInteractionResponse } from '@shared/remote'
import { RemoteInvoke, RemoteIpcEvent, type RemoteWatch } from '@shared/remote-ipc'
import { broadcast, handle } from '../ipc'
import { perWindow } from '../lib/per-window'
import { createRemote, type RemoteDeps } from './remote'

function text(value: unknown, name: string, max = 128): string {
  if (typeof value !== 'string' || !value || value.length > max) throw new Error(`Ungültiger Parameter: ${name}`)
  return value
}

function watchList(value: unknown): RemoteWatch[] {
  if (!Array.isArray(value) || value.length > 16) throw new Error('Ungültiger Parameter: list')
  return value.map((entry: unknown) => {
    const { instance, ids } = (entry ?? {}) as Record<string, unknown>
    if (!Array.isArray(ids) || ids.length > 32) throw new Error('Ungültiger Parameter: ids')
    return { instance: text(instance, 'instance', 64), ids: ids.map((id) => text(id, 'id')) }
  })
}

/** Remote Control (`createRemote`) with the window's side: the chats of other devices, who controls this one. */
export function registerRemote(deps: RemoteDeps): { dispose(): void } {
  const remote = createRemote(deps)
  const { host, client } = remote
  const offs = [
    host.on('changed', (controllers) => broadcast(RemoteIpcEvent.controllers, controllers)),
    client.on('events', (instance, events) => broadcast(RemoteIpcEvent.events, instance, events)),
    client.on('resync', (instance) => broadcast(RemoteIpcEvent.resync, instance)),
  ]

  const watch = perWindow<RemoteWatch, void>((all) => client.setWatch(all))
  handle(RemoteInvoke.hello, (_e, instance: unknown) => client.request(text(instance, 'instance', 64), 'hello', {}))
  handle(RemoteInvoke.chats, (_e, instance: unknown) => client.request(text(instance, 'instance', 64), 'chats', {}))
  handle(RemoteInvoke.open, (_e, instance: unknown, id: unknown, before: unknown) => {
    if (before !== undefined && !(Number.isInteger(before) && (before as number) >= 0)) throw new Error('Ungültiger Parameter: before')
    return client.request(text(instance, 'instance', 64), 'open', before === undefined ? { id: text(id, 'id') } : { id: text(id, 'id'), before: before as number })
  })
  handle(RemoteInvoke.watch, (e, list: unknown) => watch(e.sender, watchList(list)))
  handle(RemoteInvoke.send, (_e, instance: unknown, id: unknown, prompt: unknown) =>
    client.request(text(instance, 'instance', 64), 'send', { id: text(id, 'id'), text: text(prompt, 'text', 200_000) }),
  )
  handle(RemoteInvoke.interrupt, (_e, instance: unknown, id: unknown) => client.request(text(instance, 'instance', 64), 'interrupt', { id: text(id, 'id') }))
  handle(RemoteInvoke.respond, (_e, instance: unknown, id: unknown, itemId: unknown, response: unknown) => {
    const parsed = parseInteractionResponse(response)
    if (!parsed) throw new Error('Ungültiger Parameter: response')
    return client.request(text(instance, 'instance', 64), 'respond', { id: text(id, 'id'), itemId: text(itemId, 'itemId', 256), response: parsed })
  })
  handle(RemoteInvoke.controllers, () => host.controllers())
  handle(RemoteInvoke.disconnect, (_e, instance: unknown) => host.disconnect(text(instance, 'instance', 64)))

  return {
    dispose() {
      for (const off of offs) off()
      remote.dispose()
    },
  }
}
