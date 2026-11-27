import { execFile } from 'node:child_process'
import { GH_PR_FIELDS, isGitHub, MAX_PULL_REQUESTS, parsePullRequests, type PullRequestList } from '@shared/pull-requests'

/** What a call of the GitHub CLI gave: its output, or why not (`missing`: gh isn't installed). */
export type GhResult = { ok: true; out: string } | { ok: false; missing: boolean; error: string }
export type GhRunner = (cwd: string, args: string[]) => Promise<GhResult>

/** A repository's list is asked for again after this long; the composer asks on each focus and branch change. */
const CACHE_MS = 60_000
/** GitHub may be slow; the checks of 30 pull requests are one query. */
const GH_TIMEOUT_MS = 20_000
/**
 * gh must not wait for input nobody sees, nor print colours, spinners or the note about its updates;
 * git under it must not ask for a password either.
 */
const GH_ENV = {
  GH_PROMPT_DISABLED: '1',
  GH_NO_UPDATE_NOTIFIER: '1',
  GH_SPINNER_DISABLED: '1',
  NO_COLOR: '1',
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
}

export const runGh: GhRunner = (cwd, args) =>
  new Promise((resolve) => {
    execFile(
      'gh',
      args,
      { cwd, windowsHide: true, timeout: GH_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...GH_ENV } },
      (error, stdout, stderr) => {
        if (!error) return resolve({ ok: true, out: stdout })
        const code = (error as NodeJS.ErrnoException).code
        const text = (stderr || error.message).trim()
        resolve({ ok: false, missing: code === 'ENOENT', error: error.killed ? 'GitHub antwortete nicht rechtzeitig.' : text })
      },
    )
  })

/** Why gh refused, from what it printed. */
export function ghFailure(result: Extract<GhResult, { ok: false }>): Extract<PullRequestList, { ok: false }> {
  if (result.missing) return { ok: false, missing: 'no-gh' }
  const text = result.error
  if (/gh auth login|not logged in|authentication required|GH_TOKEN/i.test(text)) return { ok: false, missing: 'signed-out' }
  if (/none of the git remotes|no git remotes|not a git repository/i.test(text)) return { ok: false, missing: 'no-github' }
  return { ok: false, missing: 'error', message: text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? text }
}

export interface PullRequestsDeps {
  /** The web page of the repository a folder lies in; null without one (GitService.webUrl). */
  webUrl(cwd: string): Promise<string | null>
  gh?: GhRunner
  now?: () => number
}

/**
 * The open pull requests of the repositories the chats work in, from the GitHub CLI. One list per
 * repository (its web page), shared by its worktrees and kept a minute; a list being read is shared
 * by whoever asks meanwhile.
 */
export class PullRequests {
  private readonly cache = new Map<string, { at: number; list: Promise<PullRequestList>; pending: boolean }>()
  private readonly gh: GhRunner
  private readonly now: () => number

  constructor(private readonly deps: PullRequestsDeps) {
    this.gh = deps.gh ?? runGh
    this.now = deps.now ?? Date.now
  }

  /** `fresh`: asks GitHub even when the last answer is younger than a minute (after a turn, by hand). */
  async list(cwd: string, fresh = false): Promise<PullRequestList> {
    const webUrl = await this.deps.webUrl(cwd)
    if (!webUrl || !isGitHub(webUrl)) return { ok: false, missing: 'no-github' }
    const cached = this.cache.get(webUrl)
    if (cached && (cached.pending || (!fresh && this.now() - cached.at < CACHE_MS))) return cached.list
    const entry = { at: this.now(), list: this.read(cwd, webUrl), pending: true }
    this.cache.set(webUrl, entry)
    void entry.list.finally(() => {
      entry.pending = false
      entry.at = this.now()
    })
    return entry.list
  }

  private async read(cwd: string, webUrl: string): Promise<PullRequestList> {
    const result = await this.gh(cwd, ['pr', 'list', '--state', 'open', '--limit', String(MAX_PULL_REQUESTS), '--json', GH_PR_FIELDS])
    if (!result.ok) return ghFailure(result)
    try {
      return { ok: true, pullRequests: parsePullRequests(JSON.parse(result.out)), webUrl, at: this.now() }
    } catch {
      return { ok: false, missing: 'error', message: 'gh gab keine lesbare Liste zurück.' }
    }
  }
}
