import { ChatWindowsEvent, ChatWindowsInvoke, parseHandoff, parseMainWindowRequest, type MainWindowRequest } from '@shared/chat-windows'
import { broadcast, handle } from '../ipc'
import type { ChatWindows } from './chat-windows'
import { revealWindow } from './main-window'

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200) throw new Error('Der Chat fehlt.')
  return value
}

export interface ChatWindowsIpcDeps {
  /** Whether Nexa has the chat (a window for a deleted one would show nothing). */
  exists(sessionId: string): boolean
  /** Brings the main window to the front with what a chat's own window asks of it. */
  toMain(request: MainWindowRequest): void
}

/** The windows' side of the chats in windows of their own; which chat a window shows comes from main. */
export function registerChatWindowsIpc(windows: ChatWindows, deps: ChatWindowsIpcDeps): void {
  handle(ChatWindowsInvoke.open, (_e, id: unknown, handoff: unknown) => {
    const chat = sessionId(id)
    if (!deps.exists(chat)) throw new Error('Diesen Chat gibt es nicht mehr.')
    revealWindow(windows.open(chat, handoff == null ? undefined : parseHandoff(handoff)))
  })
  handle(ChatWindowsInvoke.list, () => windows.ids())
  // Only the chat's own window takes what came along with it.
  handle(ChatWindowsInvoke.takeHandoff, (event, id: unknown) => {
    const chat = sessionId(id)
    return windows.sessionOf(event.sender) === chat ? windows.takeHandoff(chat) : null
  })
  handle(ChatWindowsInvoke.toMain, (_e, request: unknown) => deps.toMain(parseMainWindowRequest(request)))
  handle(ChatWindowsInvoke.dock, (event, handoff: unknown) => windows.dock(event.sender, parseHandoff(handoff)))
  handle(ChatWindowsInvoke.closing, (event, handoff: unknown) => windows.closing(event.sender, parseHandoff(handoff)))
  handle(ChatWindowsInvoke.close, (_e, ids: unknown) => {
    if (!Array.isArray(ids)) throw new Error('Die Chats fehlen.')
    windows.close(ids.map(sessionId))
  })
  windows.on('changed', (ids) => broadcast(ChatWindowsEvent.changed, ids))
}
