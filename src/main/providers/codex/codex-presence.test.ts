import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { codexThreadHeld, codexWriterLock } from './codex-presence'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nexa-codex-presence-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('codexThreadHeld', () => {
  const thread = '01a20a44-5e41-7c42-b2e3-f3603fac2443'

  it('cannot tell outside Windows', async () => {
    expect(await codexThreadHeld(root, thread, 'linux')).toBeNull()
  })

  it.runIf(process.platform === 'win32')('tells a lock another process holds from one left behind', async () => {
    expect(await codexThreadHeld(root, thread)).toBe(false)
    const lock = codexWriterLock(root, thread)
    await mkdir(dirname(lock), { recursive: true })
    await writeFile(lock, '')
    expect(await codexThreadHeld(root, thread)).toBe(false)

    const holder = spawn(process.execPath, ['-e', `require('fs').openSync(${JSON.stringify(lock)}, 'r+'); process.stdout.write('open'); setTimeout(() => {}, 20000)`])
    try {
      await new Promise<void>((resolve) => holder.stdout.once('data', () => resolve()))
      expect(await codexThreadHeld(root, thread)).toBe(true)
    } finally {
      holder.kill()
    }
    await new Promise((resolve) => holder.once('exit', resolve))
    expect(await codexThreadHeld(root, thread)).toBe(false)
  })
})
