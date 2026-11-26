import { levelAllows, type RemoteLevel } from '@shared/remote'
import { containsTerms } from '@shared/search'
import type { SessionMeta, SessionSearchHit } from '@shared/types'
import { chatKey } from './session-tree'

/*
 * The chats of every device in one list, for the quick open and the shortcuts (Remote Control): this
 * device's and those of the other devices loaded here, each named by its `chatKey`.
 */

/** A device whose chats are reachable here: this one (`id` null) or another one loaded here. */
export interface ChatSource {
  id: string | null
  /** Another device's name, to mark its chats with. */
  name?: string
  /** What it lets this device do (this one: everything). */
  level: RemoteLevel
  /** Reachable now; one that went offline keeps showing what it had. */
  online: boolean
}

/** What `chatSources` reads of a device (`RemoteDevice` in stores/devices.ts). */
interface DeviceLike {
  id: string
  name: string
  online: boolean
  state: string
  level: RemoteLevel
}

/**
 * This device first, then every other one whose chats show in the sidebar, in its order. `devices`
 * comes without the hidden ones already; one not `ready` has no chats loaded to offer.
 */
export function chatSources(devices: readonly DeviceLike[]): ChatSource[] {
  return [
    { id: null, level: 'full', online: true },
    ...devices
      .filter((d) => d.state === 'ready' && levelAllows(d.level, 'read'))
      .map((d) => ({ id: d.id, name: d.name, level: d.level, online: d.online })),
  ]
}

/**
 * The other devices whose conversations the quick open searches through: those letting this one read,
 * and online, as one gone would only answer when the request times out.
 */
export function searchedDevices(sources: readonly ChatSource[]): string[] {
  return sources.flatMap((s) => (s.id && s.online && levelAllows(s.level, 'read') ? [s.id] : []))
}

/** Whether a new chat can start on the device from here: on another one only with „Prompts senden“. */
export function startsChats(source: ChatSource): boolean {
  return !source.id || levelAllows(source.level, 'prompt')
}

/** A chat of some device with the text its title search runs on (`searchText`). */
export interface ChatEntry {
  key: string
  meta: SessionMeta
  text: string
}

export type ChatMatch<T extends ChatEntry> = T & {
  /** Set when only the conversation matched. */
  hit: SessionSearchHit | null
  /** Title, preview, project or folder matched. */
  named: boolean
}

/**
 * The chats that match `terms` by their text or by a hit in their conversation (`hits`, by `chatKey`):
 * those named before those found in the conversation, archived ones after, each newest first, whichever
 * device they are on.
 */
export function matchChats<T extends ChatEntry>(entries: readonly T[], terms: string[], hits: ReadonlyMap<string, SessionSearchHit>): ChatMatch<T>[] {
  if (terms.length === 0) return []
  const rows: ChatMatch<T>[] = []
  for (const entry of entries) {
    const named = containsTerms(entry.text, terms)
    const hit = hits.get(entry.key) ?? null
    if (named || hit) rows.push({ ...entry, hit: named ? null : hit, named })
  }
  return rows.sort(
    (a, b) =>
      Number(b.named) - Number(a.named) || Number(!!a.meta.archived) - Number(!!b.meta.archived) || b.meta.updatedAt - a.meta.updatedAt,
  )
}

/** The latest chats not archived, of every device, to carry on with before anything is typed. */
export function recentChats<T extends { meta: SessionMeta }>(entries: readonly T[], count: number): T[] {
  return entries
    .filter((e) => !e.meta.archived)
    .sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
    .slice(0, count)
}

/** `current` with what one device's conversations search found, by `chatKey`. */
export function withHits(
  current: ReadonlyMap<string, SessionSearchHit>,
  device: string | null,
  found: readonly SessionSearchHit[],
): Map<string, SessionSearchHit> {
  const next = new Map(current)
  for (const hit of found) next.set(chatKey(device, hit.sessionId), hit)
  return next
}

/** A chat of some device by its `chatKey`, to open it without its sidebar row. */
export interface ChatRef {
  key: string
  device: string | null
  id: string
}

/**
 * The chats in the order the sidebar lists the devices, for the shortcuts while it is hidden: this
 * device's first, then each other one's, the archived ones left out as there.
 */
export function chatRefs(sources: readonly { device: string | null; metas: readonly SessionMeta[] }[]): ChatRef[] {
  return sources.flatMap(({ device, metas }) =>
    metas.filter((m) => !m.archived).map((m) => ({ key: chatKey(device, m.id), device, id: m.id })),
  )
}

/**
 * Where Strg+Umschalt+T starts a new chat: in the project of the chat on screen, on its device; with
 * none, on this device in the project used last (null). `denied` when the chat's device lets this one
 * only read.
 */
export function newChatTarget(
  open: { device: string | null; projectId: string } | null,
  level: (device: string) => RemoteLevel,
): { device: string | null; projectId: string | null } | 'denied' {
  if (!open) return { device: null, projectId: null }
  if (open.device && !levelAllows(level(open.device), 'prompt')) return 'denied'
  return { device: open.device, projectId: open.projectId }
}
