import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive } from 'vue'
import type { ChatItem, InteractionResponse, SessionEvent, SessionRuntime } from '@shared/chat'
import { parseRemoteChatId } from '@shared/remote'
import type { SendInput, SessionCreateInput, SessionMeta, SessionMoveInput, SessionRemoveResult, SessionUpdateInput } from '@shared/types'
import { useChatWindowsStore } from './chat-windows'
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
 * Every session (sidebar), the runtime of those that run, and the chat of the ones opened in this
 * window. The main process sends each item and each piece of streamed text; a chat that is still
 * loading ignores them: what came before its answer is in the answer (one IPC pipe keeps the order).
 * Chats of other devices (stores/remote.ts) sit in `chats` and `runtimes` too, under `remote:…` ids,
 * so the chat's components show them as any other; what they do there goes to the device.
 */
export const useSessionsStore = defineStore('sessions', () => {
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

  const active = computed(() => metas.value.find((m) => m.id === activeId.value) ?? null)
  const activeChat = computed(() => (activeId.value ? chats.get(activeId.value) : undefined))
  const activeRuntime = computed(() => (activeId.value ? runtime(activeId.value) : IDLE))

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
    return meta.cwd ?? useProjectsStore().get(meta.projectId)?.path ?? null
  }

  async function load(): Promise<void> {
    all.value = await window.api.sessions.list()
    window.api.sessions.onChanged((next) => (all.value = next))
    window.api.sessions.onEvent(onEvent)
  }

  function onEvent(event: SessionEvent): void {
    if (event.type === 'runtime') {
      const previous = runtimes.get(event.sessionId)
      runtimes.set(event.sessionId, event.runtime)
      const finished = previous && (previous.status === 'running' || previous.status === 'waiting') && event.runtime.status === 'idle'
      // A chat in a window of its own is on screen there.
      if (finished && event.sessionId !== activeId.value && !useChatWindowsStore().elsewhere(event.sessionId)) unread.add(event.sessionId)
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
    const windows = useChatWindowsStore()
    if (windows.elsewhere(id)) return windows.show(id)
    activeId.value = id
    unread.delete(id)
    if (chats.get(id)?.loaded) {
      // Opened before: its CLI may have gone on outside Nexa since; what came arrives as events.
      void sync(id).catch((error) => console.warn('[sessions] sync failed', error))
      return
    }
    const chat: SessionChat = reactive({ items: [], index: new Map(), loaded: false, textShown: 0 }) as SessionChat
    chats.set(id, chat)
    try {
      const detail = await window.api.sessions.open(id)
      chat.items = detail.items
      chat.index = new Map(detail.items.map((item, i) => [item.id, i]))
      runtimes.set(id, detail.runtime)
      chat.loaded = true
    } catch (error) {
      chats.delete(id)
      throw error
    }
  }

  /**
   * Takes into a loaded chat what its CLI conversation gained outside Nexa; the items come as events.
   * The number of items taken.
   */
  async function sync(id: string): Promise<number> {
    return chats.get(id)?.loaded ? window.api.sessions.sync(id) : 0
  }

  /** „Am Reset fortsetzen“ for a chat at its limit, or not (any more): it goes on by itself then. */
  async function resumeAtReset(id: string, on: boolean): Promise<void> {
    await window.api.sessions.resumeAtReset(id, on)
  }

  function close(): void {
    activeId.value = null
  }

  async function create(input: SessionCreateInput): Promise<SessionMeta> {
    const meta = await window.api.sessions.create(input)
    if (!all.value.some((m) => m.id === meta.id)) all.value = [meta, ...all.value]
    await open(meta.id)
    return meta
  }

  /** A new chat that goes on from where this one is now; it opens. */
  async function fork(id: string): Promise<SessionMeta> {
    const meta = await window.api.sessions.fork(id)
    if (!all.value.some((m) => m.id === meta.id)) all.value = [meta, ...all.value]
    await open(meta.id)
    return meta
  }

  /** Empties the chat's context; it stays where it is, with a notice in its history. */
  async function clear(id: string): Promise<void> {
    const meta = await window.api.sessions.clear(id)
    const at = all.value.findIndex((m) => m.id === id)
    if (at >= 0) all.value[at] = meta
  }

  async function send(id: string, input: SendInput): Promise<void> {
    await window.api.sessions.send(id, { text: input.text, images: input.images ? [...input.images] : undefined })
  }

  /** A prompt of the chat sent anew, changed: what came after it goes. */
  async function edit(id: string, itemId: string, input: SendInput): Promise<void> {
    await window.api.sessions.edit(id, itemId, { text: input.text, images: input.images ? [...input.images] : undefined })
  }

  async function update(id: string, patch: SessionUpdateInput): Promise<void> {
    const meta = await window.api.sessions.update(id, { ...patch })
    const at = all.value.findIndex((m) => m.id === id)
    if (at >= 0) all.value[at] = meta
  }

  async function move(id: string, target: SessionMoveInput): Promise<SessionMeta> {
    const meta = await window.api.sessions.move(id, { ...target })
    const at = all.value.findIndex((m) => m.id === id)
    if (at >= 0) all.value[at] = meta
    return meta
  }

  async function respond(id: string, itemId: string, response: InteractionResponse): Promise<void> {
    const plain = JSON.parse(JSON.stringify(response)) as InteractionResponse
    const remote = parseRemoteChatId(id)
    if (remote) return window.api.remote.respond(remote.instance, remote.sessionId, itemId, plain)
    await window.api.sessions.respond(id, itemId, plain)
  }

  async function interrupt(id: string): Promise<void> {
    const remote = parseRemoteChatId(id)
    return remote ? window.api.remote.interrupt(remote.instance, remote.sessionId) : window.api.sessions.interrupt(id)
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
      const result = await window.api.sessions.remove([...ids])
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
    /** An event of a chat, also one of another device's (stores/remote.ts). */
    apply: onEvent,
    interrupt,
    stop: (id: string) => window.api.sessions.stop(id),
    restart: (id: string) => window.api.sessions.restart(id),
  }
})
