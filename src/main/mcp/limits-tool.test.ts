import { describe, expect, it } from 'vitest'
import type { Account } from '@shared/accounts'
import type { ProviderUsage } from '@shared/types'
import { LimitsTool, limitsReport, relative, windowName, type LimitsInput, type LimitsSource } from './limits-tool'

/** 15:00 in Berlin, where the tests run (vitest.config.ts). */
const NOW = Date.parse('2026-11-24T14:00:00Z')
const HOUR = 3_600_000

function account(id: string, patch: Partial<Account> = {}): Account {
  return {
    id,
    name: id,
    provider: 'claude',
    kind: 'oauth',
    color: '#d97757',
    configDir: `C:\\profiles\\${id}`,
    customConfigDir: false,
    createdAt: 1,
    secretHint: null,
    authState: 'ok',
    identity: { email: null, displayName: null, organizationName: null, organizationType: null, subscriptionType: 'max' },
    tokenExpiresAt: null,
    loginEndsAt: null,
    tokenSavedAt: null,
    renewable: false,
    extraArgs: [],
    ...patch,
  }
}

function usage(accountId: string, patch: Partial<ProviderUsage> = {}): ProviderUsage {
  return { provider: 'claude', accountId, windows: [], updatedAt: NOW - 4 * 60_000, source: 'api', ...patch }
}

const ACCOUNTS = [
  account('system', { kind: 'system', name: 'Standard' }),
  account('work', { name: 'Arbeit' }),
  account('home', { name: 'Privat', identity: { ...account('x').identity, subscriptionType: 'pro' } }),
  account('key', { name: 'API', kind: 'apiKey' }),
  account('gone', { name: 'Alt', authState: 'missing' }),
  account('gpt', { name: 'ChatGPT', provider: 'codex', identity: { ...account('x').identity, subscriptionType: 'plus' } }),
]

function input(patch: Partial<LimitsInput> = {}): LimitsInput {
  return {
    chat: { provider: 'claude', accountId: 'work' },
    accounts: ACCOUNTS,
    usage: [
      usage('work', {
        windows: [
          { key: 'five_hour', label: '5 Stunden', usedPercent: 42.4, resetsAt: NOW + 4 * HOUR, forecast: { exhaustsAt: null, atReset: 67.6, ratePerHour: 6.3, basis: 'recent' } },
          { key: 'seven_day', label: 'Woche', usedPercent: 12, resetsAt: NOW + 3 * 24 * HOUR },
          { key: 'seven_day_opus', label: 'Woche Opus', usedPercent: 3 },
        ],
      }),
      usage('home', { windows: [{ key: 'five_hour', label: '5 Stunden', usedPercent: 100, resetsAt: NOW + 2 * HOUR }], limited: true }),
      usage('gpt', { provider: 'codex', windows: [{ key: 'primary', label: '5 Stunden', usedPercent: 3, windowMinutes: 300 }, { key: 'secondary', label: 'Woche', usedPercent: 10, windowMinutes: 10080 }] }),
    ],
    blocked: [],
    providers: ['claude', 'codex'],
    autoSwitch: true,
    now: NOW,
    timeZone: 'Europe/Berlin',
    ...patch,
  }
}

describe('limitsReport', () => {
  it('gives the chat’s own windows with reset and forecast, and the other accounts in short', () => {
    expect(limitsReport(input()).split('\n')).toEqual([
      'This chat runs with Claude Code on the account "Arbeit" (Max). Times are local (Europe/Berlin); it is 2026-11-24 15:00 now.',
      'Its limits, as of 2026-11-24 14:56 (4 min ago):',
      '- 5 hours: 42 % used, resets 2026-11-24 19:00 (in 4 h); at the current pace about 68 % by the reset',
      '- week: 12 % used, resets 2026-11-27 15:00 (in 3 d)',
      '- week, Opus: 3 % used',
      '',
      'Other accounts:',
      '- "Privat" (Claude Code, Pro): 5 hours 100 %; at its limit until 2026-11-24 17:00 (in 2 h)',
      '- "API" (Claude Code, API key): billed per token, no plan limits',
      '- "Alt" (Claude Code, Max): signed out',
      '- "ChatGPT" (Codex, Plus): 5 hours 3 %, week 10 %',
      '',
      'Automatic account switch at a limit is on: a chat that hits a limit goes on with the next free account of its CLI, in the order of the list above (never with an API key).',
    ])
  })

  it('says when the pace runs out before the reset, and when a reset passed since the reading', () => {
    const windows = [
      { key: 'five_hour', label: '5 Stunden', usedPercent: 80, resetsAt: NOW + 4 * HOUR, forecast: { exhaustsAt: NOW + HOUR, atReset: 140, ratePerHour: 20, basis: 'recent' as const } },
      { key: 'seven_day', label: 'Woche', usedPercent: 50, resetsAt: NOW - HOUR },
    ]
    const text = limitsReport(input({ usage: [usage('work', { windows, message: 'Die Usage-API bremst gerade.' })] }))
    expect(text).toContain('- 5 hours: 80 % used, resets 2026-11-24 19:00 (in 4 h); at the current pace (20 points/hour) it reaches 100 % 2026-11-24 16:00 (in 1 h), before the reset')
    expect(text).toContain('- week: reset 2026-11-24 14:00 (1 h ago); no reading since, so it starts empty')
    expect(text).toContain('The last reading failed: Die Usage-API bremst gerade.')
  })

  it('names an account Nexa leaves alone after a limit, and a guessed reset', () => {
    const text = limitsReport(input({ blocked: [{ accountId: 'work', until: NOW + 5 * HOUR, estimated: true }] }))
    expect(text).toContain('Nexa counts it at its limit until about 2026-11-24 20:00 (in 5 h).')
  })

  it('leaves out the hidden standard account and the accounts of a CLI that is off', () => {
    const text = limitsReport(input({ providers: ['claude'], autoSwitch: false }))
    expect(text).not.toContain('Standard')
    expect(text).not.toContain('ChatGPT')
    expect(text).toContain('Automatic account switch at a limit is off')
  })

  it('lists every account for a connection without a chat, and says what it lacks for an API key', () => {
    expect(limitsReport(input({ chat: null }))).toMatch(/^This connection belongs to no chat of Nexa\. .*\n\nAccounts:\n- "Arbeit" \(Claude Code, Max\): 5 hours 42 %, week 12 %, week, Opus 3 %\n/)
    expect(limitsReport(input({ chat: { provider: 'claude', accountId: 'key' } }))).toContain('It is an API key: billed per token, without plan limits.')
    expect(limitsReport(input({ chat: { provider: 'claude', accountId: 'home' }, usage: [] }))).toContain('Nexa has no numbers for it yet')
  })
})

describe('windowName', () => {
  it('names the windows of Claude and Codex in English', () => {
    expect(windowName({ key: 'primary', label: '5 Stunden', windowMinutes: 300 })).toBe('5 hours')
    expect(windowName({ key: 'secondary', label: 'Monat', windowMinutes: 43200 })).toBe('month')
    expect(windowName({ key: 'weekly_scoped:Opus 4', label: 'Opus 4 · Woche' })).toBe('week, Opus 4')
    expect(windowName({ key: 'seven_day_sonnet', label: 'Woche Sonnet' })).toBe('week, Sonnet')
    expect(windowName({ key: 'odd', label: 'Sonderlimit' })).toBe('Sonderlimit')
    // Antigravity's windows per group of models.
    expect(windowName({ key: 'gemini-weekly', label: 'Gemini · Woche', windowMinutes: 10080 })).toBe('week, Gemini')
    expect(windowName({ key: '3p-5h', label: 'Claude/GPT · 5 Stunden', windowMinutes: 300 })).toBe('5 hours, Claude/GPT')
  })
})

describe('relative', () => {
  it('says how far off a time is', () => {
    expect(relative(90 * 60_000)).toBe('in 1 h 30 min')
    expect(relative(-(26 * HOUR))).toBe('1 d 2 h ago')
    expect(relative(20_000)).toBe('now')
  })
})

describe('LimitsTool', () => {
  it('reads the chat’s account and the rest from the app when called', () => {
    const asked: string[] = []
    const source: LimitsSource = {
      chat: (id) => {
        asked.push(id)
        return { provider: 'claude', accountId: 'work' }
      },
      accounts: () => ACCOUNTS,
      usage: () => [],
      blocked: () => [],
      providers: () => ['claude'],
      autoSwitch: () => false,
    }
    const tool = new LimitsTool(source, () => NOW)
    const result = tool.call('chat-1', 'limits')
    expect(asked).toEqual(['chat-1'])
    expect(result.isError).toBeUndefined()
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('on the account "Arbeit"') })
    expect(tool.call('chat-1', 'other').isError).toBe(true)
  })
})
