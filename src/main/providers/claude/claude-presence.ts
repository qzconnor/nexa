import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isPlainObject } from '@shared/utils'

/**
 * Where else a Claude Code session is open: every Claude Code process keeps an entry in
 * `<config>/sessions/<pid>.json` (`sessionId`, `entrypoint`, `status`) while it runs. Two processes
 * on one session both write to its transcript, and each goes on from what it knows; the chat should
 * go on in one place only.
 */

export interface OpenElsewhere {
  pid: number
  /** Where it runs, in words: „Claude Code im Terminal“, „Claude Desktop“ … */
  where: string
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: it runs, under another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The programs Claude Code names as its entry point. */
export function whereOpen(entrypoint: unknown): string {
  switch (entrypoint) {
    case 'cli':
      return 'Claude Code im Terminal'
    case 'claude-desktop':
      return 'Claude Desktop'
    case 'claude-vscode':
      return 'VS Code'
    default:
      return 'einem anderen Programm'
  }
}

/**
 * A process other than `own` (Nexa's own run of the chat) that has the session open now; null when
 * none does. Entries of processes that are gone stay behind after a crash and are passed over.
 */
export async function claudeOpenElsewhere(configDir: string, sessionId: string, own?: number): Promise<OpenElsewhere | null> {
  const dir = join(configDir, 'sessions')
  const names = await readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue
    const entry = await readFile(join(dir, name), 'utf8')
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null)
    if (!isPlainObject(entry) || entry.sessionId !== sessionId || typeof entry.pid !== 'number') continue
    if (entry.pid === own || !alive(entry.pid)) continue
    return { pid: entry.pid, where: whereOpen(entry.entrypoint) }
  }
  return null
}
