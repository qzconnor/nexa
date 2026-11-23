import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { chatAt, cycleChat, matchAppShortcut, type AppShortcut } from '@shared/shortcuts'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { useChatActions } from './useChatActions'

/** A chat's row in the sidebar (SidebarSession), with its id. */
const CHAT_ROW = '[data-chat-row]'

/**
 * The window's keyboard shortcuts (src/shared/shortcuts.ts). `ready`: the window shows its content;
 * before, there is nothing for them to do.
 */
export function useShortcuts(ready: Ref<boolean>): void {
  const sessions = useSessionsStore()
  const ui = useUiStore()
  const chat = useChatActions()

  /**
   * The chats in the order the sidebar shows them, as one counts them there: a folded project's
   * aren't among them. With the sidebar hidden, the latest first.
   */
  function chatOrder(): string[] {
    const rows = [...document.querySelectorAll<HTMLElement>(CHAT_ROW)].filter((row) => row.getClientRects().length > 0)
    if (rows.length) return rows.map((row) => row.dataset.sessionId!).filter(Boolean)
    return sessions.metas.filter((m) => !m.archived).map((m) => m.id)
  }

  /** The open chat; none on the start page. */
  const openId = () => (ui.view === 'chat' ? sessions.activeId : null)

  function run(shortcut: AppShortcut): void {
    switch (shortcut.action) {
      case 'open-settings':
        ui.openSettings()
        return
      case 'palette':
        ui.openPalette(shortcut.prefix)
        return
      case 'new-chat':
        chat.newChat(openId() ? (sessions.active?.projectId ?? null) : null)
        return
      case 'cycle-chat': {
        const id = cycleChat(chatOrder(), openId(), shortcut.step)
        if (id && id !== openId()) void chat.open(id)
        return
      }
      case 'select-chat': {
        const id = chatAt(chatOrder(), shortcut.index)
        if (id && id !== openId()) void chat.open(id)
        return
      }
    }
  }

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (!ready.value || event.defaultPrevented) return
    const shortcut = matchAppShortcut(event)
    if (!shortcut) return
    // A dialog that asks something keeps the keyboard; over the settings, the quick open is fine.
    if (ui.confirmState?.open) return
    const inDialog = event.target instanceof Element && !!event.target.closest('[role=dialog]')
    if (inDialog && shortcut.action !== 'palette' && shortcut.action !== 'open-settings') return
    event.preventDefault()
    run(shortcut)
  })
}
