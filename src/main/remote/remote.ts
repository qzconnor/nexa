import { RemoteKind } from '@shared/remote'
import type { Project, ProjectSection } from '@shared/types'
import type { ServerLinkService } from '../server-link/server-link-service'
import type { SessionService } from '../services/session-service'
import { RemoteClient } from './remote-client'
import { RemoteHost } from './remote-host'

/** What Remote Control needs of the server link and of the chats (tests hand in fakes of these). */
export type RemoteLink = Pick<
  ServerLinkService,
  'on' | 'sendToDevice' | 'self' | 'device' | 'remoteLevel' | 'remoteEnabled' | 'setRemoteLevel' | 'getState' | 'limits'
>
export type RemoteSessions = Pick<SessionService, 'on' | 'list' | 'open' | 'send' | 'interrupt' | 'respond' | 'activeRuntimes'>

export interface RemoteDeps {
  link: RemoteLink
  sessions: RemoteSessions
  projects: { list(): Project[]; sections(): ProjectSection[] }
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
 * controller (`RemoteClient`), each fed what the server link and the chats report.
 */
export function createRemote(deps: RemoteDeps): Remote {
  const { link, sessions, projects } = deps
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
    sessions: {
      list: () => sessions.list(),
      open: (id) => sessions.open(id),
      send: (id, prompt) => sessions.send(id, { text: prompt }),
      interrupt: (id) => sessions.interrupt(id),
      respond: (id, itemId, response) => sessions.respond(id, itemId, response),
      runtimes: () => sessions.activeRuntimes(),
    },
    projects: () => ({ projects: projects.list(), sections: projects.sections() }),
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
    sessions.on('event', (event) => host.onSessionEvent(event)),
    sessions.on('changed', () => host.onSessionsChanged()),
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
