import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import type { SessionRuntime } from '@shared/chat'
import { isRemoteChatId, levelAllows, remoteChatId, type RemoteChats, type RemoteEvent, type RemoteHostInfo, type RemoteLevel } from '@shared/remote'
import type { RemoteController } from '@shared/remote-ipc'
import { errorMessage } from '@/lib/errors'
import { useSessionsStore, type SessionChat } from './sessions'

const IDLE: SessionRuntime = { status: 'idle', connected: false }

/** Another device as the page „Geräte“ knows it. */
export interface RemoteHostView {
  info: RemoteHostInfo | null
  chats: RemoteChats | null
  /** Why it can't be shown, for the user. */
  error: string | null
  loading: boolean
}

/** What of a chat's history is here: its items from `start` on, of `total`. */
interface RemotePageState {
  start: number
  total: number
  loadingOlder: boolean
}

/**
 * The page „Geräte“: the chats of another device and the one open of them. Its items live in the
 * sessions store under `remote:<device>:<chat>` (so the chat's components show them); its events come
 * while the page shows it (`watch`). Also the devices that control this one, for the bar about them.
 */
export const useRemoteStore = defineStore('remote', () => {
  const sessions = useSessionsStore()
  const hosts = reactive(new Map<string, RemoteHostView>())
  /** The device the page shows, and its chat open there (the device's own id of it). */
  const device = ref<string | null>(null)
  const chatId = ref<string | null>(null)
  const pages = reactive(new Map<string, RemotePageState>())
  const controllers = ref<RemoteController[]>([])
  /** The page is on screen: only then the devices send events. */
  let showing = false
  let started = false
  const chatsTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const host = computed(() => (device.value ? (hosts.get(device.value) ?? null) : null))
  /** What the shown device lets this one do. */
  const level = computed<RemoteLevel>(() => (host.value?.info?.enabled ? host.value.info.level : 'off'))
  const openId = computed(() => (device.value && chatId.value ? remoteChatId(device.value, chatId.value) : null))
  const openMeta = computed(() => host.value?.chats?.sessions.find((s) => s.id === chatId.value) ?? null)
  const openPage = computed(() => (openId.value ? pages.get(openId.value) : undefined))

  function can(needed: RemoteLevel): boolean {
    return levelAllows(level.value, needed)
  }

  /** Once per window: the events, and who controls this device. */
  function start(): void {
    if (started) return
    started = true
    window.api.remote.onEvents(onEvents)
    window.api.remote.onResync((instance) => {
      if (instance === device.value) void reload()
    })
    window.api.remote.onControllers((list) => (controllers.value = list))
    void window.api.remote
      .controllers()
      .then((list) => (controllers.value = list))
      .catch(() => undefined)
  }

  function viewOf(instance: string): RemoteHostView {
    let view = hosts.get(instance)
    if (!view) {
      hosts.set(instance, { info: null, chats: null, error: null, loading: false })
      view = hosts.get(instance)!
    }
    return view
  }

  /** The page shows (`instance`), or a device was picked on it. */
  async function show(instance: string | null): Promise<void> {
    showing = true
    if (instance !== device.value) {
      device.value = instance
      chatId.value = null
    }
    await reload()
  }

  /** The page is gone: no more events, and the chats' items can go. */
  function hide(): void {
    showing = false
    void window.api.remote.watch([]).catch(() => undefined)
    for (const id of [...sessions.chats.keys()]) {
      if (!isRemoteChatId(id)) continue
      sessions.chats.delete(id)
      pages.delete(id)
    }
  }

  /** The shown device anew: who it is, its chats, and the open one. */
  async function reload(): Promise<void> {
    const instance = device.value
    if (!instance) return void syncWatch()
    const view = viewOf(instance)
    view.loading = true
    view.error = null
    try {
      view.info = await window.api.remote.hello(instance)
      if (!view.info.enabled || !levelAllows(view.info.level, 'read')) {
        view.chats = null
        return void syncWatch()
      }
      // Watched first: what changes from then on comes as events, nothing between gets lost.
      await syncWatch()
      takeChats(instance, await window.api.remote.chats(instance))
      if (chatId.value && device.value === instance) await loadChat(instance, chatId.value)
    } catch (error) {
      view.error = errorMessage(error)
    } finally {
      view.loading = false
    }
  }

  function takeChats(instance: string, chats: RemoteChats): void {
    viewOf(instance).chats = chats
    for (const s of chats.sessions) sessions.runtimes.set(remoteChatId(instance, s.id), chats.runtimes[s.id] ?? IDLE)
  }

  async function openChat(id: string): Promise<void> {
    const instance = device.value
    if (!instance) return
    chatId.value = id
    await syncWatch()
    await loadChat(instance, id)
  }

  function closeChat(): void {
    chatId.value = null
    void syncWatch()
  }

  /** A chat's newest page; until it is here, its events go nowhere (what came before is in the page). */
  async function loadChat(instance: string, id: string): Promise<void> {
    const key = remoteChatId(instance, id)
    const chat = reactive({ items: [], index: new Map(), loaded: false, textShown: 0 }) as SessionChat
    sessions.chats.set(key, chat)
    try {
      const page = await window.api.remote.open(instance, id)
      if (sessions.chats.get(key) !== chat) return
      chat.items = page.items
      chat.index = new Map(page.items.map((item, i) => [item.id, i]))
      sessions.runtimes.set(key, page.runtime)
      pages.set(key, { start: page.start, total: page.total, loadingOlder: false })
      chat.loaded = true
    } catch (error) {
      if (sessions.chats.get(key) === chat) sessions.chats.delete(key)
      throw error
    }
  }

  /** „Ältere laden“: the page before what is here. */
  async function loadOlder(): Promise<void> {
    const instance = device.value
    const id = chatId.value
    const key = openId.value
    const page = key ? pages.get(key) : undefined
    const chat = key ? sessions.chats.get(key) : undefined
    if (!instance || !id || !key || !page || !chat?.loaded || page.start === 0 || page.loadingOlder) return
    page.loadingOlder = true
    try {
      const older = await window.api.remote.open(instance, id, page.start)
      const known = chat.index
      chat.items = [...older.items.filter((item) => !known.has(item.id)), ...chat.items]
      chat.index = new Map(chat.items.map((item, i) => [item.id, i]))
      page.start = older.start
      page.total = older.total
    } finally {
      page.loadingOlder = false
    }
  }

  async function send(text: string): Promise<void> {
    if (!device.value || !chatId.value) return
    await window.api.remote.send(device.value, chatId.value, text)
  }

  /** What the page shows, to the main process: the events of these come. */
  async function syncWatch(): Promise<void> {
    const instance = device.value
    const allowed = instance && showing && hosts.get(instance)?.info?.enabled && levelAllows(hosts.get(instance)!.info!.level, 'read')
    await window.api.remote.watch(allowed ? [{ instance, ids: chatId.value ? [chatId.value] : [] }] : [])
  }

  function onEvents(instance: string, events: RemoteEvent[]): void {
    for (const event of events) {
      if (event.type === 'chats') {
        refreshChats(instance)
        continue
      }
      const key = remoteChatId(instance, event.sessionId)
      // Straight in: as a local chat's, a finished turn would count as unread in the sidebar.
      if (event.type === 'runtime') sessions.runtimes.set(key, event.runtime)
      else sessions.apply({ ...event, sessionId: key })
    }
  }

  /** The list of chats there changed: read anew, once for a burst of changes. */
  function refreshChats(instance: string): void {
    if (chatsTimers.has(instance)) return
    chatsTimers.set(
      instance,
      setTimeout(() => {
        chatsTimers.delete(instance)
        if (instance !== device.value || !showing) return
        window.api.remote
          .chats(instance)
          .then((chats) => takeChats(instance, chats))
          .catch((error) => console.warn('[remote] chats not read', error))
      }, 300),
    )
  }

  async function disconnect(instance: string): Promise<void> {
    await window.api.remote.disconnect(instance)
  }

  return {
    hosts,
    device,
    chatId,
    pages,
    controllers,
    host,
    level,
    openId,
    openMeta,
    openPage,
    can,
    start,
    show,
    hide,
    reload,
    openChat,
    closeChat,
    loadOlder,
    send,
    disconnect,
  }
})
