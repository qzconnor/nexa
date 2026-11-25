import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { antigravityPaths, claudeProjectKey } from './cli-files'
import { findClaudeTranscript } from './session-transfer'

/**
 * The files of a CLI's conversation, for deleting a chat with it: the CLIs keep each conversation in
 * the config folder of every account that had it (switching accounts copies it, see session-transfer.ts).
 */

/** Ids of sessions and threads; anything else never becomes part of a path. */
const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,79}$/
const ROLLOUT_ID = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

async function exists(path: string, kind: 'file' | 'dir'): Promise<boolean> {
  return stat(path).then(
    (s) => (kind === 'file' ? s.isFile() : s.isDirectory()),
    () => false,
  )
}

/**
 * Claude Code's files of a session in one config folder: the transcript first (once it is gone, the
 * session is gone for Claude Code), then the folder next to it (subagents, saved tool output), the
 * snapshots of `/rewind`, its environment and task list. `search`: also in other project folders than
 * the one of `cwd` (slower; for deleting, not for sizes).
 */
export async function claudeSessionFiles(configDir: string, sessionId: string, cwd: string, search: boolean): Promise<string[]> {
  if (!CONVERSATION_ID.test(sessionId)) return []
  const projectsDir = join(configDir, 'projects')
  const direct = join(projectsDir, claudeProjectKey(cwd), `${sessionId}.jsonl`)
  const transcript = search ? await findClaudeTranscript(projectsDir, sessionId, cwd) : (await exists(direct, 'file')) ? direct : null
  if (!transcript) return []
  const candidates = [
    join(dirname(transcript), sessionId),
    join(configDir, 'file-history', sessionId),
    join(configDir, 'session-env', sessionId),
    join(configDir, 'tasks', sessionId),
  ]
  const found = await Promise.all(candidates.map(async (path) => ((await exists(path, 'dir')) ? path : null)))
  return [transcript, ...found.filter((path): path is string => path !== null)]
}

/**
 * Codex's rollouts in one CODEX_HOME by thread id, also the archived ones: read once for all chats,
 * the folder can hold thousands of them.
 */
export async function codexRollouts(configDir: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>()
  for (const folder of ['sessions', 'archived_sessions']) {
    const root = join(configDir, folder)
    const files = await readdir(root, { recursive: true }).catch(() => [] as string[])
    for (const file of files) {
      const id = ROLLOUT_ID.exec(basename(file))?.[1]?.toLowerCase()
      if (!id) continue
      const list = index.get(id)
      const path = join(root, file)
      if (list) list.push(path)
      else index.set(id, [path])
    }
  }
  return index
}

/** Codex's rollouts of a thread in an index of `codexRollouts`. */
export function codexThreadFiles(index: Map<string, string[]>, threadId: string): string[] {
  return CONVERSATION_ID.test(threadId) ? (index.get(threadId.toLowerCase()) ?? []) : []
}

/**
 * Antigravity CLI's files of a conversation in a `.gemini` folder: the conversation itself first
 * (`antigravity-cli/conversations/<id>.db`), then its artifacts (`antigravity-cli/brain/<id>/`).
 */
export async function antigravitySessionFiles(dir: string, sessionId: string): Promise<string[]> {
  if (!CONVERSATION_ID.test(sessionId)) return []
  const paths = antigravityPaths(dir)
  const found: string[] = []
  for (const [path, kind] of [
    [join(paths.conversationsDir, `${sessionId}.db`), 'file'],
    [join(paths.brainDir, sessionId), 'dir'],
  ] as const) {
    if (await exists(path, kind)) found.push(path)
  }
  return found
}

/**
 * Whether Antigravity CLI can go on with a conversation: it keeps none that never had a prompt, so
 * the chat starts anew with its context instead.
 */
export async function antigravityResumable(dir: string, sessionId: string): Promise<boolean> {
  const [file] = await antigravitySessionFiles(dir, sessionId)
  return !!file?.endsWith('.db')
}

/** What a file or folder takes on disk, folders with everything in them; 0 for what isn't there. */
export async function diskSize(path: string): Promise<number> {
  const info = await stat(path).catch(() => null)
  if (!info) return 0
  if (!info.isDirectory()) return info.size
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  const sizes = await Promise.all(entries.map((entry) => diskSize(join(path, entry.name))))
  return sizes.reduce((sum, size) => sum + size, 0)
}
