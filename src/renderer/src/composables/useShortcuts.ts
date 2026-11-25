import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import { chatAt, cycleChat, matchAppShortcut, type AppShortcut } from '@shared/shortcuts'
import { DEFAULT_ZOOM, normalizeZoom, stepZoom } from '@shared/zoom'
import { isChatWindow } from '@/lib/chat-window'
import { attempt } from '@/lib/errors'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useTerminalsStore } from '@/stores/terminals'
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
  const settings = useSettingsStore()
  const ui = useUiStore()
  const terminals = useTerminalsStore()
  const chat = useChatActions()

  /**
   * The chats in the order the sidebar shows them, as one counts them there: a folded project's
   * aren't among them. A pinned chat shows twice (on top and in its project) and counts where it
   * shows first. With the sidebar hidden, the latest first.
   */
  function chatOrder(): string[] {
    const rows = [...document.querySelectorAll<HTMLElement>(CHAT_ROW)].filter((row) => row.getClientRects().length > 0)
    if (rows.length) return [...new Set(rows.map((row) => row.dataset.sessionId!).filter(Boolean))]
    return sessions.metas.filter((m) => !m.archived).map((m) => m.id)
  }

  /** The open chat; none on the start page. */
  const openId = () => (ui.view === 'chat' ? sessions.activeId : null)

  /**
   * The scale asked for last, until the settings have it: keys pressed in quick succession step on
   * from there instead of from the scale before.
   */
  let zoomTarget: number | null = null
  function zoom(step: 1 | -1 | 0): void {
    const current = zoomTarget ?? normalizeZoom(settings.settings.appearance.zoom)
    const next = step === 0 ? DEFAULT_ZOOM : stepZoom(current, step)
    // Like Chrome's bubble: the scale it is now, with the way back.
    toast(`Skalierung ${next} %`, {
      id: 'zoom',
      duration: 2000,
      action: next === DEFAULT_ZOOM ? undefined : { label: 'Zurücksetzen', onClick: () => zoom(0) },
    })
    if (next === current) return
    zoomTarget = next
    void attempt(() => settings.update({ appearance: { zoom: next } }), 'Skalierung nicht gespeichert').finally(() => {
      if (zoomTarget === next) zoomTarget = null
    })
  }

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
        // A chat's own window has no sidebar to step through.
        if (isChatWindow) return
        const id = cycleChat(chatOrder(), openId(), shortcut.step)
        if (id && id !== openId()) void chat.open(id)
        return
      }
      case 'select-chat': {
        if (isChatWindow) return
        const id = chatAt(chatOrder(), shortcut.index)
        if (id && id !== openId()) void chat.open(id)
        return
      }
      case 'zoom':
        zoom(shortcut.step)
        return
      case 'toggle-terminal': {
        const id = openId()
        if (id) terminals.toggle(id)
        return
      }
    }
  }

  useEventListener(window, 'keydown', (event: KeyboardEvent) => {
    if (!ready.value || event.defaultPrevented) return
    const shortcut = matchAppShortcut(event)
    if (!shortcut) return
    // A dialog that asks something keeps the keyboard; over the settings, the quick open is fine.
    // Scaling works everywhere: it changes nothing a dialog is about.
    if (ui.confirmState?.open && shortcut.action !== 'zoom') return
    const inDialog = event.target instanceof Element && !!event.target.closest('[role=dialog]')
    if (inDialog && shortcut.action !== 'palette' && shortcut.action !== 'open-settings' && shortcut.action !== 'zoom') return
    event.preventDefault()
    run(shortcut)
  })
}
