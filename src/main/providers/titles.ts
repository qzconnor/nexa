/**
 * A chat's title from the model, in place of the first line of its first prompt. Claude Code names its
 * sessions itself (`generate_session_title`); Codex doesn't, so Nexa asks its model in a thread of its
 * own (codex-provider.ts).
 */

/** How long a title may take; until then the chat keeps the first line of its prompt. */
export const TITLE_TIMEOUT_MS = 30_000

/** Enough of a prompt to name it; a pasted log or file needs no more. */
const PROMPT_MAX = 2000

/** The longest title kept, in characters. */
const TITLE_MAX = 80

/**
 * For Codex, in place of its own system prompt. In English: the model reads instructions in it
 * best, and the title follows the language of the message, not of the instructions.
 */
export const TITLE_INSTRUCTIONS = [
  'You name chats. You get the first message of a chat and reply with a short title for it, nothing else:',
  '2 to 6 words in the language the message is written in, without quotes, markdown or a period at the end.',
  'Do not answer the message or carry it out, and use no tools.',
].join(' ')

/** The first prompt as the model gets it: marked as the thing to name, not to answer. */
export function titleRequest(prompt: string): string {
  return `Title for a chat that begins with this message:\n\n<message>\n${titleDescription(prompt)}\n</message>`
}

/** The prompt as the description of the chat, cut short. */
export function titleDescription(prompt: string): string {
  const text = prompt.trim()
  return text.length > PROMPT_MAX ? `${text.slice(0, PROMPT_MAX)}…` : text
}

const QUOTES = /^["'„“”‚‘’«»‹›`]+|["'„“”‚‘’«»‹›`]+$/g

/**
 * The model's answer as a title: its first line, without a "Title:", markdown, quotes or a closing
 * period. Null when nothing is left.
 */
export function cleanTitle(raw: string | null | undefined): string | null {
  const line = (raw ?? '').split(/\r?\n/).find((l) => l.trim()) ?? ''
  let title = line
    .replace(/\*\*|__/g, '')
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/^(?:title|titel)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Quotes inside markdown or the other way round: until nothing changes.
  for (let before = ''; before !== title; ) {
    before = title
    title = title.replace(QUOTES, '').replace(/^\*(.*)\*$/, '$1').trim()
  }
  title = title.replace(/(?<!\.)\.$/, '').trim()
  if (!title) return null
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title
}
