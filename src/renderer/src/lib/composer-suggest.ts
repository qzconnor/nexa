import type { ProviderId } from '@shared/chat'
import type { CommandOption } from '@shared/types'
import { baseName, foldersOf, parentPath } from './file-tree'

/**
 * What the composer offers to complete at the cursor: a command at the start of the prompt (`/`), a
 * Codex skill anywhere (`$`), a file of the project anywhere (`@`). `from`–`to` is the text it replaces.
 */
export interface SuggestTrigger {
  kind: 'command' | 'skill' | 'file'
  query: string
  from: number
  to: number
}

export type Suggestion = { type: 'command'; option: CommandOption } | { type: 'file'; path: string; dir: boolean }

/** The trigger at the cursor, or null; the word after the cursor belongs to it and is replaced too. */
export function triggerAt(text: string, cursor: number, provider: ProviderId): SuggestTrigger | null {
  const before = text.slice(0, cursor)
  const to = cursor + (/^\S*/.exec(text.slice(cursor))?.[0].length ?? 0)
  // Both CLIs take commands only as the prompt's first word.
  const command = /^\/(\S*)$/.exec(before)
  if (command) return { kind: 'command', query: command[1]!, from: 0, to }
  if (provider === 'codex') {
    const skill = /(?:^|\s)\$([\w.:-]*)$/.exec(before)
    if (skill) return { kind: 'skill', query: skill[1]!, from: cursor - skill[1]!.length - 1, to }
  }
  // A path with spaces goes in quotes; the quote is open while it is written.
  const quoted = /(?:^|\s)@"([^"]*)$/.exec(before)
  if (quoted) return { kind: 'file', query: quoted[1]!, from: cursor - quoted[1]!.length - 2, to: closingQuote(text, cursor, to) }
  const file = /(?:^|\s)@([^\s"]*)$/.exec(before)
  if (file) return { kind: 'file', query: file[1]!, from: cursor - file[1]!.length - 1, to }
  return null
}

/** The end of a quoted path the cursor is in: past its closing quote, when there is one on the line. */
function closingQuote(text: string, cursor: number, wordEnd: number): number {
  const close = text.indexOf('"', cursor)
  return close !== -1 && !text.slice(cursor, close).includes('\n') ? close + 1 : wordEnd
}

/**
 * The commands that fit what is typed, best first: the name itself, its start, the start of a part
 * of it (`rea:inv` and `inv` for `rea:investigate`), an alias, anywhere in the name, the description.
 * Without a query, in the order of the CLI.
 */
export function filterCommands(list: readonly CommandOption[], query: string, kind?: CommandOption['kind'], limit = 60): CommandOption[] {
  const pool = kind ? list.filter((c) => c.kind === kind) : list
  const needle = query.trim().toLowerCase()
  if (!needle) return pool.slice(0, limit)
  const score = (c: CommandOption): number | null => {
    const name = c.name.toLowerCase()
    if (name === needle) return 0
    if (name.startsWith(needle)) return 1
    if (name.split(/[:_\-. ]/).some((part) => part.startsWith(needle))) return 2
    if (c.aliases?.some((a) => a.toLowerCase().startsWith(needle))) return 3
    if (name.includes(needle)) return 4
    if (c.description?.toLowerCase().includes(needle)) return 5
    return null
  }
  return pool
    .map((c, index) => ({ c, index, score: score(c) }))
    .filter((hit): hit is { c: CommandOption; index: number; score: number } => hit.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((hit) => hit.c)
}

const byFolderThenName = (a: { path: string; dir: boolean }, b: { path: string; dir: boolean }) =>
  Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path, undefined, { sensitivity: 'base' })

/**
 * Files and folders (`paths`: the project's files, relative) that fit what follows `@`: a folder's
 * entries when it ends in `/` (and the top level for nothing), else by name — the name itself, its
 * start, anywhere in it, anywhere in the path — shorter paths first.
 */
export function findPaths(paths: readonly string[], query: string, limit = 60): { path: string; dir: boolean }[] {
  const needle = query.replace(/\\/g, '/').toLowerCase()
  const entries = [...foldersOf(paths).map((path) => ({ path, dir: true })), ...paths.map((path) => ({ path, dir: false }))]
  if (!needle || needle.endsWith('/')) {
    const dir = needle.replace(/\/+$/, '')
    return entries
      .filter((e) => parentPath(e.path).toLowerCase() === dir)
      .sort(byFolderThenName)
      .slice(0, limit)
  }
  const byPath = needle.includes('/')
  const score = (path: string): number | null => {
    const lower = path.toLowerCase()
    const name = baseName(lower)
    if (byPath) {
      if (lower === needle) return 0
      if (lower.startsWith(needle)) return 1
      return lower.includes(needle) ? 3 : null
    }
    if (name === needle) return 0
    if (name.startsWith(needle)) return 1
    if (name.includes(needle)) return 2
    if (lower.includes(needle)) return 3
    return null
  }
  return entries
    .map((e) => ({ ...e, score: score(e.path) }))
    .filter((e): e is { path: string; dir: boolean; score: number } => e.score !== null)
    .sort((a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, limit)
    .map(({ path, dir }) => ({ path, dir }))
}

/**
 * What a suggestion puts in place of its trigger. A folder stays open (no space, a quote left open)
 * so its entries come next.
 */
export function suggestionText(suggestion: Suggestion): string {
  if (suggestion.type === 'command') return `${suggestion.option.insert} `
  const path = suggestion.path.replace(/\\/g, '/')
  const spaced = /\s/.test(path)
  if (suggestion.dir) return spaced ? `@"${path}/` : `@${path}/`
  return spaced ? `@"${path}" ` : `@${path} `
}

/** The text with a suggestion applied and where the cursor goes. */
export function applySuggestion(text: string, trigger: SuggestTrigger, suggestion: Suggestion): { text: string; cursor: number } {
  const insert = suggestionText(suggestion)
  // A space that follows already is kept instead of doubled.
  const rest = text.slice(trigger.to)
  const piece = insert.endsWith(' ') && /^\s/.test(rest) ? insert.slice(0, -1) : insert
  return { text: text.slice(0, trigger.from) + piece + rest, cursor: trigger.from + piece.length + (piece === insert ? 0 : 1) }
}
