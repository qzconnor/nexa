import { zoomKey, type ShortcutKey } from './browser'

/**
 * The window's keyboard shortcuts. Those of the browser beside a chat are `matchBrowserShortcut`'s;
 * the search in the open chat (Ctrl+F, F3) and the file panel (Ctrl+Shift+E) are the chat's own.
 */
export type AppShortcut =
  | { action: 'open-settings' }
  /** The quick open with the chats (`''`) or the commands (`'>'`). */
  | { action: 'palette'; prefix: '' | '>' }
  | { action: 'new-chat' }
  /** The chat below (1) or above (-1) the open one in the sidebar. */
  | { action: 'cycle-chat'; step: 1 | -1 }
  /** The chat at that place in the sidebar, from 0; -1 the last one. */
  | { action: 'select-chat'; index: number }
  /** The window's scale one step larger (1) or smaller (-1), or back to 100 % (0). */
  | { action: 'zoom'; step: 1 | -1 | 0 }

/**
 * Like a browser's tabs: Ctrl+Tab and Ctrl+Shift+Tab go to the next and the previous chat, Ctrl+1–8
 * to that one, Ctrl+9 to the last; Ctrl+Shift+T opens a new chat (as in Windows Terminal and the
 * Claude Manager). Ctrl+, opens the settings, Ctrl+Shift+A and Ctrl+Shift+P the quick open (as in
 * VS Code). Ctrl+plus/minus/0 scale the window like a browser's zoom. Plain Ctrl+letter combinations
 * stay with the fields (Ctrl+A, Ctrl+Z …).
 */
export function matchAppShortcut(e: ShortcutKey): AppShortcut | null {
  if (e.type !== 'keydown' || e.altKey) return null
  if (!(e.ctrlKey || e.metaKey)) return null
  if (e.key === 'Tab') return { action: 'cycle-chat', step: e.shiftKey ? -1 : 1 }
  const zoom = zoomKey(e)
  if (zoom !== null) return { action: 'zoom', step: zoom }
  const key = e.key.toLowerCase()
  if (e.shiftKey) {
    if (key === 't') return { action: 'new-chat' }
    if (key === 'a') return { action: 'palette', prefix: '' }
    if (key === 'p') return { action: 'palette', prefix: '>' }
    return null
  }
  const digit = chatDigit(e)
  if (digit) return { action: 'select-chat', index: digit === 9 ? -1 : digit - 1 }
  if (key === ',') return { action: 'open-settings' }
  return null
}

/**
 * The digit 1–9 of the key, also from the number row of layouts that type something else there
 * without Shift (e.g. "&" on AZERTY). The number pad counts only with Num Lock: without it its keys
 * are End, arrows and so on.
 */
function chatDigit(e: ShortcutKey): number | null {
  const digit = /^Digit([1-9])$/.exec(e.code)?.[1] ?? (/^[1-9]$/.test(e.key) ? e.key : null)
  return digit ? Number(digit) : null
}

/** The chat a step leads to among `order` from the open one; from none (the start page), the first or the last. */
export function cycleChat(order: readonly string[], current: string | null, step: 1 | -1): string | null {
  if (order.length === 0) return null
  const at = current ? order.indexOf(current) : -1
  if (at === -1) return step === 1 ? order[0]! : order[order.length - 1]!
  return order[(at + step + order.length) % order.length]!
}

/** The chat at a place among `order` (-1: the last one); null when there are fewer. */
export function chatAt(order: readonly string[], index: number): string | null {
  return (index === -1 ? order[order.length - 1] : order[index]) ?? null
}
