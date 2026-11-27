import { INBOX_SECTIONS, type InboxEntry } from '@shared/inbox'
import type { SessionMeta } from '@shared/types'
import { chatKey } from './session-tree'

/** A chat of the inbox with the device it is on (null: this one). */
export interface InboxRow {
  /** `chatKey`: unique across devices. */
  key: string
  device: string | null
  entry: InboxEntry
}

/**
 * A device's inbox (`sessions:inbox`, shared/inbox.ts) as this window shows it. Without what is put
 * away here: archived, deleted a moment ago (`sessions.hidden`), for another device's chats what this
 * one keeps for itself. With the title as this window knows it. A finished turn only while the sidebar
 * marks it unread too, which the chat on screen is not.
 */
export function inboxRows(
  device: string | null,
  entries: readonly InboxEntry[],
  metaOf: (id: string) => SessionMeta | undefined,
  unread: ReadonlySet<string>,
): InboxRow[] {
  return entries.flatMap((entry) => {
    const meta = metaOf(entry.id)
    if (!meta || meta.archived) return []
    if (entry.section === 'unread' && !unread.has(entry.id)) return []
    return [{ key: chatKey(device, entry.id), device, entry: { ...entry, title: meta.title } }]
  })
}

/** The rows of all devices in one list: by section (what waits first), the newest first in each. */
export function sortInbox(rows: readonly InboxRow[]): InboxRow[] {
  const order = (row: InboxRow) => INBOX_SECTIONS.indexOf(row.entry.section)
  return [...rows].sort((a, b) => order(a) - order(b) || b.entry.updatedAt - a.entry.updatedAt)
}
