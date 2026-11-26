import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, parse, relative, resolve, sep } from 'node:path'
import type {
  ChangedFile,
  ChatChanges,
  FileChangeStatus,
  FileChangeSummary,
  PromptChanges,
  RewindFile,
  RewindPreview,
  RewindResult,
} from '@shared/checkpoints'
import type { FileDiff } from '@shared/files'
import { folderKey, inFolder } from '@shared/folders'
import { readJson, writeJsonAtomic } from '../lib/json-file'
import { pool } from '../lib/pool'
import { decodeText, decodeUtf16, isUtf16 } from '../lib/text-encoding'
import { IMAGE_TYPES } from './file-tree-service'

// Nexa's checkpoints: the chat's folders before each prompt and at the end of its turn, in a git
// repository of Nexa's own beside the folder (`--git-dir` in Nexa's data, `--work-tree` the folder).
// The same for every CLI: Claude Code keeps no file history in `-p` mode unless asked to, Codex's
// `thread/revert` leaves the files as they are and ACP has nothing of the kind. The project's own
// repository is never touched: no index, no refs, no stash of it.

/** Bigger files are left out (and named as such): a checkpoint is for code, not for builds and media. */
const MAX_FILE_BYTES = 5 * 1024 * 1024
/** The first checkpoint of a folder hashes every file in it: past this it isn't worth it (a home folder, a disk). */
const MAX_FIRST_FILES = 30_000
const MAX_FIRST_BYTES = 500 * 1024 * 1024
/** A folder found too big isn't counted again on every prompt. */
const TOO_LARGE_RETRY_MS = 10 * 60_000
/** git's output held in memory at most (a blob batch, a listing). */
const MAX_OUTPUT = 256 * 1024 * 1024
/** Blobs read at once when files are restored. */
const BATCH_BYTES = 32 * 1024 * 1024
const DIFF_CONTEXT = 3
const FULL_CONTEXT = 1_000_000
const MAX_PATCH_CHARS = 4 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Left out of every checkpoint, as most projects' `.gitignore` does; a folder without one would
 * otherwise hash its dependencies. The project's own ignore rules apply as well.
 */
const DEFAULT_EXCLUDES = ['node_modules/', '.venv/', 'venv/', '__pycache__/', '.DS_Store', 'Thumbs.db', 'desktop.ini']

/**
 * The same git, whatever the user configured: no line-ending conversion or filters (a file comes back
 * byte for byte), no fsmonitor hooks, no automatic gc (it would drop the snapshots no ref holds yet).
 */
const CONFIG = [
  '-c', 'core.autocrlf=false',
  '-c', 'core.safecrlf=false',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.longpaths=true',
  '-c', 'core.quotepath=false',
  '-c', 'core.fscache=true',
  '-c', 'gc.auto=0',
  '-c', 'maintenance.auto=false',
  '-c', 'diff.noprefix=false',
  '-c', 'diff.mnemonicPrefix=false',
  '-c', 'color.ui=false',
]

/** A file left out of a snapshot, with what says whether it changed. */
interface SkippedFile {
  rel: string
  size: number
  mtime: number
}

/** A folder as it was at one moment: a tree in the shadow repository. */
interface Snap {
  tree: string
  skipped?: SkippedFile[]
}

interface RelChange {
  rel: string
  status: FileChangeStatus
  insertions: number | null
  deletions: number | null
}

/** One folder of a checkpoint; `error` when it couldn't be taken. */
interface RootEntry {
  root: string
  before?: Snap
  after?: Snap
  /** What changed from `before` to `after`, counted once at the end of the turn. */
  changes?: RelChange[]
  error?: string
}

interface Entry {
  promptId: string
  at: number
  roots: RootEntry[]
}

interface Undo {
  promptId: string
  at: number
  /** The files as they were before the rewind; `rels`, the ones it changed. */
  roots: { root: string; tree: string; rels: string[] }[]
}

interface SessionFile {
  version: 1
  list: Entry[]
  undo?: Undo
}

/** A message for the user (German), not a failure of git. */
export class CheckpointError extends Error {}

export class Checkpoints {
  private readonly sessions = new Map<string, SessionFile>()
  /** One thing at a time in a shadow repository (its index) and in a chat's file. */
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly ready = new Set<string>()
  private readonly tooLarge = new Map<string, { until: number; reason: string }>()

  constructor(private readonly dir: string) {}

  /**
   * Before a prompt: its folders as they are now. A checkpoint still open (a turn whose end never came,
   * the CLI ended) ends here.
   */
  begin(sessionId: string, promptId: string, roots: readonly string[]): Promise<void> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      const snaps = await Promise.all(outermost(roots).map((root) => this.take(root)))
      const last = data.list.at(-1)
      if (last && isOpen(last)) await this.close(last, new Map(snaps.map((s) => [folderKey(s.root), s])))
      data.list.push({ promptId, at: Date.now(), roots: snaps.map((s) => (s.before ? { root: s.root, before: s.before } : { root: s.root, error: s.error })) })
      await this.save(sessionId, data)
    })
  }

  /**
   * At the end of a turn: what its prompt changed. `next`: a prompt that waited and starts its turn
   * now; its checkpoint begins where this one ends.
   */
  end(sessionId: string, next?: string): Promise<FileChangeSummary | null> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      const last = data.list.at(-1)
      if (!last || !isOpen(last)) return null
      await this.close(last)
      if (next) {
        data.list.push({
          promptId: next,
          at: Date.now(),
          roots: last.roots.map((r) => (r.after ? { root: r.root, before: r.after } : { root: r.root, error: r.error ?? 'Kein Checkpoint' })),
        })
      }
      await this.save(sessionId, data)
      return summarize(last.roots.flatMap((r) => r.changes ?? []))
    })
  }

  /**
   * Each prompt's changes, the newest last; with `live` the running one as far as it got (a snapshot
   * of its folders now), else without files until its turn ends.
   */
  changes(sessionId: string, live = true): Promise<ChatChanges> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      const prompts: PromptChanges[] = []
      for (const entry of data.list) {
        const open = isOpen(entry)
        const files: ChangedFile[] = []
        const skipped: string[] = []
        const unavailable: string[] = []
        for (const r of entry.roots) {
          if (!r.before) {
            unavailable.push(r.error ?? 'Kein Checkpoint')
            continue
          }
          let changes = r.changes
          let after = r.after
          if (!after && open && live) {
            after = await this.snapshot(r.root).catch(() => undefined)
            if (after) changes = await this.diffTrees(this.repoOf(r.root), r.before.tree, after.tree)
          }
          files.push(...(changes ?? []).map((c) => changed(r.root, c)))
          skipped.push(...changedSkipped(r.before, after).map((rel) => absolute(r.root, rel)))
        }
        prompts.push({ promptId: entry.promptId, at: entry.at, open, files, skipped, ...(unavailable.length ? { unavailable: unavailable[0] } : {}) })
      }
      const undo = data.undo ? { promptId: data.undo.promptId, at: data.undo.at, files: data.undo.roots.reduce((n, r) => n + r.rels.length, 0) } : null
      return { prompts, undo }
    })
  }

  /** One file's change by a prompt, as `git diff` shows it. */
  diff(sessionId: string, promptId: string, path: string, full: boolean): Promise<FileDiff> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      const entry = data.list.find((e) => e.promptId === promptId)
      if (!entry) throw new CheckpointError('Für diesen Prompt gibt es keinen Checkpoint.')
      const r = entry.roots.filter((x) => inFolder(path, x.root)).sort((a, b) => b.root.length - a.root.length)[0]
      if (!r?.before) throw new CheckpointError('Diese Datei liegt in keinem Ordner mit Checkpoints.')
      const rel = relative(r.root, path).split(sep).join('/')
      if (!isSafeRel(rel)) throw new CheckpointError('Diese Datei liegt in keinem Ordner mit Checkpoints.')
      const after = r.after ?? (await this.snapshot(r.root))
      return this.fileDiff(this.repoOf(r.root), r.before.tree, after.tree, rel, full)
    })
  }

  /** What rewinding to before `promptId` would do to the files as they are now. */
  preview(sessionId: string, promptId: string): Promise<RewindPreview> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      const plan = await this.plan(data, promptId)
      return { promptId, files: plan.roots.flatMap((p) => p.files), skipped: plan.skipped, ...(plan.unavailable ? { unavailable: plan.unavailable } : {}) }
    })
  }

  /**
   * Puts the files the agent changed from `promptId` on back as they were before it: their contents,
   * files it made go, files it deleted come back. What they are now is kept for `undo`.
   */
  rewind(sessionId: string, promptId: string): Promise<RewindResult & { files: number; rels: string[] }> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      const plan = await this.plan(data, promptId)
      if (plan.unavailable && plan.roots.length === 0) throw new CheckpointError(plan.unavailable)
      const failed: RewindResult['failed'] = []
      let files = 0
      for (const p of plan.roots) {
        if (p.files.length === 0) continue
        const done = await this.restore(p.repo, p.root, p.target, p.files.map((f) => f.rel))
        files += done.done
        failed.push(...done.failed)
      }
      data.undo = { promptId, at: Date.now(), roots: plan.roots.filter((p) => p.files.length).map((p) => ({ root: p.root, tree: p.current, rels: p.files.map((f) => f.rel) })) }
      await this.save(sessionId, data)
      return { files, failed, rels: plan.roots.flatMap((p) => p.files.map((f) => f.path)) }
    })
  }

  /** Takes the last rewind back: the files it changed as they were before it. */
  undo(sessionId: string): Promise<RewindResult> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      const undo = data.undo
      if (!undo) throw new CheckpointError('Es gibt nichts zurückzunehmen.')
      const failed: RewindResult['failed'] = []
      let files = 0
      for (const r of undo.roots) {
        const done = await this.restore(this.repoOf(r.root), r.root, r.tree, r.rels)
        files += done.done
        failed.push(...done.failed)
      }
      delete data.undo
      await this.save(sessionId, data)
      return { files, failed }
    })
  }

  /** A deleted chat: its checkpoints go, and a shadow repository no chat needs any more with them. */
  forget(sessionId: string): Promise<void> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      this.sessions.delete(sessionId)
      await rm(this.fileOf(sessionId), { force: true }).catch(() => undefined)
      for (const repo of new Set(rootsOf(data).map((root) => this.repoOf(root)))) {
        await this.serial(repo, () => this.dropUnused(repo)).catch((error) => console.warn('[checkpoints] repository could not be removed', error))
      }
    })
  }

  /** A chat branched off: it starts with the checkpoints of the one it came from. */
  async copy(from: string, to: string): Promise<void> {
    const data = await this.serial(`session:${from}`, async () => structuredClone(await this.load(from)))
    if (data.list.length === 0) return
    await this.serial(`session:${to}`, () => this.save(to, data))
  }

  /** After an edit: the checkpoints of prompts no longer in the chat go. */
  keep(sessionId: string, promptIds: ReadonlySet<string>): Promise<void> {
    return this.serial(`session:${sessionId}`, async () => {
      const data = await this.load(sessionId)
      const list = data.list.filter((e) => promptIds.has(e.promptId))
      if (list.length === data.list.length) return
      data.list = list
      await this.save(sessionId, data)
    })
  }

  // -------------------------------------------------------------------------------------------
  // Snapshots

  /** A snapshot of `root`, or why there is none. */
  private async take(root: string): Promise<{ root: string; before?: Snap; error?: string }> {
    try {
      return { root, before: await this.snapshot(root) }
    } catch (error) {
      if (!(error instanceof CheckpointError)) console.warn('[checkpoints] snapshot failed', root, error)
      return { root, error: error instanceof CheckpointError ? error.message : 'Der Checkpoint ließ sich nicht anlegen.' }
    }
  }

  /**
   * The folder as it is: the files git doesn't ignore, each up to `MAX_FILE_BYTES`, written into the
   * shadow repository's index (unchanged ones by their stat, as `git status` does) and from there as a tree.
   */
  snapshot(root: string): Promise<Snap> {
    const why = unsafeRoot(root)
    if (why) return Promise.reject(new CheckpointError(why))
    const key = folderKey(root)
    const large = this.tooLarge.get(key)
    if (large && large.until > Date.now()) return Promise.reject(new CheckpointError(large.reason))
    const repo = this.repoOf(root)
    return this.serial(repo, async () => {
      const info = await stat(root).catch(() => null)
      if (!info?.isDirectory()) throw new CheckpointError('Den Ordner gibt es nicht mehr.')
      await this.init(repo, root)
      const first = !(await exists(join(repo, 'index')))
      const others = splitZ(await gitOk(repo, root, ['ls-files', '-z', '--others', '--exclude-standard'], undefined, 120_000))
      const modified = splitZ(await gitOk(repo, root, ['ls-files', '-z', '--modified'], undefined, 120_000))
      const add: string[] = []
      const drop: string[] = []
      const skipped: SkippedFile[] = []
      let bytes = 0
      // An untracked folder that is a repository of its own comes as `sub/`: its files are its own.
      const files = others.filter((rel) => !rel.endsWith('/') && isSafeRel(rel))
      if (first && files.length > MAX_FIRST_FILES) throw this.large(key, 'Der Ordner hat zu viele Dateien für Checkpoints (über 30.000).')
      const known = new Set(modified)
      await pool([...files, ...modified.filter((rel) => isSafeRel(rel))], 32, async (rel) => {
        const tracked = known.has(rel)
        const st = await lstat(absolute(root, rel)).catch(() => null)
        if (!st) {
          if (tracked) add.push(rel)
          return
        }
        const leave = st.isSymbolicLink() || (st.isFile() && st.size > MAX_FILE_BYTES)
        if (leave) skipped.push({ rel, size: st.size, mtime: Math.round(st.mtimeMs) })
        if (leave || !st.isFile()) {
          if (tracked) drop.push(rel)
          return
        }
        bytes += st.size
        add.push(rel)
      })
      if (first && bytes > MAX_FIRST_BYTES) throw this.large(key, 'Der Ordner ist zu groß für Checkpoints (über 500 MB).')
      if (add.length) await gitOk(repo, root, ['update-index', '--add', '--remove', '-z', '--stdin'], joinZ(add), 300_000)
      if (drop.length) await gitOk(repo, root, ['update-index', '--force-remove', '-z', '--stdin'], joinZ(drop), 120_000)
      const tree = (await gitOk(repo, root, ['write-tree'])).toString('utf8').trim()
      skipped.sort((a, b) => a.rel.localeCompare(b.rel))
      return skipped.length ? { tree, skipped } : { tree }
    })
  }

  private large(key: string, reason: string): CheckpointError {
    this.tooLarge.set(key, { until: Date.now() + TOO_LARGE_RETRY_MS, reason })
    return new CheckpointError(reason)
  }

  /** The shadow repository of a folder, made the first time. */
  private async init(repo: string, root: string): Promise<void> {
    if (!this.ready.has(repo)) {
      if (!(await exists(join(repo, 'HEAD')))) {
        await mkdir(repo, { recursive: true })
        await gitOk(repo, null, ['init', '--quiet'])
        await gitOk(repo, null, ['config', 'core.bare', 'false'])
        await writeFile(join(repo, 'nexa-folder'), `${root}\n`)
      }
      await mkdir(join(repo, 'info'), { recursive: true })
      // Above the project's own `.gitattributes`: no filter (LFS), no conversion of line endings.
      await writeFile(join(repo, 'info', 'attributes'), '* -text -filter -ident -working-tree-encoding\n')
      this.ready.add(repo)
    }
    await this.writeExcludes(repo, root)
  }

  /**
   * What git leaves out besides the folder's own `.gitignore` files: the defaults, the exclude file of
   * the project's repository and the rules without a path in the `.gitignore` files above the folder
   * (a subfolder of a repository; `node_modules/` at the top applies in it too).
   */
  private async writeExcludes(repo: string, root: string): Promise<void> {
    const lines = [...DEFAULT_EXCLUDES]
    let dir = resolve(root)
    for (let depth = 0; depth < 12; depth++) {
      const dotGit = join(dir, '.git')
      const st = await stat(dotGit).catch(() => null)
      if (st) {
        const common = st.isDirectory() ? dotGit : await commonDirOf(dotGit, dir)
        if (common) lines.push(...(await readLines(join(common, 'info', 'exclude'))))
        if (dir !== resolve(root)) lines.push(...(await readLines(join(dir, '.gitignore'))).filter(pathless))
        break
      }
      if (dir !== resolve(root)) lines.push(...(await readLines(join(dir, '.gitignore'))).filter(pathless))
      const up = dirname(dir)
      if (up === dir) break
      dir = up
    }
    const text = `${lines.filter((l) => l.trim() && !l.startsWith('#')).join('\n')}\n`
    const file = join(repo, 'info', 'exclude')
    if ((await readFile(file, 'utf8').catch(() => null)) !== text) await writeFile(file, text)
  }

  // -------------------------------------------------------------------------------------------
  // Turns

  /** Ends an open checkpoint: its folders now, and what changed from before it. */
  private async close(entry: Entry, taken?: Map<string, { root: string; before?: Snap; error?: string }>): Promise<void> {
    for (const r of entry.roots) {
      if (!r.before || r.after) continue
      const snap = taken?.get(folderKey(r.root)) ?? (await this.take(r.root))
      if (!snap.before) {
        r.error = snap.error
        continue
      }
      r.after = snap.before
      r.changes = await this.diffTrees(this.repoOf(r.root), r.before.tree, r.after.tree).catch((error) => {
        console.warn('[checkpoints] diff failed', error)
        return []
      })
    }
  }

  /**
   * What rewinding to before `promptId` changes: in each folder, the files the agent changed in that
   * prompt's turn or a later one that differ now from how they were before it.
   */
  private async plan(data: SessionFile, promptId: string) {
    const at = data.list.findIndex((e) => e.promptId === promptId)
    if (at < 0) throw new CheckpointError('Für diesen Prompt gibt es keinen Checkpoint.')
    const entries = data.list.slice(at)
    if (entries.some(isOpen)) throw new CheckpointError('Der Chat arbeitet noch an diesem Prompt.')
    const roots: { root: string; repo: string; target: string; current: string; files: RewindFile[] }[] = []
    const skipped: string[] = []
    let unavailable: string | undefined
    for (const first of entries[0]!.roots) {
      if (!first.before) {
        unavailable ??= first.error ?? 'Kein Checkpoint'
        continue
      }
      const key = folderKey(first.root)
      const later = entries.map((e) => e.roots.find((r) => folderKey(r.root) === key))
      const touched = new Set<string>()
      for (const r of later) {
        for (const c of r?.changes ?? []) touched.add(c.rel)
        if (r?.before) skipped.push(...changedSkipped(r.before, r.after).map((rel) => absolute(first.root, rel)))
      }
      if (touched.size === 0) continue
      const repo = this.repoOf(first.root)
      const now = await this.snapshot(first.root)
      const last = later.findLast((r) => r?.after)?.after
      const outside = last ? new Set((await this.diffTrees(repo, last.tree, now.tree)).map((c) => c.rel)) : new Set<string>()
      const files = (await this.diffTrees(repo, now.tree, first.before.tree))
        .filter((c) => touched.has(c.rel))
        .map((c) => ({ ...changed(first.root, c), outside: outside.has(c.rel) }))
      roots.push({ root: first.root, repo, target: first.before.tree, current: now.tree, files })
    }
    return { roots, skipped: [...new Set(skipped)], unavailable }
  }

  // -------------------------------------------------------------------------------------------
  // git

  private repoOf(root: string): string {
    return join(this.dir, 'repos', createHash('sha1').update(folderKey(resolve(root))).digest('hex').slice(0, 20))
  }

  private async diffTrees(repo: string, a: string, b: string): Promise<RelChange[]> {
    if (a === b) return []
    const [status, numstat] = await Promise.all([
      gitOk(repo, null, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', a, b]),
      gitOk(repo, null, ['diff-tree', '-r', '-z', '--no-renames', '--numstat', a, b]),
    ])
    const counts = new Map<string, { insertions: number | null; deletions: number | null }>()
    for (const record of splitZ(numstat)) {
      const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(record)
      if (m) counts.set(m[3]!, { insertions: m[1] === '-' ? null : Number(m[1]), deletions: m[2] === '-' ? null : Number(m[2]) })
    }
    const parts = splitZ(status)
    const result: RelChange[] = []
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const code = parts[i]![0]
      const rel = parts[i + 1]!
      const status: FileChangeStatus = code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified'
      result.push({ rel, status, ...(counts.get(rel) ?? { insertions: null, deletions: null }) })
    }
    return result.sort((x, y) => x.rel.localeCompare(y.rel))
  }

  private async fileDiff(repo: string, before: string, after: string, rel: string, full: boolean): Promise<FileDiff> {
    const result: FileDiff = { patch: '', text: null, repo: true, binary: false, tooLarge: false, missing: false }
    const listed = await this.list(repo, after, rel)
    result.missing = !listed.has(rel)
    const patch = await gitOk(repo, null, [
      'diff-tree', '-p', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames',
      `--unified=${full ? FULL_CONTEXT : DIFF_CONTEXT}`, before, after, '--', rel,
    ])
    if (patch.length > MAX_PATCH_CHARS) result.tooLarge = true
    else {
      const text = isUtf16(patch) ? decodeUtf16(patch) : decodeText(patch)
      result.patch = text
      result.binary = /^Binary files /m.test(text)
    }
    const type = IMAGE_TYPES[/\.([^./]+)$/.exec(rel)?.[1]?.toLowerCase() ?? '']
    if (type) {
      const [old, now] = await Promise.all([this.blobAt(repo, before, rel), this.blobAt(repo, after, rel)])
      const url = (bytes: Buffer | null) => (bytes && bytes.length <= MAX_IMAGE_BYTES ? `data:${type};base64,${bytes.toString('base64')}` : null)
      result.image = { before: url(old), after: url(now) }
      result.binary = true
      return result
    }
    if (!result.patch && !result.missing && !result.tooLarge) {
      const bytes = await this.blobAt(repo, after, rel)
      if (bytes && bytes.subarray(0, 8000).includes(0) && !isUtf16(bytes)) result.binary = true
      else if (bytes) result.text = isUtf16(bytes) ? decodeUtf16(bytes) : decodeText(bytes)
    }
    return result
  }

  private async blobAt(repo: string, tree: string, rel: string): Promise<Buffer | null> {
    const run = await git(repo, null, ['cat-file', 'blob', `${tree}:${rel}`])
    return run.code === 0 ? run.stdout : null
  }

  /** The files of a tree (all of them, or the one `only` names): their mode, blob and size. */
  private async list(repo: string, tree: string, only?: string): Promise<Map<string, { mode: string; oid: string; size: number }>> {
    const out = await gitOk(repo, null, ['ls-tree', '-r', '-z', '-l', '--full-tree', tree, ...(only ? ['--', only] : [])])
    const files = new Map<string, { mode: string; oid: string; size: number }>()
    for (const record of splitZ(out)) {
      const m = /^(\d+) (\w+) ([0-9a-f]+)\s+(-|\d+)\t(.*)$/s.exec(record)
      if (m && m[2] === 'blob') files.set(m[5]!, { mode: m[1]!, oid: m[3]!, size: m[4] === '-' ? 0 : Number(m[4]) })
    }
    return files
  }

  /** Writes `rels` as they are in `tree`; ones not in it are deleted (and folders that end up empty). */
  private async restore(repo: string, root: string, tree: string, rels: readonly string[]): Promise<{ done: number; failed: RewindResult['failed'] }> {
    const listed = await this.list(repo, tree)
    const failed: RewindResult['failed'] = []
    let done = 0
    const writes = rels.filter((rel) => isSafeRel(rel) && listed.has(rel))
    const deletes = rels.filter((rel) => isSafeRel(rel) && !listed.has(rel))
    for (const batch of batches(writes, (rel) => listed.get(rel)!.size)) {
      const blobs = await this.blobs(repo, batch.map((rel) => listed.get(rel)!.oid))
      for (const rel of batch) {
        const file = absolute(root, rel)
        const entry = listed.get(rel)!
        try {
          const bytes = blobs.get(entry.oid)
          if (!bytes) throw new Error('Die Fassung aus dem Checkpoint fehlt.')
          await mkdir(dirname(file), { recursive: true })
          await writeFile(file, bytes)
          if (entry.mode === '100755' && process.platform !== 'win32') await chmod(file, 0o755)
          done++
        } catch (error) {
          failed.push({ path: file, error: error instanceof Error ? error.message : String(error) })
        }
      }
    }
    for (const rel of deletes) {
      const file = absolute(root, rel)
      try {
        const st = await lstat(file).catch(() => null)
        if (st && !st.isDirectory()) await rm(file, { force: true })
        await removeEmptyParents(dirname(file), root)
        done++
      } catch (error) {
        failed.push({ path: file, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { done, failed }
  }

  /** Blobs by their id, read in one go (`cat-file --batch`). */
  private async blobs(repo: string, oids: readonly string[]): Promise<Map<string, Buffer>> {
    const out = await gitOk(repo, null, ['cat-file', '--batch'], `${oids.join('\n')}\n`, 120_000)
    const blobs = new Map<string, Buffer>()
    let at = 0
    while (at < out.length) {
      const eol = out.indexOf(10, at)
      if (eol < 0) break
      const header = out.subarray(at, eol).toString('utf8').split(' ')
      at = eol + 1
      if (header[1] === 'missing' || header.length < 3) continue
      const size = Number(header[2])
      blobs.set(header[0]!, out.subarray(at, at + size))
      at += size + 1
    }
    return blobs
  }

  /**
   * A shadow repository no chat has checkpoints of any more goes. Others keep every object: gc never
   * runs on them (`gc.auto=0`), as no ref names the trees the chats' files point to.
   */
  private async dropUnused(repo: string): Promise<void> {
    if (!(await exists(join(repo, 'HEAD'))) || (await this.holders(repo)) > 0) return
    this.ready.delete(repo)
    await rm(repo, { recursive: true, force: true })
  }

  /** How many chats still have checkpoints of this repository's folder. */
  private async holders(repo: string): Promise<number> {
    let count = 0
    const files = await readdir(join(this.dir, 'sessions')).catch(() => [] as string[])
    for (const name of files) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -5)
      const data = this.sessions.get(id) ?? (await readJson<SessionFile>(join(this.dir, 'sessions', name)))
      if (data && rootsOf(data).some((root) => this.repoOf(root) === repo)) count++
    }
    return count
  }

  // -------------------------------------------------------------------------------------------
  // Files and order

  private fileOf(sessionId: string): string {
    return join(this.dir, 'sessions', `${safeId(sessionId)}.json`)
  }

  private async load(sessionId: string): Promise<SessionFile> {
    const cached = this.sessions.get(sessionId)
    if (cached) return cached
    const read = await readJson<SessionFile>(this.fileOf(sessionId))
    const data: SessionFile = read && Array.isArray(read.list) ? read : { version: 1, list: [] }
    this.sessions.set(sessionId, data)
    return data
  }

  private async save(sessionId: string, data: SessionFile): Promise<void> {
    this.sessions.set(sessionId, data)
    await writeJsonAtomic(this.fileOf(sessionId), data)
  }

  private serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const before = this.queues.get(key) ?? Promise.resolve()
    const next = before.then(task, task)
    const settled = next.catch(() => undefined)
    this.queues.set(key, settled)
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key)
    })
    return next
  }
}

// ---------------------------------------------------------------------------------------------

/** Why a folder gets no checkpoints: a whole drive, the home folder or one of its big ones. */
export function unsafeRoot(root: string, home = homedir()): string | null {
  const abs = resolve(root)
  if (parse(abs).root === abs) return 'Für ein ganzes Laufwerk legt Nexa keine Checkpoints an.'
  const key = folderKey(abs)
  const big = [home, ...['Desktop', 'Documents', 'Downloads', 'OneDrive', 'Pictures', 'Videos', 'Music'].map((d) => join(home, d))]
  if (big.some((dir) => folderKey(dir) === key)) return 'Für den Benutzerordner und seine großen Ordner legt Nexa keine Checkpoints an.'
  return null
}

function isOpen(entry: Entry): boolean {
  return entry.roots.some((r) => r.before && !r.after && !r.error)
}

/** Folders that lie in another of them are already in its snapshots. */
function outermost(roots: readonly string[]): string[] {
  const unique = [...new Map(roots.filter(Boolean).map((r) => [folderKey(resolve(r)), resolve(r)])).values()]
  return unique.filter((r) => !unique.some((other) => other !== r && inFolder(r, other)))
}

function rootsOf(data: SessionFile): string[] {
  return [...data.list.flatMap((e) => e.roots.map((r) => r.root)), ...(data.undo?.roots.map((r) => r.root) ?? [])]
}

function changed(root: string, c: RelChange): ChangedFile {
  return { path: absolute(root, c.rel), root, rel: c.rel, status: c.status, insertions: c.insertions, deletions: c.deletions }
}

/** Files left out of the snapshots that came or changed in between: what a prompt changed unseen. */
function changedSkipped(before: Snap, after: Snap | undefined): string[] {
  if (!after?.skipped) return []
  const was = new Map((before.skipped ?? []).map((s) => [s.rel, s]))
  return after.skipped.filter((s) => {
    const old = was.get(s.rel)
    return !old || old.size !== s.size || old.mtime !== s.mtime
  }).map((s) => s.rel)
}

export function summarize(changes: readonly RelChange[]): FileChangeSummary | null {
  if (changes.length === 0) return null
  return {
    files: changes.length,
    insertions: changes.reduce((n, c) => n + (c.insertions ?? 0), 0),
    deletions: changes.reduce((n, c) => n + (c.deletions ?? 0), 0),
  }
}

function absolute(root: string, rel: string): string {
  return join(root, ...rel.split('/'))
}

/** A path within the folder: no `..`, nothing absolute, nothing a drive letter could take somewhere else. */
export function isSafeRel(rel: string): boolean {
  if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) return false
  return rel.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !(process.platform === 'win32' && part.includes(':')))
}

function safeId(sessionId: string): string {
  if (!/^[\w-]{1,100}$/.test(sessionId)) throw new Error('Ungültige Chat-ID.')
  return sessionId
}

/** Rules of a `.gitignore` above the folder that apply in it too: no `/` but at their end. */
function pathless(line: string): boolean {
  const rule = line.trim().replace(/\/$/, '').replace(/^!/, '')
  return !!rule && !rule.startsWith('#') && !rule.includes('/')
}

async function readLines(file: string): Promise<string[]> {
  const text = await readFile(file, 'utf8').catch(() => '')
  return text.split(/\r?\n/)
}

/** The common git folder of a worktree (`.git` is a file naming its own folder in the main repository's). */
async function commonDirOf(dotGitFile: string, dir: string): Promise<string | null> {
  const text = await readFile(dotGitFile, 'utf8').catch(() => '')
  const m = /^gitdir:\s*(.+)$/m.exec(text)
  if (!m) return null
  const gitDir = resolve(dir, m[1]!.trim())
  const common = (await readFile(join(gitDir, 'commondir'), 'utf8').catch(() => '')).trim()
  return common ? resolve(gitDir, common) : gitDir
}

async function removeEmptyParents(dir: string, root: string): Promise<void> {
  let current = resolve(dir)
  const top = folderKey(resolve(root))
  while (folderKey(current) !== top && inFolder(current, root)) {
    try {
      await rmdir(current)
    } catch {
      return
    }
    current = dirname(current)
  }
}

async function exists(file: string): Promise<boolean> {
  return !!(await stat(file).catch(() => null))
}

/** Groups of paths whose blobs together stay under `BATCH_BYTES` (a bigger one goes alone). */
function batches(rels: readonly string[], size: (rel: string) => number): string[][] {
  const result: string[][] = []
  let current: string[] = []
  let bytes = 0
  for (const rel of rels) {
    const n = size(rel)
    if (current.length && bytes + n > BATCH_BYTES) {
      result.push(current)
      current = []
      bytes = 0
    }
    current.push(rel)
    bytes += n
  }
  if (current.length) result.push(current)
  return result
}

function splitZ(out: Buffer): string[] {
  return out.toString('utf8').split('\0').filter(Boolean)
}

function joinZ(paths: readonly string[]): string {
  return `${paths.join('\0')}\0`
}

interface GitRun {
  code: number
  stdout: Buffer
  stderr: string
}

/**
 * git on the shadow repository: `GIT_DIR` it, `GIT_WORK_TREE` the folder (for snapshots only), paths
 * taken literally; none of the user's `GIT_*` variables, which could point it at another repository.
 */
function git(repo: string, root: string | null, args: readonly string[], input?: string, timeoutMs = 60_000): Promise<GitRun> {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (!/^GIT_/i.test(key)) env[key] = value
  env.GIT_DIR = repo
  env.GIT_INDEX_FILE = join(repo, 'index')
  if (root) env.GIT_WORK_TREE = root
  env.GIT_LITERAL_PATHSPECS = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', [...CONFIG, ...args], { cwd: root ?? repo, windowsHide: true, env })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_OUTPUT) child.kill()
      else out.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code: code ?? -1, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(input ?? '')
  })
}

async function gitOk(repo: string, root: string | null, args: readonly string[], input?: string, timeoutMs?: number): Promise<Buffer> {
  const run = await git(repo, root, args, input, timeoutMs)
  if (run.code !== 0) throw new Error(`git ${args[0]} failed (${run.code}): ${run.stderr.trim().slice(0, 500)}`)
  return run.stdout
}
