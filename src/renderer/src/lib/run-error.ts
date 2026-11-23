import type { ChatItem } from '@shared/chat'

/**
 * The error a run ended with, for the line under the chat, or null when the chat shows it already:
 * a CLI that fails a turn often exits with the same text on stderr (Claude Code's
 * „No conversation found …“), which would stand there twice.
 */
export function runErrorToShow(items: readonly ChatItem[], error: string | undefined): string | null {
  const text = error?.trim()
  if (!text) return null
  const same = (shown: string | undefined) => !!shown?.trim() && (shown.includes(text) || text.includes(shown.trim()))
  // Only what came after the last prompt: an older turn with the same error doesn't say this one.
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'user') break
    if (item.kind === 'turn' && same(item.error)) return null
    if (item.kind === 'notice' && item.level === 'error' && (same(item.detail) || same(item.text))) return null
  }
  return text
}
