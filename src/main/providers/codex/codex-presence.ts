import { closeSync, openSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Whether a Codex thread is open somewhere: the process that has it loaded (the TUI, VS Code, the
 * desktop app, an app-server like Nexa's) holds `<CODEX_HOME>/thread-writer-locks/<thread>.lock`, and
 * every other one is refused the thread („already has an active writer“) until it lets go.
 */

/** `UV_FS_O_EXLOCK`: an open that fails (EBUSY) while another handle has the file. Node doesn't export it on Windows. */
const EXCLUSIVE = 0x10000000

export function codexWriterLock(configDir: string, threadId: string): string {
  return join(configDir, 'thread-writer-locks', `${threadId}.lock`)
}

/**
 * Is the thread held by a process now; null where that can't be told (outside Windows Codex locks
 * with `flock`, which a look from Node doesn't see).
 */
export async function codexThreadHeld(configDir: string, threadId: string, platform = process.platform): Promise<boolean | null> {
  if (platform !== 'win32') return null
  const file = codexWriterLock(configDir, threadId)
  // The lock goes with the process that let go.
  if (!(await access(file).then(() => true, () => false))) return false
  try {
    closeSync(openSync(file, EXCLUSIVE))
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
  }
}
