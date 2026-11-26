/**
 * Remote Control as the window sees it: the chats of other devices (page „Geräte“) and the devices that
 * control this one. The protocol between the devices is in `shared/remote.ts`; main speaks it
 * (`main/remote`), the window only asks.
 */

import type { InteractionResponse } from './chat'
import type { RemoteChats, RemoteEvent, RemoteHostInfo, RemoteLevel, RemotePage } from './remote'

type Unsubscribe = () => void

/** A device that watches chats here now (the bar „… ist per Fernsteuerung verbunden“). */
export interface RemoteController {
  id: string
  name: string
  since: number
  level: RemoteLevel
}

/** The chats of one device this window wants the events of; an empty list: only the state of its chats. */
export interface RemoteWatch {
  instance: string
  ids: string[]
}

export const RemoteInvoke = {
  hello: 'remote:hello',
  chats: 'remote:chats',
  open: 'remote:open',
  watch: 'remote:watch',
  send: 'remote:send',
  interrupt: 'remote:interrupt',
  respond: 'remote:respond',
  controllers: 'remote:controllers',
  disconnect: 'remote:disconnect',
} as const

export const RemoteIpcEvent = {
  /** Events of chats of another device: `(instance, events)`. */
  events: 'event:remote-events',
  /** A device lost what this one watched there (it restarted, the watch ran out): read its chats anew. */
  resync: 'event:remote-resync',
  controllers: 'event:remote-controllers',
} as const

/** Errors come as the German text for the user (`remoteErrorText`). */
export interface RemoteApi {
  hello(instance: string): Promise<RemoteHostInfo>
  chats(instance: string): Promise<RemoteChats>
  /** The newest items of a chat there, or those before `before` („Ältere laden“). */
  open(instance: string, sessionId: string, before?: number): Promise<RemotePage>
  /** What this window shows of other devices; replaces its last list. Events of these come by `onEvents`. */
  watch(list: RemoteWatch[]): Promise<void>
  send(instance: string, sessionId: string, text: string): Promise<void>
  interrupt(instance: string, sessionId: string): Promise<void>
  respond(instance: string, sessionId: string, itemId: string, response: InteractionResponse): Promise<void>
  /** The devices that watch chats here now. */
  controllers(): Promise<RemoteController[]>
  /** „Trennen“: the device may do nothing here any more until its level is raised again. */
  disconnect(instance: string): Promise<void>
  onEvents(cb: (instance: string, events: RemoteEvent[]) => void): Unsubscribe
  onResync(cb: (instance: string) => void): Unsubscribe
  onControllers(cb: (controllers: RemoteController[]) => void): Unsubscribe
}
