import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ChatItem } from '@shared/chat'
import { isPlainObject } from '@shared/utils'
import { claudeTranscriptItems, type SubagentTranscript } from '../providers/claude/claude-transcript'

/** A Claude Code transcript in a config folder (`projects/<key>/<id>.jsonl`). */
export interface TranscriptFile {
  /** Claude Code's session id. */
  id: string
  file: string
  /** The config folder it lies in. */
  configDir: string
  mtimeMs: number
}

/** The transcripts in a Claude Code config folder; none when it has no `projects`. */
export async function listTranscripts(configDir: string): Promise<TranscriptFile[]> {
  const projectsDir = join(configDir, 'projects')
  const keys = await readdir(projectsDir, { withFileTypes: true }).catch(() => [])
  const found: TranscriptFile[] = []
  for (const key of keys) {
    if (!key.isDirectory()) continue
    const dir = join(projectsDir, key.name)
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
      const file = join(dir, entry.name)
      const info = await stat(file).catch(() => null)
      if (info) found.push({ id: entry.name.slice(0, -'.jsonl'.length), file, configDir, mtimeMs: info.mtimeMs })
    }
  }
  return found
}

/**
 * The chat of a Claude Code transcript, its subagents' work included: Claude Code keeps each one's
 * transcript in `<id>/subagents/agent-*.jsonl` beside it, with the call that started it in `.meta.json`.
 */
export async function readClaudeChat(file: string): Promise<ChatItem[]> {
  const text = await readFile(file, 'utf8')
  const dir = join(dirname(file), basename(file, '.jsonl'), 'subagents')
  const names = await readdir(dir).catch(() => [] as string[])
  const subagents: SubagentTranscript[] = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const meta = await readFile(join(dir, `${name.slice(0, -'.jsonl'.length)}.meta.json`), 'utf8')
      .then((raw) => JSON.parse(raw) as unknown)
      .catch(() => null)
    const toolUseId = isPlainObject(meta) && typeof meta.toolUseId === 'string' ? meta.toolUseId : null
    if (!toolUseId) continue
    const agent = await readFile(join(dir, name), 'utf8').catch(() => null)
    if (agent) subagents.push({ toolUseId, text: agent })
  }
  return claudeTranscriptItems(text, subagents)
}
