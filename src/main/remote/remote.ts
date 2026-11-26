import { RemoteKind } from '@shared/remote'
import type { ServerLinkService } from '../server-link/server-link-service'
import { RemoteClient } from './remote-client'
import { RemoteHost, type RemoteHostDeps } from './remote-host'

/** What Remote Control needs of the server link (tests hand in the real one, with a fake server). */
export type RemoteLink = Pick<
  ServerLinkService,
  'on' | 'sendToDevice' | 'self' | 'device' | 'remoteLevel' | 'remoteEnabled' | 'setRemoteLevel' | 'getState' | 'limits'
>

export interface RemoteDeps {
  link: RemoteLink
  /** A call of the window API by the device `from`, answered by the windows' own handlers (`invokeHandler` of main/ipc.ts). */
  invoke(channel: string, args: unknown[], from: string): Promise<unknown>
  /** The window events as they go out (`onBroadcast` of main/ipc.ts). */
  onBroadcast(listener: (channel: string, args: unknown[]) => void): () => void
  /** Requests of other devices' chat tools (`chats.*`, `RemoteChatsHost`). */
  chats?: RemoteHostDeps['chats']
  version: string
  log?: (message: string) => void
}

export interface Remote {
  host: RemoteHost
  client: RemoteClient
  dispose(): void
}

/**
 * Remote Control in both directions: this device as host of the others (`RemoteHost`) and as their
 * controller (`RemoteClient`), each fed what the server link and the windows' events report.
 */
export function createRemote(deps: RemoteDeps): Remote {
  const { link } = deps
  const host = new RemoteHost({
    link: {
      sendToDevice: (to, kind, data) => link.sendToDevice(to, kind, data),
      selfName: () => link.self()?.name ?? '',
      deviceName: (id) => link.device(id)?.name ?? null,
      level: (id) => link.remoteLevel(id),
      enabled: () => link.remoteEnabled(),
      revoke: (id) => link.setRemoteLevel(id, 'off'),
      limits: () => link.limits(),
    },
    invoke: deps.invoke,
    chats: deps.chats,
    version: deps.version,
    log: deps.log,
  })
  const client = new RemoteClient({
    link: { sendToDevice: (to, kind, data) => link.sendToDevice(to, kind, data), online: () => link.getState().status === 'online' },
    log: deps.log,
  })

  const offs = [
    link.on('deviceMessage', (from, kind, id, data) => {
      if (kind === RemoteKind.request) {
        void host.onDeviceMessage(from, kind, id, data).catch((error: unknown) => deps.log?.(`remote: no answer sent: ${String(error)}`))
      } else {
        client.onDeviceMessage(from, kind, data)
      }
    }),
    link.on('deviceSendFailed', (id, code) => {
      client.onSendFailed(id, code)
      host.onSendFailed(id)
    }),
    link.on('deviceStatus', (id, online) => {
      host.onDeviceStatus(id, online)
      client.onDeviceStatus(id, online)
    }),
    link.on('connected', () => client.onConnected()),
    link.on('remoteChanged', () => host.onRemoteChanged()),
    deps.onBroadcast((channel, args) => host.onBroadcast(channel, args)),
  ]

  return {
    host,
    client,
    dispose() {
      for (const off of offs) off()
      host.dispose()
      client.dispose()
    },
  }
}
