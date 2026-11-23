import type { ToolItem } from '@shared/chat'
import type { FileTouch } from '@shared/files'
import { isPlainObject } from '@shared/utils'
import { commandView } from '../providers/codex/codex-run'
import { shellFiles } from './shell-files'

/**
 * What a tool does with files beyond the paths its item names (those the window reads from the chat
 * itself, see shared/file-touches.ts): the files a shell command reads, searches and writes, and the
 * commit it makes. Taken over from the Claude Manager, where hooks reported the same.
 */
export interface FileActivity {
  /** Files a tool reads or writes. */
  touches?: FileTouch[]
  /** Paths that count only where they are files: a shell command's arguments, what a search found. */
  maybe?: FileTouch[]
  /** A commit was made in this folder. */
  commit?: string
  /**
   * A shell command starts or ended. Files that change in `cwd` meanwhile are what it writes; at its
   * end so are the `writes` it names, if they changed since it started.
   */
  shell?: { id: string; cwd: string; end: boolean; writes: string[] }
}

/**
 * Whether a shell command (bash or PowerShell) commits: `git commit`, also with options between
 * (`git -C repo commit`), as `git.exe` or `& git`. Part by part (`;`, `&`, `|`, new line) instead of one
 * pattern over all: `git[^;]*\scommit` backtracks over each `git` of a long command, 64 KB of them took
 * most of a second. A line ending in `\` (bash) or a backtick (PowerShell) goes on in the next one.
 */
export function commitsInShell(command: string): boolean {
  return command
    .replace(/[\\`]\r?\n/g, ' ')
    .split(/[;&|\n]/)
    .some((part) => {
      // Windows finds the program in any case (`GIT commit`), git its own commands only in lower case.
      const git = /\bgit\b/i.exec(part)
      return git !== null && /\scommit\b/.test(part.slice(git.index + 3))
    })
}

/** The command of a shell tool without the shell Codex wraps it in, and whether it is PowerShell. */
function shellCommand(item: ToolItem): { command: string; cwd: string | null; powershell: boolean } | null {
  const input = isPlainObject(item.input) ? item.input : null
  const raw = typeof input?.command === 'string' ? input.command : null
  if (!raw) return null
  const cwd = typeof input?.cwd === 'string' && input.cwd ? input.cwd : null
  if (item.name === 'commandExecution') {
    // On Windows Codex runs its commands in PowerShell; the quoting of the inner command follows it.
    const powershell = /^\s*"?(?:[^"\s]*[\\/])?(?:powershell|pwsh)(?:\.exe)?"?\s/i.test(raw)
    return { command: commandView(raw, undefined).command, cwd, powershell }
  }
  return { command: raw, cwd, powershell: item.name === 'PowerShell' }
}

/**
 * The activity of a shell tool at its start or end (`phase`), for the file tree to follow what it
 * writes. Other tools: null.
 */
export function shellActivity(item: ToolItem, sessionCwd: string, phase: 'start' | 'end'): FileActivity | null {
  if (item.tool !== 'bash') return null
  const shell = shellCommand(item)
  if (!shell) return null
  const cwd = shell.cwd ?? sessionCwd
  const files = shellFiles(shell.command, cwd, shell.powershell)
  if (phase === 'start') {
    const maybe: FileTouch[] = [
      ...files.reads.map((path) => ({ path, kind: 'read' as const })),
      ...files.searches.map((path) => ({ path, kind: 'search' as const })),
    ]
    return { ...(maybe.length && { maybe }), shell: { id: item.id, cwd, end: false, writes: [] } }
  }
  const commit = item.status === 'done' && commitsInShell(shell.command)
  return { ...(commit && { commit: cwd }), shell: { id: item.id, cwd, end: true, writes: files.writes } }
}
