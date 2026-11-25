import type { InteractionRequest } from '@shared/chat'
import type { UsageWindow } from '@shared/types'
import type { Attention } from '../services/session-service'
import type { NearLimit } from './near-limit'

/** Longest text of an answer, command or question in a notification. */
const MAX_DETAIL_CHARS = 180

export interface NotificationText {
  title: string
  /** The line below the chat's title; null: only the title. */
  detail: string | null
}

/**
 * Heading and second line of a chat's notification; the chat's title comes in between. `agent`:
 * the CLI's short name ("Claude", "Codex"). Without `preview` nothing of the chat's content shows,
 * only what happened (and when a limit resets, which isn't content).
 */
export function attentionText(attention: Attention, agent: string, preview: boolean, resetsAt?: number, now = Date.now()): NotificationText {
  switch (attention.kind) {
    case 'limit': {
      const reset = resetsAt ? formatReset(resetsAt, now) : ''
      return { title: 'Limit erreicht', detail: reset ? `Reset ${reset}` : preview ? shorten(attention.message) : null }
    }
    case 'input':
      return inputText(attention.request, agent, preview)
    case 'done':
      if (attention.error) return { title: `${agent} ist auf einen Fehler gestoßen`, detail: preview ? shorten(attention.error) : null }
      return { title: `${agent} ist fertig`, detail: preview ? shorten(plainText(attention.answer)) : null }
  }
}

function inputText(request: InteractionRequest, agent: string, preview: boolean): NotificationText {
  switch (request.type) {
    case 'question':
      return { title: `${agent} hat eine Frage`, detail: preview ? shorten(request.questions[0]?.question) : null }
    case 'plan':
      return { title: `${agent} wartet auf die Freigabe des Plans`, detail: preview ? shorten(plainText(request.plan)) : null }
    case 'elicitation':
      return { title: `„${request.server}“ braucht eine Eingabe`, detail: preview ? shorten(request.message) : null }
    case 'form':
      return { title: `${agent} braucht Angaben von dir`, detail: preview ? shorten(request.title) : null }
    case 'permission': {
      const detail = preview ? shorten(request.detail) : null
      return { title: `${agent} braucht deine Erlaubnis`, detail: detail ? `${request.title}: ${detail}` : request.title }
    }
  }
}

/** The lines of a warning about an account's limits: one per window, e.g. "5 Stunden: 82 %, Reset um 19:40". */
export function nearLimitLines(reached: readonly NearLimit[], now = Date.now()): string[] {
  return reached.map(({ window, percent }) => {
    const reset = window.resetsAt ? formatReset(window.resetsAt, now) : ''
    return `${window.label}: ${percent} %${reset ? `, Reset ${reset}` : ''}`
  })
}

/** When the limit a chat stopped at resets: the latest reset of the windows that are full, if known. */
export function limitReset(windows: readonly UsageWindow[]): number | undefined {
  const full = windows.filter((w) => w.usedPercent >= 100 && w.resetsAt)
  return full.length ? Math.max(...full.map((w) => w.resetsAt!)) : undefined
}

/** Short weekdays by hand: the ICU data of Node and Electron abbreviate them differently ("Fr" or "Fr."). */
const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']

/** "um 19:40", on another day "Fr. 19:40". */
export function formatReset(at: number, now = Date.now()): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return ''
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  if (date.toDateString() === new Date(now).toDateString()) return `um ${time}`
  return `${WEEKDAYS[date.getDay()]} ${time}`
}

/** Markdown of an answer as plain text on one line; code blocks are left out. */
export function plainText(markdown: string | null | undefined): string | null {
  if (!markdown) return null
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|>[ \t]?)/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/** Text on one line, cut with an ellipsis; null without text. */
function shorten(text: string | null | undefined): string | null {
  const single = text?.replace(/\s+/g, ' ').trim()
  if (!single) return null
  return single.length > MAX_DETAIL_CHARS ? `${single.slice(0, MAX_DETAIL_CHARS - 1)}…` : single
}
