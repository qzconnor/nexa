import { statSync } from 'node:fs'
import { readJsonSync, writeJsonAtomic } from '../lib/json-file'

/**
 * What Nexa learned by starting a CLI (its version, Antigravity's models and commands), kept across
 * app starts for as long as the CLI's file stays the same (size and modification time). Starting a
 * CLI blocks the main process while Windows creates the process: for `agy.exe` (~245 MB) about 0.3 s
 * each time, so the start shouldn't pay it for answers that only change with an update.
 */
interface Entry {
  size: number
  mtimeMs: number
  value: unknown
}

let file: string | null = null
let saved: Record<string, Entry> = {}

/** Keeps the cache in this file (the app's data folder); without it nothing is kept. */
export function keepCliCacheIn(path: string): void {
  file = path
  saved = readJsonSync<Record<string, Entry>>(path) ?? {}
}

function stampOf(path: string): { size: number; mtimeMs: number } | null {
  try {
    const info = statSync(path)
    return info.isFile() ? { size: info.size, mtimeMs: info.mtimeMs } : null
  } catch {
    return null
  }
}

/** What was kept under `key` for the CLI file at `path`, while it is still the same file. */
export function cachedForFile<T>(key: string, path: string): T | undefined {
  if (!file) return undefined
  const entry = saved[`${key}|${path}`]
  if (!entry) return undefined
  const stamp = stampOf(path)
  return stamp && stamp.size === entry.size && stamp.mtimeMs === entry.mtimeMs ? (entry.value as T) : undefined
}

export function keepForFile(key: string, path: string, value: unknown): void {
  if (!file) return
  const stamp = stampOf(path)
  if (!stamp) return
  const id = `${key}|${path}`
  const before = saved[id]
  // Each run tells its models again: only what changed goes to disk.
  if (before && before.size === stamp.size && before.mtimeMs === stamp.mtimeMs && JSON.stringify(before.value) === JSON.stringify(value)) return
  saved[id] = { ...stamp, value }
  writing = writeJsonAtomic(file, saved).catch((error: unknown) => console.warn('[cli-cache] could not be saved', error))
}

/** The last write to the file, settled (failures are only logged). */
let writing: Promise<void> = Promise.resolve()

/** Forgets the cache, as if nothing were kept, once its writes are done (tests: before their folder goes). */
export async function resetCliCache(): Promise<void> {
  await writing
  file = null
  saved = {}
}
