import type { ToolItem } from './chat'
import type { FileTouch } from './files'
import { isPlainObject } from './utils'

/** The most files of a search that light up. */
const MAX_FOUND = 20

const READING_TOOLS = new Set(['Read'])
const WRITING_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const SEARCH_TOOLS = new Set(['Grep', 'Glob'])

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** `C:\…`, `\\server\…` or `/…`. */
export function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]/.test(path)
}

/** `path` from `cwd`, without `.` and `..`; works in the window too, which has no `node:path`. */
export function resolvePath(cwd: string, path: string, windows: boolean): string {
  const sep = windows ? '\\' : '/'
  const joined = isAbsolutePath(path) ? path : `${cwd.replace(/[\\/]+$/, '')}${sep}${path}`
  const unc = windows && /^[\\/]{2}/.test(joined)
  const parts: string[] = []
  for (const part of joined.split(/[\\/]+/)) {
    if (part === '.' || (part === '' && parts.length > 0)) continue
    if (part === '..') {
      if (parts.length > 1) parts.pop()
      continue
    }
    parts.push(part)
  }
  const result = parts.join(sep)
  return unc ? `${sep}${sep}${result.replace(/^[\\/]+/, '')}` : result || sep
}

/**
 * The files a search (Grep, Glob) found, as it printed them: one per line, or with Grep's lines the
 * file at their start (`path:12:text`).
 */
export function foundFiles(output: string | undefined): string[] {
  if (!output) return []
  const names = new Set<string>()
  for (const line of output.split('\n', 2000)) {
    const trimmed = line.trim()
    if (!trimmed || /^(Found \d+|No (files|matches) found)/i.test(trimmed)) continue
    const match = /^(.+?)([:-])\d+\2/.exec(trimmed) ?? /^(.+):\d+$/.exec(trimmed)
    names.add(match ? match[1] : trimmed)
    if (names.size >= MAX_FOUND) break
  }
  return [...names]
}

/**
 * The files a tool item names: what it reads and writes (`touches`), and what may be files (`maybe`:
 * a search's folder and hits, a path Codex reads relative to its folder). Shell commands are left to
 * the main process, which sees what they change (main/files/file-activity.ts).
 */
export function toolTouches(item: ToolItem, cwd: string, windows: boolean): { touches: FileTouch[]; maybe: FileTouch[] } {
  const input = isPlainObject(item.input) ? item.input : null
  const itemCwd = text(input?.cwd) ?? cwd
  const at = (file: string) => resolvePath(itemCwd, file, windows)
  const touches: FileTouch[] = []
  const maybe: FileTouch[] = []
  for (const change of item.changes ?? []) {
    touches.push({ path: at(change.path), kind: 'write' })
    if (change.movePath) touches.push({ path: at(change.movePath), kind: 'write' })
  }
  const file = text(input?.file_path) ?? text(input?.notebook_path)
  if (file && READING_TOOLS.has(item.name)) touches.push({ path: at(file), kind: 'read' })
  if (file && WRITING_TOOLS.has(item.name) && !item.changes?.length) touches.push({ path: at(file), kind: 'write' })
  if (SEARCH_TOOLS.has(item.name)) {
    const folder = text(input?.path)
    if (folder) maybe.push({ path: at(folder), kind: 'search' })
    if (item.status === 'done') for (const found of foundFiles(item.output)) maybe.push({ path: at(found), kind: 'search' })
  }
  if (item.name === 'commandExecution' && item.tool === 'read' && item.detail) maybe.push({ path: at(item.detail), kind: 'read' })
  return { touches, maybe }
}
