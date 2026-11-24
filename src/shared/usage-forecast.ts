import type { UsageForecast, UsageWindow } from './types'

/**
 * Where a usage window heads at the current pace: when it reaches 100 % and how full it is at the
 * reset. The pace comes from the readings of the last while (an hour for the five-hour window, a day
 * for the weekly ones); without enough of them, from the average since the window began.
 * Taken over from the Claude Manager (`src/shared/usage-forecast.ts`).
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

/** A reading of a window: [time in ms, percent]. */
export type UsageSample = [number, number]

/** Readings closer together than this replace the newest one: a busy chat reports after every request. */
const SAMPLE_GAP_MS = 5 * MINUTE_MS
/** Readings kept per window; with the gap above, two days and more. */
const MAX_SAMPLES = 600

/** How long a window lasts: from its minutes (Codex, Anthropic's usage API), else from its key; null when unknown. */
export function windowLengthMs(window: Pick<UsageWindow, 'key' | 'windowMinutes'>): number | null {
  if (window.windowMinutes && window.windowMinutes > 0) return window.windowMinutes * MINUTE_MS
  const key = window.key
  if (key === 'five_hour') return 5 * HOUR_MS
  if (key === 'seven_day' || key.startsWith('seven_day_') || key.startsWith('weekly')) return 7 * 24 * HOUR_MS
  return null
}

/** The start of a window that resets at `resetsAt`; null for windows of unknown length or without reset. */
export function windowStart(window: Pick<UsageWindow, 'key' | 'windowMinutes' | 'resetsAt'>): number | null {
  const length = windowLengthMs(window)
  return length === null || !window.resetsAt ? null : window.resetsAt - length
}

/** The stretch of readings the current pace is taken from. */
function lookbackMs(length: number): number {
  return Math.min(length / 5, 24 * HOUR_MS)
}

/**
 * Adds a reading and keeps those of the current window, oldest first. A reading that isn't newer
 * than the last one is left out; one within a few minutes of the one before the last replaces the
 * last. One clearly below the one before it means the window started over: the older ones go then.
 */
export function addSample(samples: readonly UsageSample[], sample: UsageSample, windowStart: number): UsageSample[] {
  const [time, percent] = sample
  const current = samples.filter(([t]) => t >= windowStart)
  const last = current.at(-1)
  if (time < windowStart || (last && time <= last[0])) return current
  if (last && percent < last[1] - 1) return [sample]
  const beforeLast = current.at(-2)
  const kept = beforeLast && time - beforeLast[0] < SAMPLE_GAP_MS ? current.slice(0, -1) : current
  return [...kept, sample].slice(-MAX_SAMPLES)
}

/**
 * The forecast for a window from its readings (oldest first, the latest being the window's current
 * value). Null without a reset time, at 100 % already, or while there is too little to go by.
 */
export function forecastWindow(window: Pick<UsageWindow, 'key' | 'windowMinutes' | 'resetsAt'>, samples: readonly UsageSample[]): UsageForecast | null {
  const length = windowLengthMs(window)
  const reset = window.resetsAt
  if (length === null || !reset) return null
  const start = reset - length
  const readings = samples.filter(([t]) => t >= start && t < reset)
  const last = readings.at(-1)
  if (!last) return null
  const [now, percent] = last
  if (percent >= 100) return null

  const lookback = lookbackMs(length)
  const minSpan = lookback / 3
  // The reading a lookback ago, or the oldest one when they don't reach back that far.
  const from = readings.filter(([t]) => t <= now - lookback).at(-1) ?? readings[0]!
  let rate: number
  let basis: UsageForecast['basis']
  if (now - from[0] >= minSpan) {
    rate = Math.max(0, (percent - from[1]) / (now - from[0]))
    basis = 'recent'
  } else if (now - start >= minSpan) {
    // The window begins with the first message: before that, nothing was used.
    rate = percent / (now - start)
    basis = 'window'
  } else {
    return null
  }

  const exhaustsAt = rate > 0 ? now + (100 - percent) / rate : Infinity
  return {
    exhaustsAt: exhaustsAt < reset ? Math.round(exhaustsAt) : null,
    atReset: Math.round((percent + rate * (reset - now)) * 10) / 10,
    ratePerHour: Math.round(rate * HOUR_MS * 100) / 100,
    basis,
  }
}
