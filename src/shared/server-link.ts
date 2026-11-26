/**
 * Pairing with a nexa-server and the devices of the namespace, as the window sees them (Einstellungen ›
 * Geräte). The connection and the encryption live in main (`main/server-link`), the protocol in
 * `shared/nexa-server`.
 */

import type { Role } from './nexa-server/protocol'

type Unsubscribe = () => void

/**
 * `unpaired`: no server. `connecting`: logging in. `online`: connected. `offline`: lost, a new attempt
 * follows at `retryAt`. `paused`: disconnected by the user. `stopped`: the server refused this device or
 * another connection of it took over; no new attempt until the user asks (`error` says why).
 */
export type ServerLinkStatus = 'unpaired' | 'connecting' | 'online' | 'offline' | 'paused' | 'stopped'

/** A device of the namespace. */
export interface LinkedDevice {
  id: string
  name: string
  role: Role
  online: boolean
  lastSeen: number | null
  createdAt: number
  /** This device. */
  self: boolean
  /**
   * Has shown it holds the namespace's key. Until it has, Nexa sends it nothing: the server could have
   * put it on the list.
   */
  trusted: boolean
}

export interface ServerLinkState {
  status: ServerLinkStatus
  url: string | null
  namespace: string | null
  /** This device's instance. */
  instance: string | null
  /** This device's name in the namespace. */
  name: string | null
  /** In German, for the user: why it stopped, or why it is no longer paired. */
  error: string | null
  /** Paired, but the keys no longer decrypt (another user account, a new key store): only leaving helps. */
  locked: boolean
  retryAt: number | null
  /** As the server listed them last; while offline the last known list. */
  devices: LinkedDevice[]
  /** The name a device gets unless the user picks one: the computer's. */
  defaultName: string
}

export interface PairInput {
  /** The server's address; ignored with a pairing code, which holds it. */
  url: string
  /** The invite of the server's admin (first device) or the pairing code of a paired device (`nexa1:…`). */
  code: string
  /** This device's name in the namespace. */
  name: string
}

/** A pairing code for another device: shown once, valid until `expiresAt`. */
export interface DeviceInvite {
  code: string
  expiresAt: number
}

export const ServerLinkInvoke = {
  state: 'server-link:state',
  pair: 'server-link:pair',
  invite: 'server-link:invite',
  rename: 'server-link:rename',
  remove: 'server-link:remove',
  unpair: 'server-link:unpair',
  connect: 'server-link:connect',
  disconnect: 'server-link:disconnect',
} as const

export const ServerLinkEvent = {
  changed: 'event:server-link-changed',
} as const

export interface ServerLinkApi {
  state(): Promise<ServerLinkState>
  pair(input: PairInput): Promise<ServerLinkState>
  /** A pairing code for the next device; needs the connection. */
  invite(): Promise<DeviceInvite>
  /** Renames a device of the namespace, this one with `null`. */
  rename(instance: string | null, name: string): Promise<void>
  /** Removes another device; it has to pair again. The others then change the namespace's key. */
  remove(instance: string): Promise<void>
  /** Leaves the namespace: removes this device at the server (if reachable) and forgets keys and server. */
  unpair(): Promise<void>
  connect(): Promise<void>
  disconnect(): Promise<void>
  onChanged(cb: (state: ServerLinkState) => void): Unsubscribe
}
