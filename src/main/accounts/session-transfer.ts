import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { claudePaths, claudeProjectKey, codexPaths, type ClaudePaths, type CodexPaths } from './cli-files'

/**
 * Moves a conversation to another account: each account keeps its conversations in its own config
 * folder, and a CLI only resumes what it finds there. The files are copied (the old account keeps
 * its copy), so the chat goes on with everything the CLI knew, tool calls included.
 */

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  )
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  )
}

/** Claude Code's transcript of a session: in the project folder of `cwd`, else in any (a shortened name, a worktree). */
export async function findClaudeTranscript(projectsDir: string, sessionId: string, cwd: string): Promise<string | null> {
  const name = `${sessionId}.jsonl`
  const direct = join(projectsDir, claudeProjectKey(cwd), name)
  if (await isFile(direct)) return direct
  const folders = await readdir(projectsDir, { withFileTypes: true }).catch(() => [])
  for (const folder of folders) {
    if (!folder.isDirectory()) continue
    const candidate = join(projectsDir, folder.name, name)
    if (await isFile(candidate)) return candidate
  }
  return null
}

/** Is the copy at `target` newer than `source` (the chat went on there meanwhile)? */
async function newer(target: string, source: string): Promise<boolean> {
  const [a, b] = await Promise.all([stat(target).catch(() => null), stat(source)])
  return !!a && a.mtimeMs > b.mtimeMs + 1000
}

/**
 * Copies a Claude Code session into another config folder: its transcript, the folder next to it
 * (subagents, saved tool output) and the file snapshots of `/rewind`. False when there is nothing to copy.
 */
export async function copyClaudeSession(from: ClaudePaths, to: ClaudePaths, sessionId: string, cwd: string): Promise<boolean> {
  const transcript = await findClaudeTranscript(from.projectsDir, sessionId, cwd)
  if (!transcript) return false
  const target = join(to.projectsDir, basename(dirname(transcript)), `${sessionId}.jsonl`)
  if (await newer(target, transcript)) return true
  const options = { recursive: true, force: true, preserveTimestamps: true }
  const extras: [string, string][] = [
    [join(dirname(transcript), sessionId), join(dirname(target), sessionId)],
    [join(from.configDir, 'file-history', sessionId), join(to.configDir, 'file-history', sessionId)],
  ]
  for (const [src, dst] of extras) if (await isDirectory(src)) await cp(src, dst, options)
  // The transcript last: Claude Code only finds the session once everything else is there.
  await mkdir(dirname(target), { recursive: true })
  await cp(transcript, target, options)
  return true
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

/**
 * Makes sure Claude Code finds a session in the folder it starts with (`paths`): there already, or
 * copied from `savedIn`, the folder it was saved in. The standard account's folder is whatever
 * CLAUDE_CONFIG_DIR Nexa was started with, e.g. another account manager's when `npm run dev` ran in
 * one of its terminals. False when the session is in neither, and `--resume` would fail.
 */
export async function ensureClaudeSession(paths: ClaudePaths, savedIn: string | undefined, sessionId: string, cwd: string): Promise<boolean> {
  if (await findClaudeTranscript(paths.projectsDir, sessionId, cwd)) return true
  if (!savedIn || samePath(savedIn, paths.configDir)) return false
  return copyClaudeSession(claudePaths(savedIn, true), paths, sessionId, cwd)
}

/**
 * The same for a Codex thread: `found` when Codex can resume it, `copiedTo` the file to resume from
 * when it had to be copied from `savedIn`.
 */
export async function ensureCodexThread(
  paths: CodexPaths,
  savedIn: string | undefined,
  threadId: string,
  knownPath?: string,
): Promise<{ found: boolean; copiedTo?: string }> {
  if ((knownPath && (await isFile(knownPath))) || (await findCodexRollout(paths.sessionsDir, threadId))) return { found: true }
  if (!savedIn || samePath(savedIn, paths.configDir)) return { found: false }
  const copiedTo = await copyCodexThread(codexPaths(savedIn).sessionsDir, paths.sessionsDir, threadId)
  return copiedTo ? { found: true, copiedTo } : { found: false }
}

/**
 * The folders below `sessions` a thread's file is likely in: Codex's thread ids are UUIDv7, whose
 * first 48 bits are the time it was started, and the file goes into the folder of that day (local
 * time). The days around it as well, for a clock or time zone that changed since.
 */
export function codexRolloutDays(threadId: string): string[] {
  const hex = threadId.replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(hex) || hex[12] !== '7') return []
  const started = parseInt(hex.slice(0, 12), 16)
  const pad = (n: number) => String(n).padStart(2, '0')
  return [0, -1, 1].map((days) => {
    const d = new Date(started + days * 86_400_000)
    return join(String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()))
  })
}

/** Codex's conversation file of a thread (`sessions/<yyyy>/<mm>/<dd>/rollout-<time>-<thread>.jsonl`). */
export async function findCodexRollout(sessionsDir: string, threadId: string): Promise<string | null> {
  const suffix = `-${threadId}.jsonl`
  // A folder of years of threads takes long to walk: the day the id names first.
  for (const day of codexRolloutDays(threadId)) {
    const names = await readdir(join(sessionsDir, day)).catch(() => [] as string[])
    const name = names.find((f) => f.endsWith(suffix))
    if (name) return join(sessionsDir, day, name)
  }
  const files = await readdir(sessionsDir, { recursive: true }).catch(() => [] as string[])
  const match = files.find((f) => f.endsWith(suffix))
  return match ? join(sessionsDir, match) : null
}

/**
 * Copies a Codex thread into another CODEX_HOME, at the same place below `sessions`. The path of the
 * copy, which `thread/resume` then gets: Codex looks threads up by id in its own index, where the
 * copy isn't yet. Null when there is nothing to copy.
 */
export async function copyCodexThread(fromSessions: string, toSessions: string, threadId: string, knownPath?: string): Promise<string | null> {
  const source = knownPath && (await isFile(knownPath)) ? knownPath : await findCodexRollout(fromSessions, threadId)
  if (!source) return null
  const rel = relative(fromSessions, source)
  const target = rel && !rel.startsWith('..') ? join(toSessions, rel) : join(toSessions, basename(source))
  if (await newer(target, source)) return target
  await mkdir(dirname(target), { recursive: true })
  await cp(source, target, { force: true, preserveTimestamps: true })
  return target
}
