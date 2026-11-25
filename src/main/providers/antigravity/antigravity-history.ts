import type { ChatItem } from '@shared/chat'
import { promptTimes, USER_STEP, type AntigravityStep } from './antigravity-conversations'

/** What Nexa put before a prompt of its own: its instructions (older versions) and a handoff's context. */
const NEXA_BLOCK = /^\s*<(nexa-instructions|nexa-context)>[\s\S]*?<\/\1>\s*/

/**
 * A prompt of a read conversation as the user wrote it, without Nexa's blocks before it; the context
 * of a handoff when that was all of it (it becomes the chat's hidden handoff item).
 */
export function promptOf(text: string): { text: string; context?: string } {
  let rest = text
  let context: string | undefined
  for (let match = NEXA_BLOCK.exec(rest); match; match = NEXA_BLOCK.exec(rest)) {
    if (match[1] === 'nexa-context') context = match[0].trim()
    rest = rest.slice(match[0].length)
  }
  return rest.trim() || !context ? { text: rest } : { text: '', context }
}

function stamped(item: ChatItem, ts: number): ChatItem {
  if (item.kind === 'user') {
    const prompt = promptOf(item.text)
    return prompt.context !== undefined ? { ...item, ts, text: prompt.context, handoff: true } : { ...item, ts, text: prompt.text }
  }
  // Its stream names no durations: a tool started and ended at its place.
  if (item.kind === 'tool') return { ...item, ts, startedAt: ts, ...(item.endedAt !== undefined ? { endedAt: ts } : {}) }
  return { ...item, ts }
}

/**
 * The items of a read conversation (antigravity-run.ts `replay`) with the times of its steps, which
 * its stream doesn't name. A prompt gets its step's time, what follows counts on from there by the
 * millisecond, a turn's end gets its last step's time. Without a time for every prompt they count
 * back from the conversation's last one. `since` (ms): only the turns of prompts made after it; none
 * when the times can't tell.
 */
export function stampHistory(items: readonly ChatItem[], steps: readonly AntigravityStep[], since?: number): ChatItem[] {
  const prompts = promptTimes(steps)
  const aligned = prompts !== null && prompts.length === items.filter((i) => i.kind === 'user').length
  if (since !== undefined && !aligned) return []
  const ends: number[] = []
  if (aligned) {
    let turn = -1
    for (const step of steps) {
      if (step.type === USER_STEP) ends[++turn] = step.at!
      else if (turn >= 0 && step.at !== null) ends[turn] = Math.max(ends[turn]!, step.at)
    }
  }
  const last = steps.reduce((max, step) => Math.max(max, step.at ?? 0), 0) || Date.now()
  const out: ChatItem[] = []
  let turn = -1
  let base = aligned ? (prompts[0] ?? last) : last - items.length
  let n = 0
  items.forEach((item, i) => {
    if (item.kind === 'user') {
      turn++
      n = 0
      if (aligned) base = prompts[turn]!
    }
    let ts = aligned ? base + n : last - items.length + i
    if (aligned && item.kind === 'turn' && turn >= 0) ts = Math.max(ends[turn]!, ts)
    n++
    if (since !== undefined && (turn < 0 || prompts![turn]! <= since)) return
    out.push(stamped(item, ts))
  })
  return out
}
