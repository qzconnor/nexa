import { computed, reactive, ref, shallowReactive } from 'vue'
import type { ChatItem, InteractionResponse, SessionEvent, SessionRuntime } from '@shared/chat'
import type { SendInput, SessionCreateInput, SessionMeta, SessionMoveInput, SessionRemoveResult, SessionUpdateInput } from '@shared/types'
import { useChatWindowsStore } from './chat-windows'
import { apiOf, scopedStore, useShownDeviceStore } from './device'
import { useProjectsStore } from './projects'

/** The chat of an opened session. */
export interface SessionChat {
  items: ChatItem[]
  index: Map<string, number>
  loaded: boolean
  /**
   * Counts the texts that got their first words while streaming. The timeline's blocks depend on it
   * instead of on every text (MessageList): they only change when a text stops being empty.
   */
  textShown: number
}

const IDLE: SessionRuntime = { status: 'idle', connected: false }
/**
 * Chats of another device kept loaded: each one's items and streamed text come over the server while
 * it is, so the ones not looked at for a while go (opened again, they load anew).
 */
const REMOTE_CHATS_KEPT = 4

/**
 * Every session of a device (`scopedStore`: this one's, or another's it controls), the runtime of those
 * that run, and the chat of the ones opened in this window. The main process sends each item and each
 * piece of streamed text; a chat that is still loading ignores them: what came before its answer is in
 * the answer (one pipe keeps the order, also over the server to another device).
 */
export const useSessionsStore = scopedStore('sessions', (device) => {
  const api = apiOf(device)
  /** Every session the main process has, also those about to be deleted. */
  const all = ref<SessionMeta[]>([])
  /** Deleted, but for a few seconds still to be brought back (useChatRemoval): gone from every list. */
  const hidden = reactive(new Set<string>())
  const metas = computed(() => (hidden.size ? all.value.filter((m) => !hidden.has(m.id)) : all.value))
  const runtimes = reactive(new Map<string, SessionRuntime>())
  const chats = shallowReactive(new Map<string, SessionChat>())
  const activeId = ref<string | null>(null)
  /** Sessions that finished a turn while another one was shown. */
  const unread = reactive(new Set<string>())
  let listening = false

  const active = computed(() => metas.value.find((m) => m.id === activeId.value) ?? null)
  const activeChat = computed(() => (activeId.value ? chats.get(activeId.value) : undefined))
  const activeRuntime = computed(() => (activeId.value ? runtime(activeId.value) : IDLE))

  // A chat opened on another device closes this device's one: one chat is on screen.
  const shown = useShownDeviceStore()
  shown.register(device, () => (activeId.value = null))

  /** In a window of its own (this device's chats only: another's don't go into windows). */
  function elsewhere(id: string): boolean {
    return !device && useChatWindowsStore().elsewhere(id)
  }

  function runtime(id: string): SessionRuntime {
    return runtimes.get(id) ?? IDLE
  }

  function get(id: string | null | undefined): SessionMeta | undefined {
    return id ? metas.value.find((m) => m.id === id) : undefined
  }

  function byProject(projectId: string): SessionMeta[] {
    return metas.value.filter((m) => m.projectId === projectId && !m.archived)
  }

  /** The folder a chat's agent works in: its own in the project, else the project's. */
  function cwdOf(meta: SessionMeta | null | undefined): string | null {
    if (!meta) return null
    return meta.cwd ?? useProjectsStore(device).get(meta.projectId)?.path ?? null
  }

  /** The list and what runs; again after another device lost track (Remote Control): its events start once. */
  async function load(): Promise<void> {
    const [list, current] = await Promise.all([api.sessions.list(), api.sessions.runtimes()])
    all.value = list
    for (const [id, state] of Object.entries(current)) if (!runtimes.has(id) || device) runtimes.set(id, state)
    // What ran and stopped meanwhile isn't in `current`: idle.
    if (device) for (const id of [...runtimes.keys()]) if (!(id in current)) runtimes.delete(id)
    if (listening) return
    listening = true
    api.sessions.onChanged((next) => (all.value = next))
    api.sessions.onEvent(onEvent)
  }

  /** After another device lost track: its list, and each chat loaded here, read anew. */
  async function reload(): Promise<void> {
    await load()
    for (const [id, chat] of chats) {
      if (!chat.loaded) continue
      try {
        const detail = await api.sessions.open(id)
        chat.items = detail.items
        chat.index = new Map(detail.items.map((item, i) => [item.id, i]))
        runtimes.set(id, detail.runtime)
      } catch {
        chats.delete(id)
        if (activeId.value === id) activeId.value = null
      }
    }
  }

  function onEvent(event: SessionEvent): void {
    if (event.type === 'runtime') {
      const previous = runtimes.get(event.sessionId)
      runtimes.set(event.sessionId, event.runtime)
      const finished = previous && (previous.status === 'running' || previous.status === 'waiting') && event.runtime.status === 'idle'
      // A chat in a window of its own is on screen there.
      if (finished && event.sessionId !== activeId.value && !elsewhere(event.sessionId)) unread.add(event.sessionId)
      return
    }
    const chat = chats.get(event.sessionId)
    if (!chat?.loaded) return
    switch (event.type) {
      case 'item': {
        const at = chat.index.get(event.item.id)
        if (at === undefined) {
          chat.index.set(event.item.id, chat.items.length)
          chat.items.push(event.item)
        } else {
          chat.items[at] = event.item
        }
        break
      }
      case 'delta': {
        const at = chat.index.get(event.itemId)
        if (at === undefined) return
        const item = chat.items[at]
        if (event.field === 'text' && (item.kind === 'assistant' || item.kind === 'thinking')) {
          if (!item.text.trim() && event.text.trim()) chat.textShown++
          item.text += event.text
        }
        else if (event.field === 'output' && item.kind === 'tool') item.output = (item.output ?? '') + event.text
        break
      }
      case 'truncated':
        for (const item of chat.items.splice(event.length)) chat.index.delete(item.id)
        break
    }
  }

  async function open(id: string): Promise<void> {
    // A chat in another window shows there: its own window, or (from a chat's own window) the main window.
    if (elsewhere(id)) return useChatWindowsStore().show(id)
    shown.show(device)
    activeId.value = id
    unread.delete(id)
    const loaded = chats.get(id)
    if (loaded?.loaded) {
      if (device) {
        // The newest last: the ones looked at least go first (`keepFew`).
        chats.delete(id)
        chats.set(id, loaded)
      }
      // Opened before: its CLI may have gone on outside Nexa since; what came arrives as events.
      void sync(id).catch((error) => console.warn('[sessions] sync failed', error))
      return
    }
    const chat: SessionChat = reactive({ items: [], index: new Map(), loaded: false, textShown: 0 }) as SessionChat
    chats.set(id, chat)
    keepFew()
    try {
      const detail = await api.sessions.open(id)
      chat.items = detail.items
      chat.index = new Map(detail.items.map((item, i) => [item.id, i]))
      runtimes.set(id, detail.runtime)
      chat.loaded = true
    } catch (error) {
      chats.delete(id)
      throw error
    }
  }

  /** Of another device, only the chats looked at last stay loaded (`REMOTE_CHATS_KEPT`). */
  function keepFew(): void {
    if (!device) return
    for (const id of [...chats.keys()]) {
      if (chats.size <= REMOTE_CHATS_KEPT) return
      if (id !== activeId.value) chats.delete(id)
    }
  }

  /**
   * Takes into a loaded chat what its CLI conversation gained outside Nexa; the items come as events.
   * The number of items taken.
   */
  async function sync(id: string): Promise<number> {
    return chats.get(id)?.loaded ? api.sessions.sync(id) : 0
  }

  /** „Am Reset fortsetzen“ for a chat at its limit, or not (any more): it goes on by itself then. */
  async function resumeAtReset(id: string, on: boolean): Promise<void> {
    await api.sessions.resumeAtReset(id, on)
  }

  function close(): void {
    activeId.value = null
  }

  async function create(input: SessionCreateInput): Promise<SessionMeta> {
    const meta = await api.sessions.create({ ...input })
    if (!all.value.some((m) => m.id === meta.id)) all.value = [meta, ...all.value]
    await open(meta.id)
    return meta
  }

  /** A new chat that goes on from where this one is now; it opens. */
  async function fork(id: string): Promise<SessionMeta> {
    const meta = await api.sessions.fork(id)
    if (!all.value.some((m) => m.id === meta.id)) all.value = [meta, ...all.value]
    await open(meta.id)
    return meta
  }

  /** Empties the chat's context; it stays where it is, with a notice in its history. */
  async function clear(id: string): Promise<void> {
    const meta = await api.sessions.clear(id)
    const at = all.value.findIndex((m) => m.id === id)
    if (at >= 0) all.value[at] = meta
  }

  /** Pictures are files of this device: another one gets them first and keeps them with its own. */
  async function imagesFor(images: readonly string[] | undefined): Promise<string[] | undefined> {
    if (!images?.length) return undefined
    if (!device) return [...images]
    return Promise.all(images.map((path) => window.api.remote.uploadImage(device, path)))
  }

  async function send(id: string, input: SendInput): Promise<void> {
    await api.sessions.send(id, { text: input.text, images: await imagesFor(input.images) })
  }

  /** A prompt of the chat sent anew, changed: what came after it goes. */
  async function edit(id: string, itemId: string, input: SendInput): Promise<void> {
    await api.sessions.edit(id, itemId, { text: input.text, images: await imagesFor(input.images) })
  }

  async function update(id: string, patch: SessionUpdateInput): Promise<void> {
    const meta = await api.sessions.update(id, { ...patch })
    const at = all.value.findIndex((m) => m.id === id)
    if (at >= 0) all.value[at] = meta
  }

  async function move(id: string, target: SessionMoveInput): Promise<SessionMeta> {
    const meta = await api.sessions.move(id, { ...target })
    const at = all.value.findIndex((m) => m.id === id)
    if (at >= 0) all.value[at] = meta
    return meta
  }

  async function respond(id: string, itemId: string, response: InteractionResponse): Promise<void> {
    await api.sessions.respond(id, itemId, JSON.parse(JSON.stringify(response)) as InteractionResponse)
  }

  /** Out of every list at once, for the seconds in which deleting can be undone; the shown chat closes. */
  function hide(ids: readonly string[]): void {
    for (const id of ids) hidden.add(id)
    if (activeId.value && hidden.has(activeId.value)) activeId.value = null
  }

  function unhide(ids: readonly string[]): void {
    for (const id of ids) hidden.delete(id)
  }

  /** Deletes chats for good, with their CLIs' conversations if the settings say so (see SessionService.remove). */
  async function remove(ids: readonly string[]): Promise<SessionRemoveResult> {
    try {
      const result = await api.sessions.remove([...ids])
      forget(result.removed)
      return result
    } finally {
      unhide(ids)
    }
  }

  /** What the window keeps of chats the main process no longer has (deleted, also with their project). */
  function forget(ids: readonly string[]): void {
    const gone = new Set(ids)
    all.value = all.value.filter((m) => !gone.has(m.id))
    for (const id of gone) {
      chats.delete(id)
      runtimes.delete(id)
      unread.delete(id)
    }
    if (activeId.value && gone.has(activeId.value)) activeId.value = null
  }

  return {
    device,
    all,
    metas,
    hidden,
    runtimes,
    chats,
    activeId,
    unread,
    active,
    activeChat,
    activeRuntime,
    runtime,
    get,
    byProject,
    cwdOf,
    load,
    reload,
    open,
    sync,
    resumeAtReset,
    close,
    create,
    fork,
    clear,
    send,
    edit,
    update,
    move,
    respond,
    hide,
    unhide,
    remove,
    forget,
    interrupt: (id: string) => api.sessions.interrupt(id),
    stop: (id: string) => api.sessions.stop(id),
    restart: (id: string) => api.sessions.restart(id),
  }
})
