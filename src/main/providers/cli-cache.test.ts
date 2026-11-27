import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cachedForFile, keepCliCacheIn, keepForFile, resetCliCache } from './cli-cache'

describe('cli-cache', () => {
  let dir: string
  let cli: string
  let cacheFile: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-cli-cache-'))
    cli = join(dir, 'agy.exe')
    cacheFile = join(dir, 'cli-cache.json')
    await writeFile(cli, 'binary')
  })

  afterEach(async () => {
    // The cache writes on its own: the folder goes only once that is done.
    await resetCliCache()
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps nothing without a file to keep it in', () => {
    keepForFile('version', cli, '1.0.0')
    expect(cachedForFile('version', cli)).toBeUndefined()
  })

  it('answers while the CLI is the same file, also after a restart', async () => {
    keepCliCacheIn(cacheFile)
    keepForFile('version', cli, '1.0.0')
    expect(cachedForFile('version', cli)).toBe('1.0.0')
    await resetCliCache()
    expect(await readFile(cacheFile, 'utf8')).toContain('1.0.0')
    keepCliCacheIn(cacheFile)
    expect(cachedForFile('version', cli)).toBe('1.0.0')
  })

  it('forgets the answer once the CLI was replaced or is gone', async () => {
    keepCliCacheIn(cacheFile)
    keepForFile('version', cli, '1.0.0')
    await utimes(cli, new Date(), new Date(Date.now() + 60_000))
    expect(cachedForFile('version', cli)).toBeUndefined()
    await rm(cli)
    expect(cachedForFile('version', cli)).toBeUndefined()
  })
})
