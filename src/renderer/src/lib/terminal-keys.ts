import type { ShortcutKey } from '@shared/browser'
import { matchAppShortcut } from '@shared/shortcuts'

/** What a key in the terminal does instead of going to the shell. */
export type TerminalKey = 'copy' | 'paste' | 'app' | null

/**
 * Keys the terminal doesn't send to the shell: the window's shortcuts (other chats, the quick open,
 * the scale, the terminal itself), copy with a selection (Ctrl+C, else it interrupts as in every
 * terminal) and paste (Ctrl+V; Ctrl+Shift+C and V as in Windows Terminal). Null: the shell gets it.
 */
export function terminalKey(e: ShortcutKey, hasSelection: boolean): TerminalKey {
  if (e.type !== 'keydown' || e.altKey || !(e.ctrlKey || e.metaKey)) return null
  const key = e.key.toLowerCase()
  if (key === 'c' && (e.shiftKey || hasSelection)) return 'copy'
  if (key === 'v') return 'paste'
  return matchAppShortcut(e) ? 'app' : null
}
