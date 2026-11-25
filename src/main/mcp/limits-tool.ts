import { availability, type BlockedAccount } from '@shared/account-choice'
import { planLabel, visibleAccounts, type Account } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type { ProviderUsage, UsageWindow } from '@shared/types'
import type { McpTool, McpToolResult } from './mcp-protocol'

/**
 * The tool `limits` (as in the Claude Manager): the plan limits of the account the calling chat runs
 * on and of the user's other accounts, as the title bar shows them. Read-only and only the user's own
 * numbers, so it comes with Nexa's MCP server whenever that is there, without a switch of its own.
 */

/** What the tool reads (Nexa's services, a fake in tests). */
export interface LimitsSource {
  /** The CLI and account a chat runs with now; null for one that is gone. */
  chat(id: string): { provider: ProviderId; accountId: string } | null
  /** All accounts, in the user's order. */
  accounts(): Account[]
  usage(): ProviderUsage[]
  /** The accounts Nexa leaves alone until their limit resets (AutoSwitch). */
  blocked(): BlockedAccount[]
  /** The CLIs switched on in the settings. */
  providers(): ProviderId[]
  /** `chat.autoSwitch`. */
  autoSwitch(): boolean
}

export const LIMITS_TOOL_DEF: McpTool = {
  name: 'limits',
  title: 'Limits',
  description:
    'The usage limits of the account this chat runs on (Claude Code or Codex): how much of each window (5 hours, week …) is used, when it resets and where it heads at the current pace. ' +
    "Also the limits of the user's other accounts in Nexa, and whether a chat at a limit goes on with another account by itself. Check it before long tasks.",
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true, title: 'Limits' },
}

export const LIMITS_INSTRUCTIONS =
  "limits tells how much of the usage limits of the account this chat runs on is used and when they reset, and the same for the user's other accounts; check it before long tasks."

export function isLimitsTool(name: string): boolean {
  return name === LIMITS_TOOL_DEF.name
}

export interface LimitsInput {
  /** The calling chat's CLI and account; null when the connection belongs to no chat. */
  chat: { provider: ProviderId; accountId: string } | null
  /** All accounts, in the user's order. */
  accounts: readonly Account[]
  usage: readonly ProviderUsage[]
  blocked: readonly BlockedAccount[]
  /** The CLIs switched on: the accounts of the others don't concern the user. */
  providers: readonly ProviderId[]
  autoSwitch: boolean
  now: number
  timeZone: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "in 1 h 40 min", "3 d 2 h ago". */
export function relative(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  if (minutes < 1) return 'now'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  const span = days > 0 ? `${days} d${hours ? ` ${hours} h` : ''}` : hours > 0 ? `${hours} h${mins ? ` ${mins} min` : ''}` : `${mins} min`
  return ms < 0 ? `${span} ago` : `in ${span}`
}

/** A time for the model: local date and time, with how far off it is when `now` is given. */
export function localTime(ms: number, now?: number): string {
  const date = new Date(ms)
  const text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return now === undefined ? text : `${text} (${relative(ms - now)})`
}

/** An English name for a limit window (the app's labels are German). */
export function windowName(window: Pick<UsageWindow, 'key' | 'label' | 'windowMinutes'>): string {
  // A window of a group of models (Antigravity: „Gemini · Woche“): its group after the window's name,
  // unless the key named it already (Claude: `weekly_scoped:Opus 4`, „Opus 4 · Woche“).
  const at = window.label.indexOf(' · ')
  if (at > 0) {
    const group = window.label.slice(0, at)
    const name = windowName({ ...window, label: window.label.slice(at + 3) })
    return name.includes(group) ? name : `${name}, ${group}`
  }
  const minutes = window.windowMinutes
  if (window.key === 'five_hour' || minutes === 300) return '5 hours'
  if (window.key === 'seven_day' || minutes === 10080) return 'week'
  // Claude's weekly windows of one model: `seven_day_opus`, or `<kind>:<model>` from the usage API.
  const model = /^seven_day_(\w+)$/.exec(window.key)?.[1] ?? window.key.split(':')[1]
  if (model) return `week, ${model.charAt(0).toUpperCase()}${model.slice(1)}`
  if (minutes && minutes >= 40000 && minutes <= 45000) return 'month'
  if (minutes && minutes % 1440 === 0) return `${minutes / 1440} days`
  if (minutes) return minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} min`
  return window.label
}

/** Where a window heads at the current pace, as the tail of its line; empty while that can't be told. */
function forecastText(window: UsageWindow, now: number): string {
  const forecast = window.forecast
  if (!forecast) return ''
  if (forecast.exhaustsAt !== null) {
    return forecast.exhaustsAt > now ? `; at the current pace (${forecast.ratePerHour} points/hour) it reaches 100 % ${localTime(forecast.exhaustsAt, now)}, before the reset` : ''
  }
  return `; at the current pace about ${Math.round(forecast.atReset)} % by the reset`
}

function windowLine(window: UsageWindow, now: number): string {
  const name = windowName(window)
  // A window whose reset passed is empty again, whatever the last reading said (as account-choice.ts counts it).
  if (window.resetsAt && window.resetsAt <= now) return `- ${name}: reset ${localTime(window.resetsAt, now)}; no reading since, so it starts empty`
  const reset = window.resetsAt ? `, resets ${localTime(window.resetsAt, now)}` : ''
  return `- ${name}: ${Math.round(window.usedPercent)} % used${reset}${forecastText(window, now)}`
}

/** `"Arbeit" (Claude Code, Max)`; without the CLI where the sentence names it already. */
function accountLabel(account: Account, usage: ProviderUsage | undefined, withCli = true): string {
  const plan = account.kind === 'apiKey' ? 'API key' : account.kind === 'token' ? 'token' : planLabel(usage?.plan ?? account.identity.subscriptionType)
  const parts = [withCli ? PROVIDERS[account.provider].name : null, plan].filter(Boolean)
  return parts.length ? `"${account.name}" (${parts.join(', ')})` : `"${account.name}"`
}

const signedOut = (account: Account) => account.kind !== 'system' && (account.authState === 'missing' || account.authState === 'dead')

/** When Nexa counts an account free again, as a sentence; null while nothing holds it back. */
function heldBack(account: Account, input: LimitsInput): string | null {
  const free = availability(account, { accounts: input.accounts, usage: input.usage, blocked: input.blocked, now: input.now })
  if (!free || free.at <= input.now) return null
  return `at its limit until ${free.estimated ? 'about ' : ''}${localTime(free.at, input.now)}`
}

/** The lines about the calling chat's own account. */
function ownLines(account: Account, usage: ProviderUsage | undefined, input: LimitsInput): string[] {
  const { now } = input
  if (account.kind === 'apiKey') return ['It is an API key: billed per token, without plan limits.']
  const lines: string[] = []
  if (!usage) {
    lines.push('Nexa has no numbers for it yet; they come with the next reading or answer.')
  } else {
    if (usage.windows.length) {
      lines.push(`Its limits, as of ${localTime(usage.updatedAt, now)}:`, ...usage.windows.map((w) => windowLine(w, now)))
    } else {
      lines.push('Nexa has no limit windows for it.')
    }
    if (usage.message) lines.push(`The last reading failed: ${usage.message}`)
    if (usage.limited) lines.push(`${PROVIDERS[account.provider].name} reported it at its limit.`)
  }
  const held = heldBack(account, input)
  if (held) lines.push(`Nexa counts it ${held}.`)
  return lines
}

/** One line per other account: its windows in short, or why it has none. */
function otherLine(account: Account, usage: ProviderUsage | undefined, input: LimitsInput): string {
  const label = accountLabel(account, usage)
  if (account.kind === 'apiKey') return `- ${label}: billed per token, no plan limits`
  if (signedOut(account)) return `- ${label}: signed out`
  const windows = (usage?.windows ?? []).map((w) =>
    w.resetsAt && w.resetsAt <= input.now ? `${windowName(w)} 0 % (reset since)` : `${windowName(w)} ${Math.round(w.usedPercent)} %`,
  )
  const held = heldBack(account, input)
  const parts = [windows.length ? windows.join(', ') : 'no numbers yet', held].filter(Boolean)
  return `- ${label}: ${parts.join('; ')}`
}

/** The text `limits` answers with. */
export function limitsReport(input: LimitsInput): string {
  const { chat, now } = input
  const usageOf = (id: string) => input.usage.find((u) => u.accountId === id)
  const lines: string[] = []
  const zone = `Times are local (${input.timeZone}); it is ${localTime(now)} now.`
  const own = chat ? input.accounts.find((a) => a.id === chat.accountId) : undefined
  if (chat && own) {
    lines.push(`This chat runs with ${PROVIDERS[chat.provider].name} on the account ${accountLabel(own, usageOf(own.id), false)}. ${zone}`)
    lines.push(...ownLines(own, usageOf(own.id), input))
  } else {
    lines.push(`${chat ? 'Nexa does not know the account this chat runs on.' : 'This connection belongs to no chat of Nexa.'} ${zone}`)
  }
  // The accounts the user sees and picks: a hidden standard account is out of the way everywhere.
  const others = input.providers.flatMap((provider) => visibleAccounts(input.accounts, provider)).filter((a) => a.id !== own?.id)
  if (others.length) lines.push('', own ? 'Other accounts:' : 'Accounts:', ...others.map((a) => otherLine(a, usageOf(a.id), input)))
  lines.push(
    '',
    input.autoSwitch
      ? 'Automatic account switch at a limit is on: a chat that hits a limit goes on with the next free account of its CLI, in the order of the list above (never with an API key).'
      : 'Automatic account switch at a limit is off: at a limit the chat stops until the user picks another account or the limit resets.',
  )
  return lines.join('\n')
}

export class LimitsTool {
  constructor(
    private readonly source: LimitsSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** `caller`: the calling chat; null for a connection that belongs to none. */
  call(caller: string | null, name: string): McpToolResult {
    if (!isLimitsTool(name)) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    const report = limitsReport({
      chat: caller ? this.source.chat(caller) : null,
      accounts: this.source.accounts(),
      usage: this.source.usage(),
      blocked: this.source.blocked(),
      providers: this.source.providers(),
      autoSwitch: this.source.autoSwitch(),
      now: this.now(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    return { content: [{ type: 'text', text: report }] }
  }
}
