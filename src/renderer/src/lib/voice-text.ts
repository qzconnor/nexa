/**
 * Where dictated words go in the composer: at the cursor (in place of a selection) when the take
 * started, with a space to the words around them where none is.
 */

export interface VoiceAnchor {
  /** The text before the cursor at the start of the take. */
  head: string
  /** The text after it (after the selection). */
  tail: string
}

export function voiceAnchor(text: string, start: number, end: number): VoiceAnchor {
  return { head: text.slice(0, start), tail: text.slice(end) }
}

/** The take's utterances one after another: those closed, then the one still being heard. */
export function spokenText(final: readonly string[], interim: string): string {
  return [...final, interim]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
}

/** The composer's text with the spoken words at the anchor, and the cursor right after them. */
export function withSpoken(anchor: VoiceAnchor, spoken: string): { text: string; cursor: number } {
  const words = spoken.trim()
  const { head, tail } = anchor
  if (!words) return { text: head + tail, cursor: head.length }
  const before = head && !/\s$/.test(head) ? ' ' : ''
  // Punctuation typed after the cursor goes right on the last word.
  const after = tail && !/^[\s.,;:!?)\]}]/.test(tail) ? ' ' : ''
  return { text: `${head}${before}${words}${after}${tail}`, cursor: head.length + before.length + words.length }
}

/**
 * The level of a piece of the recording for the meter, from 0 (silence) to 1: its loudness on a
 * scale of decibels, -60 dB and below counting as nothing (room noise), -15 dB as full.
 */
export function voiceLevel(rms: number): number {
  if (!(rms > 0)) return 0
  const db = 20 * Math.log10(rms)
  return Math.max(0, Math.min(1, (db + 60) / 45))
}
