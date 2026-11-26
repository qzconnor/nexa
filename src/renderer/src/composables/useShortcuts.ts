import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { toast } from 'vue-sonner'
import { chatAt, cycleChat, matchAppShortcut, type AppShortcut } from '@shared/shortcuts'
import { DEFAULT_ZOOM, normalizeZoom, stepZoom } from '@shared/zoom'
import { isChatWindow } from '@/lib/chat-window'
import { chatRefs, chatSources, newChatTarget } from '@/lib/device-chats'
import { attempt } from '@/lib/errors'
import { chatKey } from '@/lib/session-tree'
import { useShownDeviceStore } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useTerminalsStore } from '@/stores/terminals'
import { useUiStore } from '@/stores/ui'
import { useChatActions } from './useChatActions'

/** A chat's row in the sidebar (SidebarSession), with its device and id (`data-chat-key`). */
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
  const shown = useShownDeviceStore()
  const devices = useDevicesStore()

  /** Every chat of this device and of the other devices shown in the sidebar, for when it is hidden. */
  const allChats = () => chatRefs(chatSources(devices.devices).map((s) => ({ device: s.id, metas: useSessionsStore(s.id).metas })))

  /**
   * The chats in the order the sidebar shows them, as one counts them there: a folded project's or
   * device's aren't among them. A pinned chat shows twice (on top, with those of every device, and in
   * its project) and counts where it shows first. With the sidebar hidden, this device's latest first,
   * then each other device's.
   */
  function chatOrder(): string[] {
    const rows = [...document.querySelectorAll<HTMLElement>(CHAT_ROW)].filter((row) => row.getClientRects().length > 0)
    if (rows.length) return [...new Set(rows.map((row) => row.dataset.chatKey!).filter(Boolean))]
    return allChats().map((c) => c.key)
  }

  /** The open chat, of whichever device; none on the start page. */
  const openId = () => (ui.view === 'chat' ? sessions.activeId : null)
  function openKey(): string | null {
    if (ui.view !== 'chat') return null
    const id = useSessionsStore(shown.device).activeId
    return id ? chatKey(shown.device, id) : null
  }

  /** Opens a chat of the sidebar as its row would, else (sidebar hidden) on its device all the same. */
  function openChat(key: string): void {
    const row = [...document.querySelectorAll<HTMLElement>(CHAT_ROW)].find((r) => r.dataset.chatKey === key)
    if (row) return row.click()
    const target = allChats().find((c) => c.key === key)
    if (target) void useChatActions(target.device).open(target.id)
  }

  /** In the project of the chat on screen, on its device; another device has to let this one start chats. */
  function newChat(): void {
    const meta = ui.view === 'chat' ? useSessionsStore(shown.device).active : null
    const target = newChatTarget(meta ? { device: shown.device, projectId: meta.projectId } : null, devices.level)
    if (target !== 'denied') return useChatActions(target.device).newChat(target.projectId)
    const name = devices.devices.find((d) => d.id === shown.device)?.name ?? 'Das Gerät'
    toast(`Kein neuer Chat auf „${name}“`, { description: `„${name}“ lässt dieses Gerät nur mitlesen: Neue Chats startest du dort.` })
  }

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
        newChat()
        return
      case 'cycle-chat': {
        // A chat's own window has no sidebar to step through.
        if (isChatWindow) return
        const key = cycleChat(chatOrder(), openKey(), shortcut.step)
        if (key && key !== openKey()) openChat(key)
        return
      }
      case 'select-chat': {
        if (isChatWindow) return
        const key = chatAt(chatOrder(), shortcut.index)
        if (key && key !== openKey()) openChat(key)
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
