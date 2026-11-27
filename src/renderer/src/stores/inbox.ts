import { defineStore } from 'pinia'
import { computed, shallowReactive, watch } from 'vue'
import { INBOX_SECTIONS, type InboxEntry } from '@shared/inbox'
import { inboxRows, sortInbox, type InboxRow } from '@/lib/inbox'
import { apiOf } from './device'
import { useDevicesStore } from './devices'
import { useSessionsStore } from './sessions'

/** After a change, a moment for what comes with it: a turn that ends changes its item, runtime and list. */
const REFRESH_MS = 150

/**
 * The inbox: the chats of this device and of every other one loaded here that need the user, as the
 * phone's PWA shows them. Each device says what is in it (`sessions:inbox`, shared/inbox.ts, with the
 * questions a chat waits on); it is asked again when one of its chats changes, as the PWA does.
 */
export const useInboxStore = defineStore('inbox', () => {
  const devices = useDevicesStore()
  /** What each device said last, by device ('' this one). */
  const lists = shallowReactive(new Map<string, InboxEntry[]>())
  const followed = new Map<string, () => void>()

  const sources = computed(() => [null, ...devices.devices.filter((d) => d.state === 'ready').map((d) => d.id)])

  function follow(device: string | null): () => void {
    const key = device ?? ''
    const sessions = useSessionsStore(device)
    const api = apiOf(device)
    let timer: ReturnType<typeof setTimeout> | null = null
    let asked = 0

    async function refresh(): Promise<void> {
      const mine = ++asked
      try {
        const list = await api.sessions.inbox()
        // Only the latest answer counts, and none for a device let go meanwhile.
        if (mine === asked && followed.has(key)) lists.set(key, list)
      } catch (error) {
        console.warn('[inbox]', error)
      }
    }
    function soon(): void {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void refresh()
      }, REFRESH_MS)
    }

    const stops = [
      watch(() => sessions.metas, soon),
      // What decides the section; the context filling up, the model and the like don't.
      watch(() => [...sessions.runtimes].map(([id, r]) => `${id}:${r.status}:${r.error ?? ''}:${r.resume?.at ?? ''}`).join('\n'), soon),
      // A question that comes or is answered while its chat waits anyway changes no runtime.
      api.sessions.onEvent((event) => {
        if (event.type === 'item' && event.item.kind === 'interaction') soon()
      }),
    ]
    void refresh()
    return () => {
      for (const stop of stops) stop()
      if (timer) clearTimeout(timer)
    }
  }

  watch(
    sources,
    (list) => {
      const keys = new Set(list.map((device) => device ?? ''))
      for (const [key, stop] of followed) {
        if (keys.has(key)) continue
        stop()
        followed.delete(key)
        lists.delete(key)
      }
      for (const device of list) if (!followed.has(device ?? '')) followed.set(device ?? '', follow(device))
    },
    { immediate: true },
  )

  const rows = computed<InboxRow[]>(() =>
    sortInbox(
      sources.value.flatMap((device) => {
        const sessions = useSessionsStore(device)
        return inboxRows(device, lists.get(device ?? '') ?? [], sessions.get, sessions.unread)
      }),
    ),
  )
  const sections = computed(() =>
    INBOX_SECTIONS.map((id) => ({ id, rows: rows.value.filter((r) => r.entry.section === id) })).filter((s) => s.rows.length),
  )
  /** What wants the user: all but the chats that only work. */
  const attention = computed(() => rows.value.filter((r) => r.entry.section !== 'running').length)
  const waiting = computed(() => rows.value.some((r) => r.entry.section === 'waiting'))
  /** This device answered once. */
  const loaded = computed(() => lists.has(''))

  return { rows, sections, attention, waiting, loaded }
})
