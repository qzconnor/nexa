import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The file a project's or a separator's prompt lives in, in its folder. */
export const PROMPT_FILE = 'prompts.md'

/** Longer than any prompt anyone writes by hand; a bigger file isn't one. */
const MAX_PROMPT_LENGTH = 100_000

/** A folder's prompt for a session's system prompt. */
export interface FolderPrompt {
  /** The project's or separator's name. */
  name: string
  path: string
  text: string
}

const stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

/** The prompt of a folder; empty without one. */
export async function readFolderPrompt(folder: string): Promise<string> {
  const text = await readFile(join(folder, PROMPT_FILE), 'utf8').then(stripBom, () => '')
  return text.length > MAX_PROMPT_LENGTH ? '' : text
}

/** Writes a folder's prompt; an empty one where none was leaves no file behind. */
export async function writeFolderPrompt(folder: string, text: string): Promise<void> {
  const file = join(folder, PROMPT_FILE)
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (normalized.length > MAX_PROMPT_LENGTH) throw new Error('Der Prompt ist zu lang (höchstens 100.000 Zeichen).')
  if (!normalized && !existsSync(file)) return
  await writeFile(file, normalized ? `${normalized}\n` : '', 'utf8')
}

/** The prompts of the folders a session lies in, the outermost first, as the system prompt gets them. */
export function folderPromptText(prompts: readonly FolderPrompt[]): string {
  return prompts
    .filter((p) => p.text.trim())
    .map((p) => `The user set these instructions for "${p.name}" (${p.path}). Follow them in this session:\n\n${p.text.trim()}\n`)
    .join('\n')
}
