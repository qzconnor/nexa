import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { claudeProjectKey } from './cli-files'
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
 * Gemini CLI's files of a conversation in a `.gemini` folder, the conversation itself first
 * (`tmp/<project>/chats/session-<time>-<first 8 of the id>.jsonl`, its header names the whole id),
 * then what goes with it: its logs, saved tool output and its folders. Every project folder is looked
 * at: Gemini CLI names them after the working directory in its own `projects.json`.
 */
export async function geminiSessionFiles(geminiDir: string, sessionId: string): Promise<string[]> {
  if (!CONVERSATION_ID.test(sessionId)) return []
  const tmp = join(geminiDir, 'tmp')
  const projects = await readdir(tmp, { withFileTypes: true }).catch(() => [])
  const short = sessionId.slice(0, 8)
  const chats: string[] = []
  const rest: string[] = []
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const dir = join(tmp, project.name)
    const names = await readdir(join(dir, 'chats')).catch(() => [] as string[])
    for (const name of names) {
      if (!name.startsWith('session-') || !/\.jsonl?$/.test(name) || !name.replace(/\.jsonl?$/, '').endsWith(`-${short}`)) continue
      const file = join(dir, 'chats', name)
      if (await headerNames(file, sessionId)) chats.push(file)
    }
    const around = [
      [join(dir, 'chats', sessionId), 'dir'],
      [join(dir, sessionId), 'dir'],
      [join(dir, 'logs', `session-${sessionId}.jsonl`), 'file'],
      [join(dir, 'tool-outputs', `session-${sessionId}`), 'dir'],
    ] as const
    for (const [path, kind] of around) if (await exists(path, kind)) rest.push(path)
  }
  return [...chats, ...rest]
}

/** Whether a conversation file of Gemini CLI is the one of `sessionId` (its first line says). */
async function headerNames(file: string, sessionId: string): Promise<boolean> {
  const text = await readFile(file, 'utf8').catch(() => '')
  return text.slice(0, 2000).includes(`"sessionId":"${sessionId}"`)
}

/**
 * Whether Gemini CLI can go on with a conversation: one whose first prompt failed keeps nothing it
 * resumes (`session/load` refuses it), so the chat starts anew with its context instead.
 */
export async function geminiResumable(geminiDir: string, sessionId: string): Promise<boolean> {
  const [file] = await geminiSessionFiles(geminiDir, sessionId)
  if (!file || !/\.jsonl?$/.test(file)) return false
  const text = await readFile(file, 'utf8').catch(() => '')
  return /"type"\s*:\s*"gemini"/.test(text)
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
