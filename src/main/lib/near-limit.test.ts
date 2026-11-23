import { describe, expect, it } from 'vitest'
import type { UsageWindow } from '@shared/types'
import { nearLimits, type WarnedWindows } from './near-limit'

const NOW = Date.parse('2026-11-23T12:00:00Z')
const LATER = Date.parse('2026-11-23T15:00:00Z')
const EARLIER = Date.parse('2026-11-23T11:00:00Z')

function window(key: string, usedPercent: number, resetsAt: number | null = LATER): UsageWindow {
  return { key, label: key, usedPercent, resetsAt: resetsAt ?? undefined }
}

const usage = (windows: UsageWindow[], accountId = 'a') => ({ accountId, windows })
const keys = (reached: ReturnType<typeof nearLimits>) => reached.map((r) => `${r.window.key} ${r.percent}`)

describe('nearLimits', () => {
  it('warns about windows at or above the threshold, rounded as shown', () => {
    const warned: WarnedWindows = {}
    const reached = nearLimits(usage([window('five_hour', 79.6), window('seven_day', 79.4)]), 80, warned, NOW)
    expect(keys(reached)).toEqual(['five_hour 80'])
    expect(warned).toEqual({ 'a\nfive_hour': LATER })
  })

  it('sorts several windows highest first and clamps to 100', () => {
    const reached = nearLimits(usage([window('five_hour', 85), window('seven_day', 130), window('opus', 90)]), 80, {}, NOW)
    expect(keys(reached)).toEqual(['seven_day 100', 'opus 90', 'five_hour 85'])
  })

  it('warns once per window, even when the value moves around the threshold', () => {
    const warned: WarnedWindows = {}
    expect(nearLimits(usage([window('five_hour', 81)]), 80, warned, NOW)).toHaveLength(1)
    expect(nearLimits(usage([window('five_hour', 79)]), 80, warned, NOW)).toHaveLength(0)
    expect(nearLimits(usage([window('five_hour', 83)]), 80, warned, NOW)).toHaveLength(0)
  })

  it('warns again after the value fell more than the margin below the threshold', () => {
    const warned: WarnedWindows = {}
    nearLimits(usage([window('five_hour', 81)]), 80, warned, NOW)
    nearLimits(usage([window('five_hour', 74)]), 80, warned, NOW)
    expect(warned).toEqual({})
    expect(nearLimits(usage([window('five_hour', 80)]), 80, warned, NOW)).toHaveLength(1)
  })

  it('warns again once the remembered reset has passed, e.g. after a restart', () => {
    const warned: WarnedWindows = { 'a\nfive_hour': EARLIER }
    expect(nearLimits(usage([window('five_hour', 90)]), 80, warned, NOW)).toHaveLength(1)
    expect(warned['a\nfive_hour']).toBe(LATER)
  })

  it('stays quiet after a restart within the same window', () => {
    const warned: WarnedWindows = { 'a\nfive_hour': LATER }
    expect(nearLimits(usage([window('five_hour', 90)]), 80, warned, NOW)).toHaveLength(0)
  })

  it('forgets windows the data no longer has once they would have reset, and leaves other accounts alone', () => {
    const warned: WarnedWindows = { 'a\nopus': EARLIER, 'a\nsonnet': LATER, 'a\nold': null, 'b\nfive_hour': EARLIER }
    nearLimits(usage([window('five_hour', 10)]), 80, warned, NOW)
    expect(warned).toEqual({ 'a\nsonnet': LATER, 'b\nfive_hour': EARLIER })
  })

  it('keeps a window without a reset time until its usage falls', () => {
    const warned: WarnedWindows = {}
    expect(nearLimits(usage([window('primary', 90, null)]), 80, warned, NOW)).toHaveLength(1)
    expect(warned).toEqual({ 'a\nprimary': null })
    expect(nearLimits(usage([window('primary', 92, null)]), 80, warned, NOW)).toHaveLength(0)
  })
})
