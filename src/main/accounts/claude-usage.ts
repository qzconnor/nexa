import { app, net } from 'electron'
import type { UsageWindow } from '@shared/types'
import { isPlainObject } from '@shared/utils'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA = 'oauth-2025-04-20'

export type ClaudeUsageResult =
  | { ok: true; windows: UsageWindow[]; limited: boolean }
  | { ok: false; message: string; retryAfterMs?: number }

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function time(value: unknown): number | undefined {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isNaN(ms) ? undefined : ms
}

const WINDOWS: [key: string, label: string, minutes: number, limitKind: string][] = [
  ['five_hour', '5 Stunden', 300, 'session'],
  ['seven_day', 'Woche', 10080, 'weekly_all'],
]

/**
 * The limits from Anthropic's usage API, as the title bar shows them: the 5-hour window and the
 * week of all models first, the weekly windows of single models after. Newer answers carry `limits`,
 * older ones only the top-level windows; both are read.
 */
export function parseClaudeUsage(raw: unknown): { windows: UsageWindow[]; limited: boolean } | null {
  if (!isPlainObject(raw)) return null
  const limits = Array.isArray(raw.limits) ? raw.limits.filter(isPlainObject) : []
  const windows: UsageWindow[] = []
  for (const [key, label, minutes, kind] of WINDOWS) {
    const legacy = isPlainObject(raw[key]) ? raw[key] : null
    const limit = limits.find((l) => l.kind === kind)
    const percent = num(legacy?.utilization) ?? num(limit?.percent)
    if (percent === null) continue
    windows.push({ key, label, usedPercent: percent, resetsAt: time(legacy?.resets_at) ?? time(limit?.resets_at), windowMinutes: minutes })
  }
  for (const limit of limits) {
    const kind = typeof limit.kind === 'string' ? limit.kind : null
    const percent = num(limit.percent)
    if (!kind || percent === null || kind === 'session' || kind === 'weekly_all') continue
    const scope = isPlainObject(limit.scope) && isPlainObject(limit.scope.model) ? limit.scope.model : null
    const model = typeof scope?.display_name === 'string' ? scope.display_name : null
    windows.push({
      key: model ? `${kind}:${model}` : kind,
      label: model ? `${model} · Woche` : kind.replace(/_/g, ' '),
      usedPercent: percent,
      resetsAt: time(limit.resets_at),
    })
  }
  if (!windows.length) return null
  return { windows, limited: windows.some((w) => w.usedPercent >= 100) }
}

/** Asks Anthropic for the limits of a browser login (setup tokens and API keys aren't allowed to). */
export async function fetchClaudeUsage(accessToken: string): Promise<ClaudeUsageResult> {
  try {
    const response = await net.fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': OAUTH_BETA,
        'Content-Type': 'application/json',
        'User-Agent': `nexa/${app.getVersion()}`,
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) {
      const parsed = parseClaudeUsage(await response.json())
      return parsed ? { ok: true, ...parsed } : { ok: false, message: 'Unerwartete Antwort der Usage-API.' }
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'))
      return { ok: false, message: 'Die Usage-API bremst gerade, neuer Versuch später.', retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : 15 * 60_000 }
    }
    if (response.status === 401 || response.status === 403) return { ok: false, message: 'Der Login wurde abgelehnt. Bitte neu anmelden.' }
    return { ok: false, message: `Die Usage-API antwortet mit ${response.status}.` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
