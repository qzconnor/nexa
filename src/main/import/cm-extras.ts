import { folderKey } from '@shared/folders'
import type { ImportExtra } from '@shared/import-ipc'
import type { SessionMeta } from '@shared/types'
import { baseName, firstLine } from '@shared/utils'

/**
 * What of the Claude Manager's Nexa takes over besides the sessions (see `ImportExtra`). Only what
 * Nexa doesn't have yet is offered, so running the import again catches up on what came in the Claude
 * Manager since, or was left out the first time.
 */

/** A workspace's prompt in the Claude Manager (`cm_prompts.md`) and what Nexa has in its folder (`prompts.md`). */
export interface WorkspacePrompt {
  path: string
  text: string
  current: string
}

/** A theme file of the Claude Manager, with its theme's name. */
export interface CmTheme {
  file: string
  name: string
}

export type ExtraTask =
  | { kind: 'prompt'; path: string; text: string }
  | { kind: 'theme'; file: string }
  | { kind: 'names'; renames: { id: string; title: string }[] }
  | { kind: 'pins'; ids: string[] }

/** An extra as offered, with what taking it over does; none when it is only shown (`blocked`). */
export interface PlannedExtra {
  extra: ImportExtra
  task?: ExtraTask
}

export interface ExtrasInput {
  prompts: readonly WorkspacePrompt[]
  themes: readonly CmTheme[]
  /** The names of Nexa's own themes. */
  nexaThemes: readonly string[]
  /** Names given in the Claude Manager, by session id in lower case. */
  names: Readonly<Record<string, string>>
  /** Sessions pinned in the Claude Manager, by session id in lower case. */
  pinned: ReadonlySet<string>
  chats: readonly Pick<SessionMeta, 'id' | 'title' | 'titleSource' | 'pinned' | 'cli'>[]
}

const themeKey = (name: string) => name.trim().toLocaleLowerCase('de')
const quoted = (titles: readonly string[]) => titles.map((t) => `„${t}“`).join(', ')

export function planExtras(input: ExtrasInput): PlannedExtra[] {
  const planned: PlannedExtra[] = []

  for (const { path, text, current } of input.prompts) {
    const own = text.trim()
    if (!own || current.trim() === own) continue
    const extra: ImportExtra = { id: `prompt:${folderKey(path)}`, kind: 'prompt', label: `Prompt von „${baseName(path)}“`, detail: firstLine(own, 100) }
    // Written in Nexa meanwhile: the user's newer word isn't overwritten.
    if (current.trim()) planned.push({ extra: { ...extra, blocked: 'In Nexa hat der Ordner schon einen anderen Prompt.' } })
    else planned.push({ extra, task: { kind: 'prompt', path, text: own } })
  }

  // By name: a theme taken over before keeps its name in Nexa, and two files of one theme come once.
  const taken = new Set(input.nexaThemes.map(themeKey))
  for (const { file, name } of input.themes) {
    if (taken.has(themeKey(name))) continue
    taken.add(themeKey(name))
    planned.push({ extra: { id: `theme:${folderKey(file)}`, kind: 'theme', label: `Theme „${name}“` }, task: { kind: 'theme', file } })
  }

  const renames: { id: string; title: string }[] = []
  const pins: { id: string; title: string }[] = []
  for (const chat of input.chats) {
    const session = chat.cli.claude?.sessionId.toLowerCase()
    if (!session) continue
    const name = input.names[session]
    // A name the chat got in Nexa (or with the import before) stays; only one Nexa made up gives way.
    if (name && chat.titleSource !== 'user' && chat.title !== name) renames.push({ id: chat.id, title: name })
    if (input.pinned.has(session) && !chat.pinned) pins.push({ id: chat.id, title: name ?? chat.title })
  }
  if (renames.length) {
    planned.push({
      extra: { id: 'names', kind: 'names', label: renames.length === 1 ? '1 Name einer Session' : `${renames.length} Namen von Sessions`, detail: quoted(renames.map((r) => r.title)) },
      task: { kind: 'names', renames },
    })
  }
  if (pins.length) {
    planned.push({
      extra: { id: 'pins', kind: 'pins', label: pins.length === 1 ? '1 angeheftete Session' : `${pins.length} angeheftete Sessions`, detail: quoted(pins.map((p) => p.title)) },
      task: { kind: 'pins', ids: pins.map((p) => p.id) },
    })
  }
  return planned
}
