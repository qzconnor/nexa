import type { ChatItem, ProviderId } from '@shared/chat'
import { foldText, matchSpans } from '@shared/search'
import type { SessionSearchHit } from '@shared/types'

/** A message beyond this is mostly pasted logs or code: only its beginning is searched. */
const MAX_MESSAGE = 40_000
/** Characters of a snippet before the place found, and in all. */
const SNIPPET_BEFORE = 40
const SNIPPET_LENGTH = 180

/** A prompt or an answer of a chat, with its text folded once for every search (see `foldText`). */
export interface ChatText {
  role: 'user' | 'assistant'
  provider: ProviderId
  text: string
  folded: string
}

/** The prompts and answers of the main thread: what the user remembers of a chat, not the tools' output or a subagent's work. */
export function chatTexts(items: readonly ChatItem[]): ChatText[] {
  const texts: ChatText[] = []
  for (const item of items) {
    if ((item.kind !== 'user' && item.kind !== 'assistant') || item.parentId) continue
    const text = item.text.slice(0, MAX_MESSAGE)
    if (!text.trim()) continue
    texts.push({ role: item.kind, provider: item.provider, text, folded: foldText(text) })
  }
  return texts
}

/** The words around `at` on one line, with "…" where they are cut. */
function snippetAt(text: string, at: number): string {
  let start = Math.max(0, at - SNIPPET_BEFORE)
  // Not in the middle of a word.
  if (start > 0) {
    const space = text.lastIndexOf(' ', start)
    if (space > at - SNIPPET_BEFORE * 2) start = space + 1
  }
  const end = Math.min(text.length, start + SNIPPET_LENGTH)
  const line = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${line}${end < text.length ? '…' : ''}`
}

/**
 * Whether the chat holds every term, across all its messages; then the message with the most of them
 * (the first of those) and a snippet around the longest term in it, which says the most.
 */
export function findInChat(texts: readonly ChatText[], terms: readonly string[]): Omit<SessionSearchHit, 'sessionId'> | null {
  const folded = terms.map(foldText).filter(Boolean)
  if (folded.length === 0) return null
  if (!folded.every((term) => texts.some((t) => t.folded.includes(term)))) return null

  let best: ChatText | undefined
  let bestCount = 0
  for (const text of texts) {
    const count = folded.filter((term) => text.folded.includes(term)).length
    if (count > bestCount) {
      best = text
      bestCount = count
      if (count === folded.length) break
    }
  }
  if (!best) return null
  const longest = folded.filter((term) => best.folded.includes(term)).sort((a, b) => b.length - a.length)[0]!
  // `matchSpans` keeps the text's positions; where folding changed the length, the place in the folded text is close enough.
  const at = matchSpans(best.text, [longest])[0]?.[0] ?? best.folded.indexOf(longest)
  return { role: best.role, provider: best.provider, snippet: snippetAt(best.text, Math.max(0, at)) }
}
