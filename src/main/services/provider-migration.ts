import { PROVIDER_IDS, type ChatItem, type ProviderId } from '@shared/chat'
import type { AppSettings, SessionMeta } from '@shared/types'

/**
 * Data of a CLI Nexa no longer has: Gemini CLI, which Antigravity CLI replaced (Google ended Gemini
 * CLI for personal accounts). Nothing of it may break loading; what it leaves behind goes on with the
 * CLIs there are.
 */

const known = (id: unknown): id is ProviderId => PROVIDER_IDS.includes(id as ProviderId)

/** A record keyed by CLI without the keys of CLIs that are gone; the same object when nothing goes. */
function knownKeys<T>(record: Partial<Record<string, T>> | undefined): Partial<Record<ProviderId, T>> | undefined {
  if (!record || Object.keys(record).every(known)) return record
  return Object.fromEntries(Object.entries(record).filter(([id]) => known(id))) as Partial<Record<ProviderId, T>>
}

/**
 * A chat of a CLI that is gone goes on with `fallback` (the default CLI): its link to the old
 * conversation goes, so the next prompt hands the chat over as context (`<nexa-context>`).
 */
export function migrateSessionMeta(meta: SessionMeta, fallback: ProviderId): SessionMeta {
  const provider = known(meta.provider) ? meta.provider : fallback
  const cli = knownKeys(meta.cli ?? {}) ?? {}
  const earlierCli = meta.earlierCli?.map((links) => knownKeys(links) ?? {}).filter((links) => Object.keys(links).length)
  const accounts = knownKeys(meta.accounts)
  const cliArgs = knownKeys(meta.cliArgs)
  if (provider === meta.provider && cli === meta.cli && accounts === meta.accounts && cliArgs === meta.cliArgs && earlierCli?.length === meta.earlierCli?.length) return meta
  const next: SessionMeta = { ...meta, provider, cli }
  if (meta.earlierCli) next.earlierCli = earlierCli?.length ? earlierCli : undefined
  if (meta.accounts) next.accounts = accounts
  if (meta.cliArgs) next.cliArgs = cliArgs
  return next
}

/** An item of a CLI that is gone shows as its successor's: every view knows only the CLIs there are. */
export function migrateItem(item: ChatItem): ChatItem {
  const provider = (item as { provider?: unknown }).provider
  return provider === undefined || known(provider) ? item : ({ ...item, provider: 'antigravity' } as ChatItem)
}

/** Settings that name a CLI that is gone name the first one instead (its own settings fell away already). */
export function migrateSettings(settings: AppSettings): AppSettings {
  if (known(settings.defaults.provider)) return settings
  return { ...settings, defaults: { ...settings.defaults, provider: PROVIDER_IDS[0]! } }
}
