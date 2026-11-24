import { open, readFile, stat } from 'node:fs/promises'
import type { ShellOutput } from '@shared/types'
import { consoleDecoder } from '../../lib/console-code-page'
import { decodeText, type ByteDecoder } from '../../lib/text-encoding'

/**
 * Claude Code reads what its shells write as UTF-8. Windows' console programs (ping, ipconfig …)
 * write in the DOS code page instead, so their umlauts reach Nexa as `�`, in the shell's output as
 * in a Read of its file. The bytes are still in the files, and Nexa reads them itself.
 */

/** Of a shell's output, as much as is read from the end of its file. */
const MAX_OUTPUT_BYTES = 64 * 1024
/** A Read of a larger file isn't read again (Claude Code reads only so much of one anyway). */
const MAX_READ_BYTES = 8 * 1024 * 1024

/** The output files a Bash call's answer names („Output is being written to: …\tasks\b1x2.output“), with their task ids. */
export function outputFilesOf(text: string): { taskId: string; file: string }[] {
  const found: { taskId: string; file: string }[] = []
  // Up to the first `.output`: the path may hold spaces (a user folder), the sentence goes on after it.
  for (const match of text.matchAll(/Output is being written to:?\s+(\S.*?\.output)(?=[\s.;,)]|$)/gm)) {
    const file = match[1]!
    const taskId = /([^\\/]+)\.output$/.exec(file)?.[1]
    if (taskId) found.push({ taskId, file })
  }
  return found
}

/** A shell's output file of Claude Code (`…/tasks/<id>.output`): a console program's output, so its code page. */
export function isTaskOutputFile(path: string): boolean {
  return /[\\/]tasks[\\/][^\\/]+\.output$/i.test(path)
}

/** The end of a shell's output file, lines that aren't UTF-8 read in `fallback`. */
export async function readTaskOutput(file: string, fallback?: ByteDecoder, maxBytes = MAX_OUTPUT_BYTES): Promise<ShellOutput> {
  const handle = await open(file, 'r')
  try {
    const { size } = await handle.stat()
    const truncated = size > maxBytes
    // Cut off, from the first whole line on (one byte before, to see whether one starts right there).
    const start = truncated ? size - maxBytes - 1 : 0
    const buffer = Buffer.alloc(size - start)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
    let bytes = buffer.subarray(0, bytesRead)
    if (truncated) {
      const newline = bytes.indexOf(0x0a)
      if (newline !== -1) bytes = bytes.subarray(newline + 1)
    }
    return { text: decodeText(bytes, fallback), truncated }
  } finally {
    await handle.close()
  }
}

const LOSSY_UTF8 = new TextDecoder('utf-8')
/** A line of a Read's answer, numbered like `cat -n`: number, tab (an arrow in older versions), text. */
const NUMBERED = /^(\s*(\d+)(?:\t|→))(.*)$/
/** What Claude Code adds to a Read of such a file; with its lines read right, it no longer holds. */
const UTF8_NOTE = /\n*\[This file is not valid UTF-8[^\n]*\]\s*$/

function lines(bytes: Uint8Array): Uint8Array[] {
  const result: Uint8Array[] = []
  let start = 0
  while (start <= bytes.length) {
    const newline = bytes.indexOf(0x0a, start)
    const end = newline === -1 ? bytes.length : newline
    result.push(bytes.subarray(start, end > start && bytes[end - 1] === 0x0d ? end - 1 : end))
    if (newline === -1) break
    start = newline + 1
  }
  return result
}

/**
 * A Read's answer with the lines Claude Code showed `�` in read from the file's `bytes`, each only if
 * it is the very line Claude Code read (the file may have changed since). Null when none is.
 */
export function repairReadOutput(output: string, bytes: Uint8Array, fallback?: ByteDecoder): string | null {
  if (!output.includes('�')) return null
  const file = lines(bytes)
  let repaired = 0
  let left = 0
  const result = output.split('\n').map((line) => {
    if (!line.includes('�')) return line
    const match = NUMBERED.exec(line)
    const raw = match ? file[Number(match[2]) - 1] : undefined
    if (!match || !raw || LOSSY_UTF8.decode(raw) !== match[3]!.replace(/\r$/, '')) {
      left++
      return line
    }
    repaired++
    return match[1] + decodeText(raw, fallback)
  })
  if (!repaired) return null
  const text = result.join('\n')
  return left ? text : text.replace(UTF8_NOTE, '')
}

/** `repairReadOutput` for the file a Read read: a shell's output in the console's code page, others in Windows-1252. */
export async function repairReadFile(path: string, output: string): Promise<string | null> {
  if (!output.includes('�')) return null
  const { size } = await stat(path)
  if (size > MAX_READ_BYTES) return null
  const fallback = isTaskOutputFile(path) ? await consoleDecoder() : undefined
  return repairReadOutput(output, await readFile(path), fallback)
}
