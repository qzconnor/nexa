/** A file as a Read shows it: its lines with their numbers, and what the CLI says below them. */
export interface NumberedOutput {
  lines: { n: number; text: string }[]
  /** Claude Code's notes after the lines (a file cut short, one that isn't UTF-8 …), for the model. */
  note: string
}

/**
 * Number, tab (an arrow in older versions of Claude Code), the line itself: as `cat -n` writes. The
 * number alone: an empty last line, its tab trimmed off with the output's end.
 */
const NUMBERED = /^\s*(\d+)(?:(?:\t|→)(.*))?$/

/**
 * Claude Code's Read answers with the file's lines numbered, so a line's number reads as part of
 * it. Taken apart, the numbers can stand in a column of their own. Null for an answer that isn't
 * numbered so (an image, an error, an empty file).
 */
export function numberedLines(output: string): NumberedOutput | null {
  const all = output.split('\n')
  const lines: NumberedOutput['lines'] = []
  let i = 0
  for (; i < all.length; i++) {
    const match = NUMBERED.exec(all[i]!.replace(/\r$/, ''))
    if (!match) break
    lines.push({ n: Number(match[1]), text: match[2] ?? '' })
  }
  if (!lines.length) return null
  const note = all
    .slice(i)
    .join('\n')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .trim()
  return { lines, note }
}
