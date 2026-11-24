import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageSamples } from './usage-samples'

const HOUR = 3_600_000
const reset = 5 * HOUR
const window = (usedPercent: number) => ({ key: 'five_hour', label: '5 Stunden', usedPercent, resetsAt: reset, windowMinutes: 300 })

describe('UsageSamples', () => {
  let dir: string | null = null
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = null
  })

  it('gives each window the forecast from its readings, per account', () => {
    const samples = new UsageSamples(null)
    samples.record('a', 1 * HOUR, [window(10)])
    const [later] = samples.record('a', 2 * HOUR, [window(40)])
    expect(later!.forecast).toMatchObject({ basis: 'recent', ratePerHour: 30, exhaustsAt: 4 * HOUR })
    // Another account's readings are its own: one reading after 2 h, the average since the start.
    const [other] = samples.record('b', 2 * HOUR, [window(40)])
    expect(other!.forecast).toMatchObject({ basis: 'window', ratePerHour: 20 })
  })

  it('gives no forecast to a window it can’t place', () => {
    const [w] = new UsageSamples(null).record('a', HOUR, [{ key: 'primary', label: 'x', usedPercent: 5 }])
    expect(w!.forecast).toBeNull()
  })

  it('keeps the readings over a restart, without those of a removed account', async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-usage-'))
    const file = join(dir, 'usage-samples.json')
    const first = new UsageSamples(file)
    first.record('a', 1 * HOUR, [window(10)])
    first.record('gone', 1 * HOUR, [window(10)])
    first.forget('gone')
    await first.flush()
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')).samples)).toEqual(['a\nfive_hour'])
    const [w] = new UsageSamples(file).record('a', 2 * HOUR, [window(40)])
    expect(w!.forecast).toMatchObject({ basis: 'recent', ratePerHour: 30 })
  })
})
