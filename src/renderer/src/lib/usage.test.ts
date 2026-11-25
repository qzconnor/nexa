import { describe, expect, it } from 'vitest'
import type { UsageWindow } from '@shared/types'
import { chosenModel, shortWindowLabels, windowsOfModel } from './usage'

const gemini = ['Gemini 4 Hydrogen', 'Gemini 3.8 Flash']
const thirdParty = ['Claude Sonnet 4.6', 'Claude Opus 4.6', 'GPT-OSS 120B']
/** Antigravity's windows, as `usageOfQuota` makes them. */
const QUOTA: UsageWindow[] = [
  { key: 'gemini-weekly', label: 'Gemini · Woche', usedPercent: 13, windowMinutes: 10080, models: gemini },
  { key: '3p-5h', label: 'Claude/GPT · 5 Stunden', usedPercent: 0, windowMinutes: 300, models: thirdParty },
  { key: '3p-weekly', label: 'Claude/GPT · Woche', usedPercent: 0, windowMinutes: 10080, models: thirdParty },
]
const keys = (windows: UsageWindow[]) => windows.map((w) => w.key)

describe('windowsOfModel', () => {
  it('takes the windows of the model’s group, by its label or its id', () => {
    expect(keys(windowsOfModel(QUOTA, { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }))).toEqual(['gemini-weekly'])
    expect(keys(windowsOfModel(QUOTA, { label: 'Claude Opus 4.6 (Thinking)' }))).toEqual(['3p-5h', '3p-weekly'])
    expect(keys(windowsOfModel(QUOTA, { id: 'claude-sonnet-4-6' }))).toEqual(['3p-5h', '3p-weekly'])
    // An id with more after the group's name.
    expect(keys(windowsOfModel(QUOTA, { id: 'gpt-oss-120b-medium' }))).toEqual(['3p-5h', '3p-weekly'])
  })

  it('keeps all without a model, for a model no window names, and where no window names models', () => {
    expect(keys(windowsOfModel(QUOTA, null))).toEqual(keys(QUOTA))
    expect(keys(windowsOfModel(QUOTA, { id: 'gemini-9-ultra', label: 'Gemini 9 Ultra' }))).toEqual(keys(QUOTA))
    const claude: UsageWindow[] = [
      { key: 'five_hour', label: '5 Stunden', usedPercent: 36, windowMinutes: 300 },
      { key: 'seven_day', label: 'Woche', usedPercent: 30, windowMinutes: 10080 },
    ]
    expect(keys(windowsOfModel(claude, { id: 'claude-opus-5-5' }))).toEqual(['five_hour', 'seven_day'])
  })

  it('keeps a window for all models beside the group’s', () => {
    const mixed: UsageWindow[] = [{ key: 'all', label: 'Tag', usedPercent: 5, windowMinutes: 1440 }, ...QUOTA]
    expect(keys(windowsOfModel(mixed, { label: 'Gemini 4 Hydrogen' }))).toEqual(['all', 'gemini-weekly'])
  })
})

describe('chosenModel', () => {
  const models = [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', isDefault: true },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
  ]

  it('finds the chat’s model, the CLI’s default without one, and keeps an unknown id', () => {
    expect(chosenModel(models, 'claude-sonnet-4-6')).toMatchObject({ label: 'Claude Sonnet 4.6 (Thinking)' })
    expect(chosenModel(models, '')).toMatchObject({ id: 'gemini-3.8-flash' })
    expect(chosenModel(undefined, 'gpt-oss-120b-medium')).toEqual({ id: 'gpt-oss-120b-medium' })
    expect(chosenModel(undefined, '')).toBeNull()
  })
})

describe('shortWindowLabels', () => {
  it('names a group only before its first window', () => {
    expect(shortWindowLabels(QUOTA)).toEqual(['Gemini Woche', 'Claude/GPT 5 Std.', 'Woche'])
    expect(shortWindowLabels(QUOTA.slice(1))).toEqual(['Claude/GPT 5 Std.', 'Woche'])
  })

  it('leaves windows without a group as they are', () => {
    expect(shortWindowLabels([{ key: 'five_hour', label: '5 Stunden', usedPercent: 0, windowMinutes: 300 }, { key: 'seven_day', label: 'Woche', usedPercent: 0, windowMinutes: 10080 }])).toEqual(['5 Std.', 'Woche'])
  })
})
