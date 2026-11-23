import type { ProviderUsage, UsageWindow } from '@shared/types'

/**
 * A window that was warned about only warns again once its usage fell this many points below the
 * threshold (its reset, a higher threshold), so values around the threshold don't warn twice.
 */
const REARM_MARGIN = 5

/** Windows that were warned about: `<account>\n<window>` → when that window resets (ms), if known. */
export type WarnedWindows = Record<string, number | null>

export interface NearLimit {
  window: UsageWindow
  /** Rounded as the window shows it, 0–100. */
  percent: number
}

/**
 * The limit windows of an account that reached `threshold` since they were last warned about,
 * highest first. `warned` is updated: they are added, and windows whose reset passed or whose
 * usage fell back below the threshold are removed, so their next window warns again.
 */
export function nearLimits(usage: Pick<ProviderUsage, 'accountId' | 'windows'>, threshold: number, warned: WarnedWindows, now: number): NearLimit[] {
  const prefix = `${usage.accountId}\n`
  const seen = new Set<string>()
  const reached: NearLimit[] = []
  for (const window of usage.windows) {
    const key = prefix + window.key
    seen.add(key)
    const percent = Math.max(0, Math.min(100, Math.round(window.usedPercent)))
    if (key in warned && (resetPassed(warned[key] ?? null, now) || percent < threshold - REARM_MARGIN)) delete warned[key]
    if (percent >= threshold && !(key in warned)) {
      warned[key] = window.resetsAt ?? null
      reached.push({ window, percent })
    }
  }
  // Windows the data no longer has (e.g. a model's limit) are forgotten once they would have reset.
  for (const key of Object.keys(warned)) {
    if (key.startsWith(prefix) && !seen.has(key) && (warned[key] === null || resetPassed(warned[key] ?? null, now))) delete warned[key]
  }
  return reached.sort((a, b) => b.percent - a.percent)
}

function resetPassed(resetsAt: number | null, now: number): boolean {
  return resetsAt !== null && Number.isFinite(resetsAt) && resetsAt <= now
}
