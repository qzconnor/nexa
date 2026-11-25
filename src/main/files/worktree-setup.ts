import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WorktreeBaseChoice, WorktreeIncludePreview } from '@shared/files'
import { pool } from '../lib/pool'

/**
 * What a new worktree of a chat gets besides its checkout, as Claude Code sets one up after
 * `claude --worktree` (see docs/ARCHITECTURE.md, „Chats in Worktrees“): the files `.worktreeinclude`
 * names, and where it branches from by default.
 */

/** The file in the main checkout that names what a new worktree copies of the files git ignores. */
export const WORKTREE_INCLUDE = '.worktreeinclude'

/** A line of `.worktreeinclude`, in `.gitignore` syntax. */
interface IncludeRule {
  negate: boolean
  /** Matches directories only (a trailing `/`). */
  dirOnly: boolean
  /** Against the whole path relative to the main checkout, `/`-separated. */
  regex: RegExp
}

/** The patterns of `.worktreeinclude` as Claude Code reads them for its directory check: trimmed, without blanks and comments. */
export function includePatterns(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

/** The rules of `.worktreeinclude` (`.gitignore` syntax: `!`, `/`, `*`, `?`, `[…]`, `**`). */
export function parseIncludeRules(text: string): IncludeRule[] {
  const rules: IncludeRule[] = []
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    // git drops trailing spaces unless one is escaped.
    let line = raw.replace(/(?<!\\)\s+$/, '')
    if (!line.trim() || line.startsWith('#')) continue
    let negate = false
    if (line.startsWith('!')) {
      negate = true
      line = line.slice(1)
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1)
    let dirOnly = false
    while (line.endsWith('/')) {
      dirOnly = true
      line = line.slice(0, -1)
    }
    if (!line) continue
    // A slash at the start or in the middle ties the pattern to the main checkout; else it matches at any depth.
    const anchored = line.includes('/')
    if (line.startsWith('/')) line = line.slice(1)
    const body = globRegex(line)
    // Case is ignored as Claude Code's matcher (the `ignore` package) does by default.
    rules.push({ negate, dirOnly, regex: new RegExp(`^${anchored ? '' : '(?:.*/)?'}${body}$`, 'i') })
  }
  return rules
}

function globRegex(pattern: string): string {
  const segments = pattern.split('/')
  let out = ''
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1
    if (segment === '**') out += last ? '.*' : '(?:.*/)?'
    else out += segmentRegex(segment) + (last ? '' : '/')
  })
  return out
}

const escapeRegex = (c: string) => c.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

function segmentRegex(segment: string): string {
  let out = ''
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!
    if (c === '\\' && i + 1 < segment.length) {
      out += escapeRegex(segment[++i]!)
    } else if (c === '*') {
      // `**` inside a name is a plain `*`.
      while (segment[i + 1] === '*') i++
      out += '[^/]*'
    } else if (c === '?') out += '[^/]'
    else if (c === '[') {
      const end = classEnd(segment, i)
      if (end < 0) out += '\\['
      else {
        out += classRegex(segment.slice(i + 1, end))
        i = end
      }
    } else out += escapeRegex(c)
  }
  return out
}

/** Where the bracket expression starting at `start` ends; -1 without its `]` (then `[` is literal). */
function classEnd(segment: string, start: number): number {
  let i = start + 1
  if (segment[i] === '!' || segment[i] === '^') i++
  // A `]` right at the start belongs to the set.
  if (segment[i] === ']') i++
  for (; i < segment.length; i++) {
    if (segment[i] === '\\') i++
    else if (segment[i] === ']') return i
  }
  return -1
}

function classRegex(body: string): string {
  let negate = false
  if (body.startsWith('!') || body.startsWith('^')) {
    negate = true
    body = body.slice(1)
  }
  let set = ''
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c === '\\' && i + 1 < body.length) set += `\\${body[++i]}`
    else if (c === '-') set += '-'
    else set += c.replace(/[\]\\^[]/g, '\\$&')
  }
  // Like `*` and `?`, a set never takes the separator.
  return negate ? `[^/${set}]` : `(?![/])[${set}]`
}

/**
 * Whether the rules take a path (relative, `/`-separated): the last rule that matches it decides, and a
 * folder they take brings everything in it along, as in git (`ignore` checks the parents first too).
 */
export function includeMatcher(rules: readonly IncludeRule[]): (path: string, dir: boolean) => boolean {
  const decide = (path: string, dir: boolean): boolean => {
    let taken = false
    for (const rule of rules) {
      if (rule.dirOnly && !dir) continue
      if (rule.regex.test(path)) taken = !rule.negate
    }
    return taken
  }
  const folders = new Map<string, boolean>()
  const folder = (path: string): boolean => {
    let known = folders.get(path)
    if (known === undefined) folders.set(path, (known = decide(path, true)))
    return known
  }
  return (path, dir) => {
    const segments = path.split('/')
    for (let i = 1; i < segments.length; i++) if (folder(segments.slice(0, i).join('/'))) return true
    return dir ? folder(path) : decide(path, false)
  }
}

/**
 * Whether files in `dir` (ending with `/`), a folder git ignores as a whole, can match: Claude Code only
 * lists such a folder when a pattern names a path in it, starts with its name up to the first wildcard,
 * names one of its folders right after a leading `**` and slash, or takes the folder itself. So `.env`
 * (any depth) doesn't search `node_modules/`, while `vendor/` followed by `**` and `config.json` searches
 * `vendor/`. Listing every ignored folder would read all of `node_modules` for a single `.env`.
 */
export function reachesInto(dir: string, patterns: readonly string[], included: (path: string, dir: boolean) => boolean): boolean {
  const names = dir
    .slice(0, -1)
    .split('/')
    .map((name) => name.toLowerCase())
  for (const raw of patterns) {
    const pattern = raw.startsWith('/') ? raw.slice(1) : raw
    if (pattern.startsWith(dir)) return true
    const wildcard = pattern.search(/[*?[]/)
    if (wildcard > 0 && dir.startsWith(pattern.slice(0, wildcard))) return true
    let rest = pattern
    while (rest.startsWith('**/')) rest = rest.slice(3)
    if (rest === pattern) continue
    const first = rest.split('/')[0] ?? ''
    const glob = first.search(/[*?[]/)
    const literal = (glob === -1 ? first : first.slice(0, glob)).replace(/\\/g, '').toLowerCase()
    if (literal && (glob === -1 ? names.includes(literal) : names.some((name) => name.startsWith(literal)))) return true
  }
  return included(dir.slice(0, -1), true)
}

/** The worktrees themselves: never copied into one another (nor a new one into itself). */
export function inWorktreesFolder(path: string): boolean {
  return /^\.claude\/worktrees(?:\/|$)/i.test(path)
}

/**
 * The files `.worktreeinclude` takes, from git's list of what it ignores in the main checkout: the files
 * of `ignored` (`git ls-files --others --ignored --exclude-standard --directory`), and for the folders in it
 * that a pattern reaches (`reachesInto`), the files `listIn` names in them. Null without patterns.
 */
export async function pickIncluded(
  text: string,
  ignored: readonly string[],
  listIn: (dirs: string[]) => Promise<string[]>,
): Promise<string[] | null> {
  const patterns = includePatterns(text)
  if (!patterns.length) return null
  const included = includeMatcher(parseIncludeRules(text))
  const entries = ignored.filter((entry) => entry && !inWorktreesFolder(entry))
  const files = new Set(entries.filter((entry) => !entry.endsWith('/') && included(entry, false)))
  const dirs = entries.filter((entry) => entry.endsWith('/') && reachesInto(entry, patterns, included))
  if (dirs.length) {
    for (const entry of await listIn(dirs)) {
      if (entry && !entry.endsWith('/') && !inWorktreesFolder(entry) && included(entry, false)) files.add(entry)
    }
  }
  return [...files]
}

/** Files named more than this aren't added up for the dialog: counting their sizes would take as long as copying. */
const MAX_SIZED = 2000
/** Files named in the dialog. */
const SAMPLE = 5

/** What the dialog says of the files a new worktree gets: how many, a few of them and their size. */
export async function includePreview(root: string, files: readonly string[]): Promise<WorktreeIncludePreview> {
  if (files.length > MAX_SIZED) return { files: files.length, sample: files.slice(0, SAMPLE), bytes: null }
  let bytes = 0
  await pool(files, 16, async (file) => {
    const stat = await lstat(join(root, ...file.split('/'))).catch(() => null)
    if (stat?.isFile()) bytes += stat.size
  })
  return { files: files.length, sample: files.slice(0, SAMPLE), bytes }
}

export interface IncludeCopy {
  /** Copied, relative to the main checkout. */
  copied: string[]
  /** Not copied on purpose: a link, no plain file, a file the checkout has already, or a link on the way in the worktree. */
  skipped: string[]
  failed: { path: string; error: string }[]
}

/**
 * Copies the files (relative to `from`, `/`-separated) into the new worktree `to`, as Claude Code does:
 * never a link (nor through one: git doesn't list files behind a linked folder, and a link on the way in
 * the worktree stops the file), and never over a file the checkout has (tracked on its branch).
 */
export async function copyIncluded(from: string, to: string, files: readonly string[]): Promise<IncludeCopy> {
  const result: IncludeCopy = { copied: [], skipped: [], failed: [] }
  const target = await realpath(to).catch(() => null)
  if (!target) {
    result.failed.push(...files.map((path) => ({ path, error: 'Den Worktree gibt es nicht.' })))
    return result
  }
  await pool(files, 8, async (path) => {
    const segments = path.split('/')
    if (!path || segments.some((s) => !s || s === '.' || s === '..') || /^[a-z]:/i.test(path)) {
      result.skipped.push(path)
      return
    }
    try {
      const source = await lstat(join(from, ...segments))
      if (!source.isFile()) {
        result.skipped.push(path)
        return
      }
      if (!(await safeFolders(target, segments.slice(0, -1)))) {
        result.skipped.push(path)
        return
      }
      await copyFile(join(from, ...segments), join(target, ...segments), constants.COPYFILE_EXCL)
      result.copied.push(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') result.skipped.push(path)
      else result.failed.push({ path, error: error instanceof Error ? error.message : String(error) })
    }
  })
  return result
}

/**
 * Makes the folders on the way to a file in the worktree, one by one: any that is there must be a plain
 * folder. A link there (a tracked symlink, a junction) would let the copy write outside the worktree.
 */
async function safeFolders(root: string, segments: readonly string[]): Promise<boolean> {
  let path = root
  for (const segment of segments) {
    path = join(path, segment)
    let stat = await lstat(path).catch(() => null)
    if (!stat) {
      await mkdir(path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      stat = await lstat(path)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false
  }
  return true
}

/**
 * Claude Code's `worktree.baseRef` (`fresh`: the default branch of `origin`; `head`: the state of the
 * folder): local settings of the checkout over its project settings over the user's.
 */
export async function claudeBaseRef(root: string, configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')): Promise<WorktreeBaseChoice> {
  const files = [join(root, '.claude', 'settings.local.json'), join(root, '.claude', 'settings.json'), join(configDir, 'settings.json')]
  for (const file of files) {
    try {
      const value = (JSON.parse(await readFile(file, 'utf8')) as { worktree?: { baseRef?: unknown } })?.worktree?.baseRef
      if (value === 'head' || value === 'fresh') return value
    } catch {
      // Missing or not JSON: Claude Code skips it as well.
    }
  }
  return 'fresh'
}
