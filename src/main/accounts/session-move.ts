import { appendFile, mkdir, open, rename, rmdir, stat, truncate } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { folderKey } from '@shared/folders'
import { claudeProjectKey } from './cli-files'

/**
 * A Claude Code session that goes on in another folder, as after `/cd` (from the Claude Manager):
 * Claude Code resumes a session only from the project folder of the directory it starts in.
 */

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

async function isDirectory(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  )
}

/**
 * Appends a line, on a line of its own also when the transcript ends in the middle of one. Failing,
 * it cuts off what it wrote of it: the transcript stays as it was.
 */
async function appendLine(file: string, line: string): Promise<void> {
  const handle = await open(file, 'r')
  let ending = ''
  let size = 0
  try {
    size = (await handle.stat()).size
    if (size > 0) {
      const last = Buffer.alloc(1)
      await handle.read(last, 0, 1, size - 1)
      ending = last[0] === 0x0a ? '' : '\n'
    }
  } finally {
    await handle.close()
  }
  try {
    await appendFile(file, `${ending}${line}\n`, 'utf8')
  } catch (error) {
    await truncate(file, size).catch(() => undefined)
    throw error
  }
}

/** Moves back what moved, last first; false when something stays in the new place. */
async function moveBack(moved: readonly (readonly [from: string, to: string])[]): Promise<boolean> {
  let back = true
  for (const [from, to] of [...moved].reverse()) {
    await rename(to, from).catch((error: unknown) => {
      console.warn(`[sessions] ${to} could not move back to ${from}`, error)
      back = false
    })
  }
  return back
}

/**
 * Moves the transcript of a session (and the folder next to it: subagents, saved tool output) into
 * the project folder of `cwd`, then adds a `relocated` entry, so Claude Code resumes it there. The
 * project folder it leaves goes if nothing else is in it; the memory stays, it belongs to the folder.
 * Resolves to the transcript's new path; null when one of the session lies there already (a copy):
 * then nothing moved, and Claude Code resumes that one.
 * A step failing (a transcript a virus scanner holds, a full disk), what moved goes back: half a move
 * would leave Claude Code a session without its subagents, or one that doesn't know it moved.
 * The caller makes sure no running Claude Code has the session open.
 */
export async function relocateClaudeSession(projectsDir: string, transcript: string, sessionId: string, cwd: string): Promise<string | null> {
  const source = dirname(transcript)
  const targetDir = join(projectsDir, claudeProjectKey(cwd))
  const elsewhere = folderKey(source) !== folderKey(targetDir)
  const target = elsewhere ? join(targetDir, basename(transcript)) : transcript
  if (elsewhere && (await exists(target))) return null
  const moved: [from: string, to: string][] = []
  try {
    if (elsewhere) {
      await mkdir(targetDir, { recursive: true })
      // The folder next to it first: Claude Code finds the session once the transcript is there.
      const extras = join(source, sessionId)
      if ((await isDirectory(extras)) && !(await exists(join(targetDir, sessionId)))) {
        await rename(extras, join(targetDir, sessionId))
        moved.push([extras, join(targetDir, sessionId)])
      }
      await rename(transcript, target)
      moved.push([transcript, target])
    }
    await appendLine(target, JSON.stringify({ type: 'relocated', sessionId, relocatedCwd: cwd }))
  } catch (error) {
    const back = await moveBack(moved)
    // Made for it and empty again: it goes.
    if (elsewhere) await rmdir(targetDir).catch(() => undefined)
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(back ? `Der Chat bleibt im alten Ordner: ${reason}` : `Die Unterhaltung von Claude Code ist nur zum Teil verschoben: ${reason}`)
  }
  // Only an empty one: whatever else lies there (other sessions, the memory) stays.
  if (elsewhere) await rmdir(source).catch(() => undefined)
  return target
}
