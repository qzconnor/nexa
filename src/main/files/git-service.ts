import { execFile } from 'node:child_process'
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { AddedWorktree, GitBranch, WorktreeBaseChoice, WorktreeCheck, WorktreeOptions } from '@shared/files'
import { folderKey, inFolder } from '@shared/folders'
import { randomWorktreeName, worktreeBranch, worktreeFolder, worktreeNameError } from '@shared/worktree'
import { TypedEmitter } from '../lib/typed-emitter'
import { filterGuard } from './git-filters'
import { claudeBaseRef, copyIncluded, includePreview, pickIncluded, WORKTREE_INCLUDE } from './worktree-setup'

/** What a new worktree branches from: the commit, its name for people, and whether it is `origin`'s. */
interface StartPoint {
  commit: string
  label: string
  remote: boolean
}

interface Watched {
  /** The working directories asked for that lie in this repository. */
  cwds: Set<string>
  watcher: FSWatcher
  /** Linux: the reftable folder (see `startWatching`). */
  reftable: FSWatcher | null
  timer: NodeJS.Timeout | null
}

/**
 * The checked-out branch of the repository a terminal works in. git itself only locates the
 * repository (worktrees and submodules included), so nothing shows without git. The branch comes
 * from the HEAD file, which is watched, so a checkout in the terminal shows up right away.
 */
/** A repository that couldn't be watched is tried again after this long. */
const WATCH_RETRY_MS = 30_000
/** A new `.git` is looked at once nothing changed in it for this long (`git init` writes many files). */
const REPO_SETTLE_MS = 300
/** The default branch of `origin` is fetched before a worktree branches from it when the repository wasn't fetched for this long (as Claude Code). */
const FETCH_AGE_MS = 24 * 60 * 60 * 1000
/** How long that fetch may take before the branch git has is used (as Claude Code). */
const FETCH_TIMEOUT_MS = 5000
/** A fetch of a default branch git doesn't have yet; without it the worktree starts from HEAD. */
const FIRST_FETCH_TIMEOUT_MS = 20_000
/**
 * Git must not wait for a password, a passphrase or a new SSH host: nobody would see the question. As
 * failed, the fetch leaves the branch git has (Claude Code's fetch never asks either).
 */
const NO_PROMPT = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
/** Lists of every file in a folder such as `node_modules` are long. */
const LIST_BUFFER = 256 * 1024 * 1024

export class GitService extends TypedEmitter<{ changed: [cwd: string, branch: GitBranch | null] }> {
  /** Only hits are kept: a folder can still become a repository later. */
  private readonly gitDirs = new Map<string, string>()
  /** By git directory: tabs in the same repository share one watcher. */
  private readonly watched = new Map<string, Watched>()
  /** Counts the calls of `watch`; an older one that finishes late changes nothing. */
  private generation = 0
  /** The folders of the last `watch`. */
  private cwds: readonly string[] = []
  /** Folders that are no repository yet: `git init` there makes one (see `watchForRepo`). */
  private readonly waiting = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null }>()
  private retryTimer: NodeJS.Timeout | null = null
  private disposed = false

  /** Null without git, outside a repository or with an unreadable HEAD. */
  async branch(cwd: string): Promise<GitBranch | null> {
    const gitDir = await this.gitDir(cwd)
    return gitDir ? readBranch(gitDir) : null
  }

  /**
   * Folder of the main checkout when `cwd` lies in a linked worktree of its repository (`git worktree add`,
   * `claude --worktree`, EnterWorktree); null in the main checkout itself, outside a repository and without git.
   */
  async mainWorktree(cwd: string): Promise<string | null> {
    const gitDir = await this.gitDir(cwd)
    return gitDir ? readMainWorktree(gitDir) : null
  }

  /**
   * Watches the repositories these folders lie in for checkouts, reported as `changed` for each folder.
   * Replaces the folders of the previous call; a folder that is no repository yet is picked up by a later one.
   */
  async watch(cwds: readonly string[]): Promise<void> {
    if (this.disposed) return
    this.cwds = cwds
    const generation = ++this.generation
    const found = await Promise.all([...new Set(cwds)].map(async (cwd) => [cwd, await this.gitDir(cwd)] as const))
    if (generation !== this.generation) return
    const wanted = new Map<string, Set<string>>()
    for (const [cwd, gitDir] of found) {
      if (gitDir) wanted.set(gitDir, (wanted.get(gitDir) ?? new Set()).add(cwd))
    }
    const noRepo = new Set(found.filter(([, gitDir]) => !gitDir).map(([cwd]) => cwd))
    for (const cwd of [...this.waiting.keys()]) if (!noRepo.has(cwd)) this.stopWaiting(cwd)
    for (const cwd of noRepo) if (!this.waiting.has(cwd)) this.watchForRepo(cwd)
    for (const gitDir of [...this.watched.keys()]) {
      if (!wanted.has(gitDir)) this.unwatch(gitDir)
    }
    for (const [gitDir, dirs] of wanted) {
      const watched = this.watched.get(gitDir)
      if (watched) watched.cwds = dirs
      else this.startWatching(gitDir, dirs)
    }
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    if (this.retryTimer) clearTimeout(this.retryTimer)
    for (const gitDir of [...this.watched.keys()]) this.unwatch(gitDir)
    for (const cwd of [...this.waiting.keys()]) this.stopWaiting(cwd)
  }

  /**
   * Whether a chat in `cwd` can get a worktree of its own (`addWorktree`): that takes a repository with
   * at least one commit. Also names the worktrees made there before and what a new one starts from.
   */
  async worktreeCheck(cwd: string): Promise<WorktreeCheck> {
    const repo = await worktreeRepo(cwd)
    if (!repo.ok) return repo
    const { root } = repo
    const [head, fresh, baseRef, refs, ignored, include] = await Promise.all([
      this.branch(cwd),
      originDefault(root),
      claudeBaseRef(root),
      runGit(root, ['for-each-ref', '--format=%(refname)', 'refs/heads/worktree-*']),
      // A worktree's folder needn't be there for git to tell whether its patterns cover it.
      runGit(root, ['check-ignore', '-q', '--', worktreeFolder('x')]),
      worktreeIncludes(root).then((files) => (files ? includePreview(root, files) : null)),
    ])
    const checkedOut = new Set(repo.worktrees.map((w) => w.branch))
    const branches = (refs.ok ? refs.out.split('\n') : [])
      .map((ref) => ref.trim().replace(/^refs\/heads\//, ''))
      .filter((branch) => /^worktree-./.test(branch) && !checkedOut.has(branch))
      .map((branch) => branch.slice('worktree-'.length))
    return {
      ok: true,
      root,
      head,
      fresh: fresh ? { ref: `origin/${fresh.name}`, cached: fresh.cached } : null,
      baseRef,
      existing: claudeWorktrees(repo.worktrees, root).map((w) => w.name),
      branches,
      ignored: ignored.ok,
      include,
    }
  }

  /**
   * A worktree for a chat, as `claude --worktree <name>` makes it: `.claude/worktrees/<name>` in the main
   * checkout of the repository `cwd` lies in, on a new branch `worktree-<name>` from the default branch of
   * `origin` (`base` `fresh`, see `startPoint`) or from the HEAD of `cwd`'s checkout (`head`), with the files
   * `.worktreeinclude` names copied in. A branch `worktree-<name>` there already goes on (Claude Code would
   * reset it to the base; Nexa keeps it, because it keeps that branch only when it has commits of its own).
   * One of that name is entered again, brought up to date with `fresh` when nothing in it would be lost
   * (`refresh`); without a name one is made up. The repository's own filters don't run on the files it
   * checks out (`filterGuard`), as with Claude Code: anything that writes to the repository, an agent too,
   * could have put them there.
   */
  async addWorktree(cwd: string, raw: string, options: WorktreeOptions = {}): Promise<AddedWorktree> {
    const problem = worktreeNameError(raw)
    if (problem) throw new Error(problem)
    const repo = await worktreeRepo(cwd)
    if (!repo.ok) throw new Error(repo.reason)
    const { root, worktrees } = repo
    const choice: WorktreeBaseChoice = options.base === 'head' ? 'head' : 'fresh'
    const folder = (name: string) => join(root, '.claude', 'worktrees', name)
    const registered = (path: string) => worktrees.find((w) => folderKey(resolve(w.path)) === folderKey(path))
    const name =
      raw.trim() || randomWorktreeName((n) => existsSync(folder(n)) || !!registered(folder(n)) || worktrees.some((w) => w.branch === worktreeBranch(n)))
    const path = folder(name)
    const known = registered(path)
    if (known && !known.prunable && existsSync(path)) {
      const entered = { path: resolve(known.path), branch: known.branch ?? worktreeBranch(name), root }
      const fresh = choice === 'fresh' && !known.locked && !options.inUse?.(entered.path) ? await this.refresh(entered.path, worktreeBranch(name), root) : null
      return fresh ? { ...entered, base: fresh } : entered
    }
    if (existsSync(path)) {
      throw new Error(`Den Ordner „${worktreeFolder(name)}“ gibt es schon, aber nicht als Worktree dieses Repositorys. Nimm einen anderen Namen.`)
    }
    // Its folder is gone, git still knows it: `worktree add` refuses until git forgets it.
    if (known) await runGit(root, ['worktree', 'prune'])
    const branch = worktreeBranch(name)
    const exists = await runGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
    const env = await checkoutGuard(root)
    let base: StartPoint | null = null
    let args: string[]
    if (exists.ok) args = ['worktree', 'add', path, branch]
    else {
      base = await this.startPoint(root, cwd, choice)
      // A commit, so the branch follows nothing: from `origin/main` git would set that as its upstream.
      args = ['worktree', 'add', '--no-track', '-b', branch, path, `${base.commit}^{commit}`]
    }
    // A checkout of a big repository takes a while.
    const made = await runGit(cwd, ['-c', 'core.fsmonitor=false', ...args], { timeout: 180_000, env })
    if (!made.ok) throw new Error(`Git konnte den Worktree nicht anlegen: ${made.error}`)
    const included = await this.setUp(root, path)
    return { path, branch, root, ...(base ? { base: base.label } : {}), ...(included ? { included } : {}) }
  }

  /**
   * What a new worktree gets of the main checkout after git made it, as with Claude Code: the files
   * `.worktreeinclude` names that git ignores, and on Windows `.claude/settings.local.json` (Claude Code
   * reads it from the main checkout elsewhere, from the session's folder on Windows). Nothing is
   * overwritten and nothing fails the worktree; what couldn't be copied is named in the result.
   */
  private async setUp(root: string, path: string): Promise<AddedWorktree['included'] | null> {
    if (process.platform === 'win32' && existsSync(join(root, '.claude', 'settings.local.json'))) {
      const local = await copyIncluded(root, path, ['.claude/settings.local.json']).catch(() => null)
      for (const { error } of local?.failed ?? []) console.warn('[git] settings.local.json not copied into the worktree:', error)
    }
    const files = await worktreeIncludes(root).catch((error: unknown) => {
      console.warn('[git] .worktreeinclude could not be read:', error)
      return null
    })
    if (!files?.length) return null
    const copy = await copyIncluded(root, path, files)
    for (const { path: file, error } of copy.failed) console.warn(`[git] ${file} from .worktreeinclude not copied:`, error)
    return { copied: copy.copied, failed: copy.failed.map((f) => f.path) }
  }

  /**
   * The commit a new worktree branches from. `fresh` (Claude Code's default): the default branch of
   * `origin`, fetched first when the repository wasn't fetched for a day (5 s at most, else the one git has)
   * or when git has none (else HEAD); `head`, and `fresh` without `origin`: the HEAD of `cwd`'s checkout.
   */
  private async startPoint(root: string, cwd: string, choice: WorktreeBaseChoice): Promise<StartPoint> {
    const fresh = choice === 'fresh' ? await originDefault(root) : null
    if (fresh) {
      const ref = `refs/remotes/origin/${fresh.name}`
      if (!fresh.cached || (await this.fetchAge(root)) > FETCH_AGE_MS) {
        // `--upload-pack`: a value in the repository's config would run a program there (a local remote).
        const fetched = await runGit(root, ['fetch', '--quiet', '--upload-pack=git-upload-pack', 'origin', fresh.name], {
          timeout: fresh.cached ? FETCH_TIMEOUT_MS : FIRST_FETCH_TIMEOUT_MS,
          env: NO_PROMPT,
        })
        if (!fetched.ok) console.warn(`[git] fetch of origin/${fresh.name} failed:`, fetched.error)
      }
      const commit = await runGit(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
      if (commit.ok && commit.out) return { commit: commit.out, label: `origin/${fresh.name}`, remote: true }
    }
    const head = await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    if (!head.ok || !head.out) throw new Error('Das Repository hat noch keinen Commit, von dem ein Worktree abzweigen kann.')
    const branch = await this.branch(cwd)
    return { commit: head.out, label: branch?.name ?? head.out.slice(0, 7), remote: false }
  }

  /** How long ago the repository was last fetched (its `FETCH_HEAD`); never: infinitely long. */
  private async fetchAge(root: string): Promise<number> {
    const gitDir = await this.gitDir(root)
    const fetched = gitDir ? await stat(join(gitDir, 'FETCH_HEAD')).catch(() => null) : null
    return fetched ? Date.now() - fetched.mtimeMs : Number.POSITIVE_INFINITY
  }

  /**
   * A worktree entered again starts where the default branch of `origin` is now, as with Claude Code,
   * when that loses nothing: still on its own branch, no changed or new files, and every commit of it on
   * that branch already (none of its own, or merged). Returns what it now starts from; null when it stays.
   */
  private async refresh(path: string, branch: string, root: string): Promise<string | null> {
    const head = await runGit(path, ['symbolic-ref', '--quiet', 'HEAD'])
    if (!head.ok || head.out !== `refs/heads/${branch}`) return null
    const status = await runGit(path, ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--ignore-submodules=none'], { timeout: 30_000 })
    if (!status.ok || status.out) return null
    const base = await this.startPoint(root, path, 'fresh').catch(() => null)
    const current = await runGit(path, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
    if (!base?.remote || !current.ok || current.out === base.commit) return null
    if (!(await runGit(path, ['merge-base', '--is-ancestor', current.out, base.commit])).ok) return null
    const env = await checkoutGuard(root)
    const reset = await runGit(path, ['-c', 'core.fsmonitor=false', 'reset', '--hard', '--quiet', base.commit, '--'], { timeout: 180_000, env })
    if (!reset.ok) {
      console.warn(`[git] worktree ${path} stays where it was:`, reset.error)
      return null
    }
    return base.label
  }

  /**
   * Removes a worktree a chat worked in, with its branch, unless work would be lost, as Claude Code does
   * when a session in its worktree ends: changed or untracked files, or commits on no other branch or tag.
   * Null when it is gone (also when it was before); otherwise why it, or its branch, stays. Files git
   * ignores (`node_modules`, a copied `.env`) go with it.
   */
  async removeWorktree(path: string, branch: string): Promise<string | null> {
    if (!existsSync(path)) return null
    const main = await this.mainWorktree(path)
    // Only a linked worktree: never a main checkout or a folder that is no repository (any more).
    if (!main) return null
    const status = await runGit(path, ['status', '--porcelain', '--ignore-submodules=none'])
    if (!status.ok) return `Git konnte ihn nicht prüfen: ${status.error}`
    if (status.out) return 'Darin sind Änderungen, die noch nicht committet sind.'
    const head = await runGit(path, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    const own = await ownCommits(path, 'HEAD', branch)
    if (own === null) return 'Git konnte seine Commits nicht prüfen.'
    if (own > 0) {
      return head.ok && head.out === branch
        ? `Sein Branch „${branch}“ hat Commits, die auf keinem anderen Branch sind.`
        : 'Er hat Commits, die auf keinem anderen Branch sind.'
    }
    const removed = await runGit(main, ['worktree', 'remove', path], { timeout: 60_000 })
    if (!removed.ok) return `Git konnte ihn nicht entfernen: ${removed.error}`
    for (const cwd of [...this.gitDirs.keys()]) if (inFolder(cwd, path)) this.gitDirs.delete(cwd)
    const ref = `refs/heads/${branch}`
    if (!(await runGit(main, ['rev-parse', '--verify', '--quiet', ref])).ok) return null
    const onBranch = await ownCommits(main, ref, branch)
    if (onBranch !== 0) return `Der Worktree ist weg, sein Branch „${branch}“ bleibt: Er hat Commits, die auf keinem anderen Branch sind.`
    const deleted = await runGit(main, ['branch', '-D', branch])
    return deleted.ok ? null : `Der Worktree ist weg, sein Branch „${branch}“ bleibt: ${deleted.error}`
  }

  /**
   * Web page of the repository `cwd` lies in, from its remote: the upstream of the checked-out branch,
   * else `origin`, else the only remote (git picks it, with `url.*.insteadOf` applied). Null without one
   * or for a remote that has no web page (a local path, for example).
   */
  async webUrl(cwd: string): Promise<string | null> {
    const remote = await runGit(cwd, ['ls-remote', '--get-url'])
    return remote.ok ? repoWebUrl(remote.out) : null
  }

  private async gitDir(cwd: string): Promise<string | null> {
    const known = this.gitDirs.get(cwd)
    if (known) return known
    const gitDir = await new Promise<string | null>((resolve) => {
      execFile(
        'git',
        ['rev-parse', '--absolute-git-dir'],
        { cwd, windowsHide: true, timeout: 5000, encoding: 'utf8' },
        // Also fails if git is missing (ENOENT) or the folder doesn't exist.
        (error, stdout) => resolve(error ? null : stdout.trim() || null),
      )
    })
    if (gitDir) this.gitDirs.set(cwd, gitDir)
    return gitDir
  }

  private startWatching(gitDir: string, cwds: Set<string>): void {
    try {
      // git replaces HEAD through HEAD.lock, so the folder is watched, not the file. With reftable refs
      // HEAD stays put and the tables change: Windows tells it as a change of their folder, Linux not.
      const watcher = watch(gitDir, (_event, file) => {
        if (file === 'HEAD' || file === 'reftable') this.scheduleRead(gitDir)
      })
      watcher.on('error', () => {
        this.unwatch(gitDir)
        this.retry()
      })
      let reftable: FSWatcher | null = null
      if (process.platform === 'linux' && existsSync(join(gitDir, 'reftable'))) {
        try {
          reftable = watch(join(gitDir, 'reftable'), () => this.scheduleRead(gitDir))
          reftable.on('error', () => undefined)
        } catch {
          // Only the branch of reftable repositories lags then, until the window asks again.
        }
      }
      this.watched.set(gitDir, { cwds, watcher, reftable, timer: null })
    } catch {
      // Not watchable now: tried again later; the window also asks again when it gets the focus.
      this.retry()
    }
  }

  /**
   * Waits in a folder that is no repository for its `.git` (`git init`, `git clone .`): then the
   * folders are watched anew, and the new branch is reported.
   */
  private watchForRepo(cwd: string): void {
    try {
      const watcher = watch(cwd, (_event, file) => {
        if (file !== '.git') return
        const waiting = this.waiting.get(cwd)
        if (waiting?.watcher !== watcher) return
        // `git init` writes many files: looked at once it is done.
        if (waiting.timer) clearTimeout(waiting.timer)
        waiting.timer = setTimeout(() => {
          waiting.timer = null
          void this.gitDir(cwd).then(async (gitDir) => {
            if (!gitDir || this.waiting.get(cwd) !== waiting) return
            this.stopWaiting(cwd)
            this.emit('changed', cwd, await readBranch(gitDir))
            void this.watch(this.cwds)
          })
        }, REPO_SETTLE_MS)
      })
      watcher.on('error', () => {
        if (this.waiting.get(cwd)?.watcher === watcher) this.stopWaiting(cwd)
        else watcher.close()
      })
      this.waiting.set(cwd, { watcher, timer: null })
    } catch {
      // The folder is gone: nothing to wait for.
    }
  }

  private stopWaiting(cwd: string): void {
    const waiting = this.waiting.get(cwd)
    if (!waiting) return
    if (waiting.timer) clearTimeout(waiting.timer)
    waiting.watcher.close()
    this.waiting.delete(cwd)
  }

  /** Watches the folders of the last call again, after a watcher failed. */
  private retry(): void {
    if (this.disposed || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.watch(this.cwds)
    }, WATCH_RETRY_MS)
  }

  private scheduleRead(gitDir: string): void {
    const watched = this.watched.get(gitDir)
    if (!watched) return
    if (watched.timer) clearTimeout(watched.timer)
    watched.timer = setTimeout(() => {
      watched.timer = null
      void readBranch(gitDir).then((branch) => {
        if (this.watched.get(gitDir) !== watched) return
        for (const cwd of watched.cwds) this.emit('changed', cwd, branch)
      })
    }, 150)
  }

  private unwatch(gitDir: string): void {
    const watched = this.watched.get(gitDir)
    if (!watched) return
    if (watched.timer) clearTimeout(watched.timer)
    watched.watcher.close()
    watched.reftable?.close()
    this.watched.delete(gitDir)
  }
}

/** The branch of a repository with reftable refs, from git; a detached HEAD by its commit. */
async function reftableBranch(gitDir: string): Promise<GitBranch | null> {
  const branch = await runGit(gitDir, [`--git-dir=${gitDir}`, 'symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch.ok && branch.out) return { name: branch.out, detached: false }
  const commit = await runGit(gitDir, [`--git-dir=${gitDir}`, 'rev-parse', '--short', 'HEAD'])
  return commit.ok && commit.out ? { name: commit.out, detached: true } : null
}

/** `error`: what git said went wrong. */
type GitResult = { ok: true; out: string } | { ok: false; missing: boolean; error: string }

interface GitOptions {
  timeout?: number
  env?: Record<string, string>
  /** Keeps the output as git wrote it (lists with `-z`), not trimmed. */
  raw?: boolean
  maxBuffer?: number
}

function runGit(cwd: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  const env = options.env && Object.keys(options.env).length > 0 ? { ...process.env, ...options.env } : undefined
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, timeout: options.timeout ?? 5000, encoding: 'utf8', env, ...(options.maxBuffer ? { maxBuffer: options.maxBuffer } : {}) },
      (error, stdout, stderr) => {
        if (error) resolve({ ok: false, missing: (error as NodeJS.ErrnoException).code === 'ENOENT' && existsSync(cwd), error: gitError(error, stderr) })
        else resolve({ ok: true, out: options.raw ? stdout : stdout.trim() })
      },
    )
  })
}

/**
 * The environment for a checkout in the repository of `root`: the filters its own config defines don't
 * run (`filterGuard`).
 */
async function checkoutGuard(root: string): Promise<Record<string, string>> {
  const filters = await runGit(root, ['config', '--show-scope', '--name-only', '--includes', '--get-regexp', '^filter\\.'])
  return filterGuard(filters.ok ? filters.out : null, process.env.GIT_CONFIG_COUNT, true)
}

/**
 * The default branch of `origin` as Claude Code finds it: the branch `origin/HEAD` points to, else
 * `main`, else `master`, as long as git has it (`cached`); else `main`, which is fetched first. Null
 * without a remote `origin`.
 */
async function originDefault(root: string): Promise<{ name: string; cached: boolean } | null> {
  const url = await runGit(root, ['config', '--get', 'remote.origin.url'])
  if (!url.ok || !url.out) return null
  const head = await runGit(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  const named = head.ok ? head.out.replace(/^origin\//, '') : ''
  for (const name of new Set([named, 'main', 'master'])) {
    // A name like an option would reach git as one.
    if (!name || name.startsWith('-')) continue
    if ((await runGit(root, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${name}`])).ok) return { name, cached: true }
  }
  return { name: 'main', cached: false }
}

/**
 * The files `.worktreeinclude` in the main checkout `root` copies into a new worktree, as Claude Code picks
 * them (`pickIncluded`): only files git ignores there, so nothing tracked is copied. Null without the file
 * or without patterns in it.
 */
async function worktreeIncludes(root: string): Promise<string[] | null> {
  let text: string
  try {
    text = await readFile(join(root, WORKTREE_INCLUDE), 'utf8')
  } catch {
    return null
  }
  // `core.fsmonitor` in the repository's config would run a program; listing needs no monitor.
  const list = (args: string[]) =>
    runGit(root, ['--literal-pathspecs', '-c', 'core.fsmonitor=false', 'ls-files', '--others', '--ignored', '--exclude-standard', '-z', ...args], {
      raw: true,
      timeout: 60_000,
      maxBuffer: LIST_BUFFER,
    })
  const ignored = await list(['--directory'])
  if (!ignored.ok) return []
  return pickIncluded(text, ignored.out.split('\0'), async (dirs) => {
    const files: string[] = []
    // A few folders at a time: Windows limits the length of a command line.
    for (let i = 0; i < dirs.length; i += 50) {
      const inside = await list(['--', ...dirs.slice(i, i + 50)])
      if (inside.ok) files.push(...inside.out.split('\0'))
    }
    return files
  })
}

/** git's complaint without `fatal:` and `error:`; the process's when git said nothing. */
function gitError(error: Error & { killed?: boolean }, stderr: string): string {
  if (error.killed) return 'Git brauchte zu lange und wurde abgebrochen.'
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const said = lines.filter((line) => /^(?:fatal|error):/i.test(line)).map((line) => line.replace(/^(?:fatal|error):\s*/i, ''))
  return (said.length ? said : lines).join(' ') || error.message
}

/**
 * How many commits `rev` has that no branch but `branch`, no tag and no remote branch has; null when git
 * fails. A worktree from `origin/main` starts with commits the local branches may not have yet.
 */
async function ownCommits(cwd: string, rev: string, branch: string): Promise<number | null> {
  // `--exclude` takes the branch out of the next `--branches` only (a name there, without `refs/heads/`).
  const count = await runGit(cwd, ['rev-list', '--count', rev, '--not', `--exclude=${branch}`, '--branches', '--tags', '--remotes'])
  return count.ok ? Number(count.out) || 0 : null
}

/** A checkout of a repository, from `git worktree list --porcelain`. */
export interface WorktreeEntry {
  /** As git writes it (`F:/Code/app` on Windows). */
  path: string
  /** Its branch without `refs/heads/`; null when detached (or bare). */
  branch: string | null
  bare: boolean
  /** Its folder is gone; git still knows it until `git worktree prune`. */
  prunable: boolean
  /** `git worktree lock`: Claude Code locks the worktree of a session while it runs. */
  locked: boolean
}

/** The checkouts in `git worktree list --porcelain`, the main one first. */
export function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let entry: WorktreeEntry | null = null
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      entry = { path: line.slice('worktree '.length), branch: null, bare: false, prunable: false, locked: false }
      entries.push(entry)
    } else if (!entry) continue
    else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    else if (line === 'bare') entry.bare = true
    else if (line === 'prunable' || line.startsWith('prunable ')) entry.prunable = true
    else if (line === 'locked' || line.startsWith('locked ')) entry.locked = true
  }
  return entries
}

/** The worktrees in `.claude/worktrees` of the main checkout `root` (Claude Code's and Nexa's), not those that are gone. */
export function claudeWorktrees(worktrees: readonly WorktreeEntry[], root: string): (WorktreeEntry & { name: string })[] {
  const folder = folderKey(join(root, '.claude', 'worktrees'))
  return worktrees
    .filter((w) => !w.prunable && folderKey(dirname(resolve(w.path))) === folder)
    .map((w) => ({ ...w, name: basename(resolve(w.path)) }))
}

/** The repository `cwd` lies in, for its worktrees: its main checkout and its checkouts; or why there is none. */
async function worktreeRepo(cwd: string): Promise<{ ok: true; root: string; worktrees: WorktreeEntry[] } | { ok: false; reason: string }> {
  if (!existsSync(cwd)) return { ok: false, reason: 'Den Ordner gibt es nicht.' }
  const top = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok) {
    return { ok: false, reason: top.missing ? 'Git ist nicht installiert oder nicht im PATH.' : 'Der Ordner liegt in keinem Git-Repository.' }
  }
  const head = await runGit(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (!head.ok) return { ok: false, reason: 'Das Repository hat noch keinen Commit, von dem ein Worktree abzweigen kann.' }
  const list = await runGit(cwd, ['worktree', 'list', '--porcelain'])
  const worktrees = list.ok ? parseWorktrees(list.out) : []
  // In a worktree, the new one lies beside it in the main checkout, not in it; a bare repository has no
  // main checkout, the one of `cwd` stands in.
  const main = worktrees[0]
  return { ok: true, root: resolve(main && !main.bare ? main.path : top.out), worktrees }
}

/**
 * The web page behind a remote URL: `https://`, `ssh://`, `git://` and the scp-like `git@host:owner/repo`
 * all become `https://host/owner/repo`, without user, `.git` and the SSH port. Null for local paths.
 */
export function repoWebUrl(remote: string): string | null {
  const url = remote.trim()
  let origin: string
  let path: string
  const full = /^(https?|ssh|git|git\+ssh|ssh\+git):\/\/(?:[^@/]*@)?([^/:]+)(?::(\d*))?(\/.*)?$/i.exec(url)
  if (full) {
    const [, scheme, host, port, rest] = full
    // An http(s) remote is the page itself, port included; the port of SSH or git is not the web's.
    origin = /^https?$/i.test(scheme!) ? `${scheme!.toLowerCase()}://${host}${port ? `:${port}` : ''}` : `https://${host}`
    path = rest ?? ''
  } else {
    // scp-like syntax; a single letter before the colon is a Windows drive (`C:/repo`), not a host.
    const scp = /^(?:[^@/:]+@)?([^/:]{2,}):(?!\/\/)(.+)$/.exec(url)
    if (!scp) return null
    origin = `https://${scp[1]}`
    path = `/${scp[2]!.replace(/^\/+/, '')}`
  }
  path = path.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!path) return null
  // Azure DevOps names its repositories differently over SSH than on the web.
  const azure = /^https:\/\/ssh\.dev\.azure\.com$/i.test(origin) && /^\/v3\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path)
  if (azure) return `https://dev.azure.com/${azure[1]}/${azure[2]}/_git/${azure[3]}`
  return origin + path
}

/**
 * The page that opens a pull request (merge request) of `source` into `target` on the host of `web`
 * (`repoWebUrl`): GitHub, GitLab, Bitbucket and Azure DevOps, also self-hosted ones named after them.
 * Null for another host.
 */
export function pullRequestUrl(web: string, target: string, source: string): string | null {
  const host = /^https?:\/\/([^/:]+)/i.exec(web)?.[1]?.toLowerCase() ?? ''
  const ref = (name: string) => name.split('/').map(encodeURIComponent).join('/')
  const query = encodeURIComponent
  if (host.includes('github')) return `${web}/compare/${ref(target)}...${ref(source)}?expand=1`
  if (host.includes('gitlab')) {
    return `${web}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${query(source)}&merge_request%5Btarget_branch%5D=${query(target)}`
  }
  if (host.includes('bitbucket')) return `${web}/pull-requests/new?source=${query(source)}&dest=${query(target)}`
  if (host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) {
    return `${web}/pullrequestcreate?sourceRef=${query(source)}&targetRef=${query(target)}`
  }
  return null
}

/**
 * Only the git directory of a linked worktree (`<repository>/.git/worktrees/<name>`) has a `commondir` file:
 * it leads to the repository's own git directory, whose folder is the main checkout. A bare repository has
 * no checkout of its own; then its folder stands in. Submodules have no `commondir` either.
 */
async function readMainWorktree(gitDir: string): Promise<string | null> {
  try {
    const common = resolve(gitDir, (await readFile(join(gitDir, 'commondir'), 'utf8')).trim())
    return basename(common).toLowerCase() === '.git' ? dirname(common) : common
  } catch {
    return null
  }
}

/** `ref: refs/heads/<name>` names the branch; a bare commit hash means a detached HEAD. */
export async function readBranch(gitDir: string): Promise<GitBranch | null> {
  try {
    const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
    const ref = /^ref:\s*(?:refs\/heads\/)?(.+)$/.exec(head)
    // reftable: HEAD only stands in for older git (`refs/heads/.invalid`), git itself knows the branch.
    if (ref?.[1] === '.invalid') return reftableBranch(gitDir)
    if (ref) return { name: ref[1], detached: false }
    return /^[0-9a-f]{40,64}$/i.test(head) ? { name: head.slice(0, 7), detached: true } : null
  } catch {
    return null
  }
}
