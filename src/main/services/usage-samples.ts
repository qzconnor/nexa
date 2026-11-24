import type { UsageWindow } from '@shared/types'
import { addSample, forecastWindow, windowStart, type UsageSample } from '@shared/usage-forecast'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'

const SAVE_DELAY_MS = 30_000

interface Saved {
  version: 1
  /** By `<account>\n<window key>`. */
  samples: Record<string, UsageSample[]>
}

/**
 * The readings of every account's limit windows, for the forecast of each (`usage-forecast.ts`).
 * Kept in `usage-samples.json`, so the pace is known again right after a restart.
 */
export class UsageSamples {
  private readonly samples = new Map<string, UsageSample[]>()
  private saveTimer: NodeJS.Timeout | null = null

  /** `file`: where they are kept (null: only for this run, in tests). */
  constructor(private readonly file: string | null) {
    if (!file) return
    const saved = readJsonGuardedSync<Saved>(file)
    for (const [key, list] of Object.entries(saved?.samples ?? {})) {
      if (Array.isArray(list)) this.samples.set(key, list.filter(isSample))
    }
  }

  /**
   * Notes the windows' values as read at `at` and gives them back with their forecast. Windows
   * without reset time or of unknown length get none.
   */
  record(accountId: string, at: number, windows: readonly UsageWindow[]): UsageWindow[] {
    const result = windows.map((window) => {
      const start = windowStart(window)
      if (start === null) return { ...window, forecast: null }
      const key = keyOf(accountId, window.key)
      const samples = addSample(this.samples.get(key) ?? [], [at, window.usedPercent], start)
      this.samples.set(key, samples)
      return { ...window, forecast: forecastWindow(window, samples) }
    })
    this.saveSoon()
    return result
  }

  /** A removed account's readings go with it. */
  forget(accountId: string): void {
    let gone = false
    for (const key of this.samples.keys()) {
      if (!key.startsWith(`${accountId}\n`)) continue
      this.samples.delete(key)
      gone = true
    }
    if (gone) this.saveSoon()
  }

  async flush(): Promise<void> {
    if (!this.saveTimer) return
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.save()
  }

  private saveSoon(): void {
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, SAVE_DELAY_MS)
  }

  private async save(): Promise<void> {
    if (!this.file) return
    const data: Saved = { version: 1, samples: Object.fromEntries(this.samples) }
    await writeJsonAtomic(this.file, data).catch((error) => console.warn('[usage] readings could not be saved', error))
  }
}

function keyOf(accountId: string, windowKey: string): string {
  return `${accountId}\n${windowKey}`
}

function isSample(value: unknown): value is UsageSample {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
}
