import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codePageDecoder } from '../../lib/text-encoding'
import { isTaskOutputFile, outputFilesOf, readTaskOutput, repairReadOutput } from './output-encoding'

const cp850 = codePageDecoder(850)
const latin1 = (text: string) => Buffer.from(text, 'latin1')
// ping on a German Windows: „ausgeführt“ with ü as 0x81 (code page 850).
const PING = latin1('\r\nPing wird ausgef\x81hrt f\x81r 1.1.1.1 mit 32 Bytes Daten:\r\nAntwort von 1.1.1.1: Bytes=32 Zeit=3ms TTL=59\r\n')

describe('outputFilesOf', () => {
  it('finds the file a background shell writes to, with its task id', () => {
    const text =
      'Command running in background with ID: bshwydy0n. Output is being written to: C:\\Users\\Jo Doe\\AppData\\Local\\Temp\\claude\\dc32\\c421\\tasks\\bshwydy0n.output. You will be notified when it completes.'
    expect(outputFilesOf(text)).toEqual([{ taskId: 'bshwydy0n', file: 'C:\\Users\\Jo Doe\\AppData\\Local\\Temp\\claude\\dc32\\c421\\tasks\\bshwydy0n.output' }])
  })

  it('knows the other wordings and finds nothing in a plain answer', () => {
    expect(outputFilesOf('Output is being written to /tmp/claude-1000/x/tasks/b7.output; use Read on that path.')).toEqual([
      { taskId: 'b7', file: '/tmp/claude-1000/x/tasks/b7.output' },
    ])
    expect(outputFilesOf('total 0\n-rw-r--r-- a.output')).toEqual([])
  })
})

describe('isTaskOutputFile', () => {
  it("tells a shell's output file from others", () => {
    expect(isTaskOutputFile('C:\\Temp\\claude\\a\\b\\tasks\\bx1.output')).toBe(true)
    expect(isTaskOutputFile('/tmp/claude-1000/a/tasks/bx1.output')).toBe(true)
    expect(isTaskOutputFile('C:\\dev\\notes.output.md')).toBe(false)
  })
})

describe('readTaskOutput', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-output-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("reads a console program's output in its code page", async () => {
    const file = join(dir, 'b1.output')
    await writeFile(file, PING)
    const output = await readTaskOutput(file, cp850)
    expect(output.truncated).toBe(false)
    expect(output.text).toContain('Ping wird ausgeführt für 1.1.1.1')
  })

  it('keeps only the end of a long one, from the start of a line', async () => {
    const file = join(dir, 'b2.output')
    // 12 bytes, 11 bytes, 7 bytes.
    await writeFile(file, Buffer.concat([Buffer.from('erste Zeile\n'), latin1('zweite f\x81r\n'), Buffer.from('dritte\n')]))
    expect(await readTaskOutput(file, cp850, 18)).toEqual({ text: 'zweite für\ndritte\n', truncated: true })
    expect(await readTaskOutput(file, cp850, 17)).toEqual({ text: 'dritte\n', truncated: true })
  })
})

describe('repairReadOutput', () => {
  const read = (lines: string[]) => lines.map((line, i) => `${i + 1}\t${line}`).join('\n')
  const NOTE =
    '[This file is not valid UTF-8: it uses a legacy encoding such as Windows-1252, Shift-JIS or GBK, or it is binary. Its undecodable bytes show above as U+FFFD. Edit and Write will refuse it: change it with a shell command that keeps its encoding, or ask the user whether to convert it to UTF-8.]'

  it('reads the lines Claude Code showed `�` in from the bytes, and drops its note then', () => {
    const output = `${read(['', 'Ping wird ausgef�hrt f�r 1.1.1.1 mit 32 Bytes Daten:', 'Antwort von 1.1.1.1: Bytes=32 Zeit=3ms TTL=59', ''])}\n\n${NOTE}`
    expect(repairReadOutput(output, PING, cp850)).toBe(read(['', 'Ping wird ausgeführt für 1.1.1.1 mit 32 Bytes Daten:', 'Antwort von 1.1.1.1: Bytes=32 Zeit=3ms TTL=59', '']))
  })

  it('leaves a line alone that the file no longer has, and the note with it', () => {
    const output = `${read(['', 'Ping wird ausgef�hrt f�r 9.9.9.9 mit 32 Bytes Daten:'])}\n\n${NOTE}`
    expect(repairReadOutput(output, PING, cp850)).toBeNull()
  })

  it('counts from the line a Read started at', () => {
    const output = `2\tPing wird ausgef�hrt f�r 1.1.1.1 mit 32 Bytes Daten:\n3\tAntwort von 1.1.1.1: Bytes=32 Zeit=3ms TTL=59`
    expect(repairReadOutput(output, PING, cp850)).toBe('2\tPing wird ausgeführt für 1.1.1.1 mit 32 Bytes Daten:\n3\tAntwort von 1.1.1.1: Bytes=32 Zeit=3ms TTL=59')
  })

  it('has nothing to do without `�`', () => {
    expect(repairReadOutput(read(['Grüße']), Buffer.from('Grüße\n'))).toBeNull()
  })
})
