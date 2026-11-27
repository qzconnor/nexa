import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { ChatItem } from '@shared/chat'
import { isPlainObject } from '@shared/utils'
import { claudeTranscriptItems, transcriptSince, type SubagentTranscript } from '../providers/claude/claude-transcript'

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

/** The transcript of one session in a config folder, in whichever project folder it lies; null without one. */
export async function findTranscript(configDir: string, id: string): Promise<TranscriptFile | null> {
  // The id becomes a file name.
  if (!/^[\w-]+$/.test(id)) return null
  const projectsDir = join(configDir, 'projects')
  const keys = await readdir(projectsDir, { withFileTypes: true }).catch(() => [])
  let found: TranscriptFile | null = null
  for (const key of keys) {
    if (!key.isDirectory()) continue
    const file = join(projectsDir, key.name, `${id}.jsonl`)
    const info = await stat(file).catch(() => null)
    if (info?.isFile() && (!found || info.mtimeMs > found.mtimeMs)) found = { id, file, configDir, mtimeMs: info.mtimeMs }
  }
  return found
}

/**
 * The chat of a Claude Code transcript, its subagents' work included: Claude Code keeps each one's
 * transcript in `<id>/subagents/agent-*.jsonl` beside it, with the call that started it in `.meta.json`.
 */
export async function readClaudeChat(file: string): Promise<ChatItem[]> {
  const text = await readFile(file, 'utf8')
  return claudeTranscriptItems(text, await readSubagents(file))
}

/**
 * The turns a Claude Code transcript gained after `since` (ms), finished ones only, as items to add to
 * a chat that holds `known`; `last`: the time to read on from next. Null when there is nothing new.
 */
export async function readClaudeChatSince(file: string, since: number, known: readonly ChatItem[]): Promise<{ items: ChatItem[]; last: number } | null> {
  const added = await readTranscriptSince(file, since)
  if (!added) return null
  return { items: claudeTranscriptItems(added.text, await readSubagents(file, since), known), last: added.last }
}

/** How much of a transcript's end is read first; four times more each time that isn't enough. */
export const TAIL_BYTES = 256 * 1024

/**
 * `transcriptSince` on the transcript's end only: one of a long chat runs to tens of MB, and reading
 * and splitting it whole held up the main process on every opening of the chat.
 */
export async function readTranscriptSince(file: string, since: number, tailBytes = TAIL_BYTES): Promise<{ text: string; last: number } | null> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    for (let length = tailBytes; ; length *= 4) {
      const start = Math.max(0, size - length)
      const buffer = Buffer.alloc(size - start)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      let text = buffer.toString('utf8', 0, bytesRead)
      // The first line from the middle of the file is cut off (maybe in a character): left out.
      if (start > 0) text = text.slice(text.indexOf('\n') + 1)
      const added = transcriptSince(text, since, start === 0)
      if (added !== undefined) return added
    }
  } finally {
    await handle.close()
  }
}

/** The subagents' transcripts beside a session's; with `since`, only those written to after it. */
async function readSubagents(file: string, since?: number): Promise<SubagentTranscript[]> {
  const dir = join(dirname(file), basename(file, '.jsonl'), 'subagents')
  const names = await readdir(dir).catch(() => [] as string[])
  const subagents: SubagentTranscript[] = []
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    if (since !== undefined) {
      const info = await stat(join(dir, name)).catch(() => null)
      if (!info || info.mtimeMs <= since) continue
    }
    const meta = await readFile(join(dir, `${name.slice(0, -'.jsonl'.length)}.meta.json`), 'utf8')
      .then((raw) => JSON.parse(raw) as unknown)
      .catch(() => null)
    const toolUseId = isPlainObject(meta) && typeof meta.toolUseId === 'string' ? meta.toolUseId : null
    if (!toolUseId) continue
    const agent = await readFile(join(dir, name), 'utf8').catch(() => null)
    if (agent) subagents.push({ toolUseId, text: agent })
  }
  return subagents
}
