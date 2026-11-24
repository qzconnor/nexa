import { describe, expect, it } from 'vitest'
import { addSample, forecastWindow, windowLengthMs, windowStart, type UsageSample } from './usage-forecast'

const MIN = 60_000
const HOUR = 60 * MIN

describe('windowLengthMs', () => {
  it('takes the minutes a window names, else knows Claude’s keys', () => {
    expect(windowLengthMs({ key: 'primary', windowMinutes: 300 })).toBe(5 * HOUR)
    expect(windowLengthMs({ key: 'five_hour' })).toBe(5 * HOUR)
    expect(windowLengthMs({ key: 'seven_day_opus' })).toBe(7 * 24 * HOUR)
    expect(windowLengthMs({ key: 'weekly_model:Opus' })).toBe(7 * 24 * HOUR)
    expect(windowLengthMs({ key: 'irgendwas' })).toBeNull()
  })

  it('starts a window its length before its reset', () => {
    expect(windowStart({ key: 'five_hour', resetsAt: 10 * HOUR })).toBe(5 * HOUR)
    expect(windowStart({ key: 'five_hour' })).toBeNull()
  })
})

describe('addSample', () => {
  it('keeps the readings of the current window, oldest first', () => {
    const samples = addSample([[1 * HOUR, 5], [2 * HOUR, 10]], [3 * HOUR, 20], 1.5 * HOUR)
    expect(samples).toEqual([[2 * HOUR, 10], [3 * HOUR, 20]])
  })

  it('leaves out readings that aren’t newer', () => {
    expect(addSample([[2 * HOUR, 10]], [2 * HOUR, 12], 0)).toEqual([[2 * HOUR, 10]])
  })

  it('starts over when the value drops: the window began anew', () => {
    expect(addSample([[1 * HOUR, 40], [2 * HOUR, 60]], [3 * HOUR, 3], 0)).toEqual([[3 * HOUR, 3]])
  })

  it('replaces the newest reading while they come within minutes of each other', () => {
    let samples: UsageSample[] = []
    for (let t = 0; t <= 4 * MIN; t += 30_000) samples = addSample(samples, [t, t / MIN], 0)
    expect(samples).toEqual([[0, 0], [4 * MIN, 4]])
    samples = addSample(samples, [6 * MIN, 6], 0)
    expect(samples).toEqual([[0, 0], [4 * MIN, 4], [6 * MIN, 6]])
  })
})

describe('forecastWindow', () => {
  const window = { key: 'five_hour', resetsAt: 5 * HOUR }

  it('says when the limit comes at the pace of the last hour', () => {
    const samples: UsageSample[] = [[1 * HOUR, 30], [2 * HOUR, 40], [3 * HOUR, 70]]
    const forecast = forecastWindow(window, samples)!
    expect(forecast.basis).toBe('recent')
    expect(forecast.ratePerHour).toBe(30)
    // 30 left at 30 per hour: one hour after the last reading, before the reset.
    expect(forecast.exhaustsAt).toBe(4 * HOUR)
    expect(forecast.atReset).toBe(130)
  })

  it('tells how full it is at the reset when the limit doesn’t come before', () => {
    const forecast = forecastWindow(window, [[2 * HOUR, 20], [3 * HOUR, 25]])!
    expect(forecast.exhaustsAt).toBeNull()
    expect(forecast.atReset).toBe(35)
  })

  it('takes the average since the window began while the readings are too few', () => {
    const forecast = forecastWindow(window, [[2 * HOUR, 40]])!
    expect(forecast.basis).toBe('window')
    expect(forecast.ratePerHour).toBe(20)
    expect(forecast.atReset).toBe(100)
  })

  it('says nothing too early, at 100 %, or without a reset', () => {
    expect(forecastWindow(window, [[5 * MIN, 1]])).toBeNull()
    expect(forecastWindow(window, [[2 * HOUR, 100]])).toBeNull()
    expect(forecastWindow({ key: 'five_hour' }, [[2 * HOUR, 40]])).toBeNull()
  })
})
