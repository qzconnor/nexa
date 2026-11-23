import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive } from 'vue'
import type { ChatItem, InteractionResponse, SessionEvent, SessionRuntime } from '@shared/chat'
import type { SendInput, SessionCreateInput, SessionMeta, SessionMoveInput, SessionUpdateInput } from '@shared/types'
import { useProjectsStore } from './projects'

/** The chat of an opened session. */
export interface SessionChat {
  items: ChatItem[]
  index: Map<string, number>
  loaded: boolean
}

const IDLE: SessionRuntime = { status: 'idle', connected: false }

/**
 * Every session (sidebar), the runtime of those that run, and the chat of the ones opened in this
 * window. The main process sends each item and each piece of streamed text; a chat that is still
 * loading ignores them: what came before its answer is in the answer (one IPC pipe keeps the order).
 */
export const useSessionsStore = defineStore('sessions', () => {
  const metas = ref<SessionMeta[]>([])
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
    metas.value = await window.api.sessions.list()
    window.api.sessions.onChanged((next) => (metas.value = next))
    window.api.sessions.onEvent(onEvent)
  }

  function onEvent(event: SessionEvent): void {
    if (event.type === 'runtime') {
      const previous = runtimes.get(event.sessionId)
      runtimes.set(event.sessionId, event.runtime)
      const finished = previous && (previous.status === 'running' || previous.status === 'waiting') && event.runtime.status === 'idle'
      if (finished && event.sessionId !== activeId.value) unread.add(event.sessionId)
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
        if (event.field === 'text' && (item.kind === 'assistant' || item.kind === 'thinking')) item.text += event.text
        else if (event.field === 'output' && item.kind === 'tool') item.output = (item.output ?? '') + event.text
        break
      }
      case 'cleared':
        chat.items.splice(0)
        chat.index.clear()
        break
    }
  }

  async function open(id: string): Promise<void> {
    activeId.value = id
    unread.delete(id)
    if (chats.get(id)?.loaded) {
      // Opened before: its CLI may have gone on outside Nexa since; what came arrives as events.
      void sync(id).catch((error) => console.warn('[sessions] sync failed', error))
      return
    }
    const chat: SessionChat = reactive({ items: [], index: new Map(), loaded: false }) as SessionChat
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

  function close(): void {
    activeId.value = null
  }

  async function create(input: SessionCreateInput): Promise<SessionMeta> {
    const meta = await window.api.sessions.create(input)
    if (!metas.value.some((m) => m.id === meta.id)) metas.value = [meta, ...metas.value]
    await open(meta.id)
    return meta
  }

  async function send(id: string, input: SendInput): Promise<void> {
    await window.api.sessions.send(id, { text: input.text, images: input.images ? [...input.images] : undefined })
  }

  async function update(id: string, patch: SessionUpdateInput): Promise<void> {
    const meta = await window.api.sessions.update(id, { ...patch })
    const at = metas.value.findIndex((m) => m.id === id)
    if (at >= 0) metas.value[at] = meta
  }

  async function move(id: string, target: SessionMoveInput): Promise<SessionMeta> {
    const meta = await window.api.sessions.move(id, { ...target })
    const at = metas.value.findIndex((m) => m.id === id)
    if (at >= 0) metas.value[at] = meta
    return meta
  }

  async function respond(id: string, itemId: string, response: InteractionResponse): Promise<void> {
    await window.api.sessions.respond(id, itemId, JSON.parse(JSON.stringify(response)) as InteractionResponse)
  }

  async function remove(id: string): Promise<void> {
    await window.api.sessions.remove(id)
    metas.value = metas.value.filter((m) => m.id !== id)
    chats.delete(id)
    runtimes.delete(id)
    if (activeId.value === id) activeId.value = null
  }

  return {
    metas,
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
    close,
    create,
    send,
    update,
    move,
    respond,
    remove,
    interrupt: (id: string) => window.api.sessions.interrupt(id),
    stop: (id: string) => window.api.sessions.stop(id),
  }
})
