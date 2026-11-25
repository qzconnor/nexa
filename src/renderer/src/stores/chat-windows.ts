import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'
import type { ChatHandoff, MainWindowRequest } from '@shared/chat-windows'
import { useChatActions } from '@/composables/useChatActions'
import { isChatWindow, ownChat } from '@/lib/chat-window'
import { attempt } from '@/lib/errors'
import { useBrowsersStore } from './browsers'
import { useComposerStore } from './composer'
import { useSessionsStore } from './sessions'
import { useTerminalsStore } from './terminals'
import { useUiStore } from './ui'

const EMPTY_DRAFT = { text: '', images: [] as string[] }

/**
 * Chats in windows of their own (shared/chat-windows.ts), seen from this window: which chats have one,
 * moving a chat there and back with its draft and panels, and, in a chat's own window, handing the
 * main window what only it does (another chat, the start page, deleting, the quick open).
 */
export const useChatWindowsStore = defineStore('chatWindows', () => {
  /** The chats that have a window of their own. */
  const ids = ref<ReadonlySet<string>>(new Set())
  let known = false

  window.api.chatWindows.onChanged((list) => {
    known = true
    ids.value = new Set(list)
  })
  void window.api.chatWindows
    .list()
    .then((list) => {
      if (!known) ids.value = new Set(list)
    })
    .catch((error) => console.warn('[chat-windows] list not loaded', error))

  /** Shown in a window of its own, from the main window's view. */
  const hasWindow = (sessionId: string | null | undefined) => !!sessionId && ids.value.has(sessionId)

  /** The chat shows in another window than this one: its own, or, from a chat's own window, the main window. */
  function elsewhere(sessionId: string | null | undefined): boolean {
    if (!sessionId) return false
    return ownChat ? sessionId !== ownChat : ids.value.has(sessionId)
  }

  /** The chat in the window that shows it: its own window comes to the front, else the main window opens it. */
  async function show(sessionId: string): Promise<void> {
    if (ownChat && sessionId !== ownChat) return toMain({ kind: 'open', sessionId })
    await attempt(() => window.api.chatWindows.open(sessionId), 'Das Fenster ließ sich nicht öffnen')
  }

  async function toMain(request: MainWindowRequest): Promise<void> {
    await attempt(() => window.api.chatWindows.toMain(request), 'Das Hauptfenster ließ sich nicht erreichen')
  }

  /** What goes along with the chat into another window. */
  function handoffOf(sessionId: string): ChatHandoff {
    const draft = useComposerStore().liveDraft(sessionId)
    return {
      draft: draft ? { text: draft.text, images: [...draft.images] } : null,
      terminal: useTerminalsStore().isOpen(sessionId),
      browser: useBrowsersStore().isOpen(sessionId),
    }
  }

  /** Takes in what came along with a chat: its draft, and its panels open as they were. */
  function apply(sessionId: string, handoff: ChatHandoff): void {
    useComposerStore().saveDraft(sessionId, handoff.draft ?? EMPTY_DRAFT)
    // Not `open`: the terminals may not be listed yet, and it would start a new one then.
    useTerminalsStore().setOpen(sessionId, handoff.terminal)
    useBrowsersStore().setOpen(sessionId, handoff.browser)
  }

  /**
   * From the main window: the chat into a window of its own (or that window to the front). The main
   * window lets go of it first, so its draft doesn't stay behind here too.
   */
  async function popOut(sessionId: string): Promise<void> {
    if (ownChat) return
    if (ids.value.has(sessionId)) return show(sessionId)
    const sessions = useSessionsStore()
    const ui = useUiStore()
    const handoff = handoffOf(sessionId)
    const meta = sessions.get(sessionId)
    const wasShown = ui.view === 'chat' && sessions.activeId === sessionId
    if (wasShown) {
      useChatActions().newChat(meta?.projectId ?? null)
      // The composer saves its draft as it goes; cleared after that.
      await nextTick()
    }
    useComposerStore().saveDraft(sessionId, EMPTY_DRAFT)
    useTerminalsStore().setOpen(sessionId, false)
    const opened = await attempt(() => window.api.chatWindows.open(sessionId, handoff).then(() => true), 'Das Fenster ließ sich nicht öffnen')
    if (opened) return
    // No window: the chat stays here as it was.
    apply(sessionId, handoff)
    if (wasShown) await useChatActions().open(sessionId)
  }

  /** From a chat's own window: back into the main window, which shows it. */
  async function dock(): Promise<void> {
    const id = ownChat
    if (id) await attempt(() => window.api.chatWindows.dock(handoffOf(id)), 'Zurück ins Hauptfenster ging nicht')
  }

  /** From a chat's own window: it closes, what is written goes back to the main window (see `closing`). */
  async function closeOwn(): Promise<void> {
    const id = ownChat
    if (!id) return
    const sent = await window.api.chatWindows
      .closing(handoffOf(id))
      .then(() => true)
      .catch(() => false)
    // Main didn't take it: the window still goes, only without the question.
    if (!sent) window.close()
  }

  /** The windows of chats that are being deleted close (the main window deletes, with „Rückgängig“). */
  function closeWindows(sessionIds: readonly string[]): void {
    const own = sessionIds.filter((id) => ids.value.has(id))
    if (own.length) void attempt(() => window.api.chatWindows.close(own))
  }

  function runRequest(request: MainWindowRequest): void {
    const chat = useChatActions()
    switch (request.kind) {
      case 'open':
        void chat.open(request.sessionId)
        return
      case 'new':
        chat.newChat(request.projectId)
        return
      case 'remove': {
        const meta = useSessionsStore().get(request.sessionId)
        if (meta) void chat.remove(meta)
        return
      }
      case 'palette': {
        const ui = useUiStore()
        ui.paletteQuery = request.query
        ui.paletteOpen = true
        return
      }
    }
  }

  if (isChatWindow) {
    // About to close: what is written goes back to the main window with the chat.
    const id = ownChat
    window.api.chatWindows.onClosing(() => {
      if (id) void window.api.chatWindows.closing(handoffOf(id)).catch(() => undefined)
    })
  } else {
    window.api.chatWindows.onReturned(apply)
    window.api.chatWindows.onRequest(runRequest)
  }

  return { ids, hasWindow, elsewhere, show, toMain, handoffOf, apply, popOut, dock, closeOwn, closeWindows }
})
