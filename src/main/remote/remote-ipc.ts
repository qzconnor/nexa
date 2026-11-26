import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { IpcInvoke } from '@shared/ipc'
import { channelLevel } from '@shared/remote'
import { RemoteInvoke, RemoteIpcEvent, type RemoteWatch } from '@shared/remote-ipc'
import { broadcast, handle, invokeHandler, onBroadcast } from '../ipc'
import { endRemoteSender, perWindow } from '../lib/per-window'
import { createRemote, type RemoteDeps, type RemoteLink } from './remote'
import type { RemoteClient } from './remote-client'

const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

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

export interface RegisterRemoteDeps {
  link: RemoteLink
  version: string
  log?: (message: string) => void
  /** Requests of other devices' chat tools (`chats.*`, `RemoteChatsHost`). */
  chats?: RemoteDeps['chats']
}

/**
 * Remote Control (`createRemote`) with the window's side: the window API of other devices, their
 * events, who controls this one. The host's side answers with the windows' own handlers. `client`
 * also carries the chat tools' requests to the other devices (`DeviceChats`).
 */
export function registerRemote(deps: RegisterRemoteDeps): { client: RemoteClient; dispose(): void } {
  const remote = createRemote({ ...deps, invoke: invokeHandler, onBroadcast })
  const { host, client } = remote
  const offs = [
    host.on('changed', (controllers) => broadcast(RemoteIpcEvent.controllers, controllers)),
    // The folders a device's file panel watched here, as a window of its own, go with its watch.
    host.on('dropped', (device) => endRemoteSender(device)),
    client.on('events', (instance, events) => broadcast(RemoteIpcEvent.events, instance, events)),
    client.on('resync', (instance) => broadcast(RemoteIpcEvent.resync, instance)),
    client.on('info', (instance, info) => broadcast(RemoteIpcEvent.info, instance, info)),
  ]

  const watch = perWindow<RemoteWatch, void>((all) => client.setWatch(all))
  handle(RemoteInvoke.hello, (_e, instance: unknown) => client.request(text(instance, 'instance', 64), 'hello', {}))
  handle(RemoteInvoke.invoke, (_e, instance: unknown, channel: unknown, args: unknown) => {
    const ch = text(channel, 'channel', 96)
    if (!Array.isArray(args)) throw new Error('Ungültiger Parameter: args')
    // What the host would refuse anyway doesn't go out.
    if (channelLevel(ch, args) === null) throw new Error(`${ch} geht nicht über die Fernsteuerung.`)
    return client.invoke(text(instance, 'instance', 64), ch, args)
  })
  handle(RemoteInvoke.watch, (e, list: unknown) => watch(e.sender, watchList(list)))
  handle(RemoteInvoke.uploadImage, async (_e, instance: unknown, path: unknown) => {
    const file = text(path, 'path', 4096)
    const mime = IMAGE_MIME[extname(file).toLowerCase()]
    if (!isAbsolute(file) || !mime) throw new Error('Nur Bilder (PNG, JPEG, GIF, WebP) gehen.')
    if ((await stat(file)).size > MAX_IMAGE_BYTES) throw new Error('Das Bild ist zu groß (höchstens 20 MB).')
    const data = (await readFile(file)).toString('base64')
    return client.invoke(text(instance, 'instance', 64), IpcInvoke.appSaveImage, [data, mime])
  })
  handle(RemoteInvoke.controllers, () => host.controllers())
  handle(RemoteInvoke.disconnect, (_e, instance: unknown) => host.disconnect(text(instance, 'instance', 64)))

  return {
    client,
    dispose() {
      for (const off of offs) off()
      remote.dispose()
    },
  }
}
