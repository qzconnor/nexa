import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { enabledProviders, offeredProviders, providerTogglePatch } from './providers'

describe('enabledProviders', () => {
  it('lists the CLIs that are on, in their order', () => {
    const settings = defaultSettings()
    expect(enabledProviders(settings)).toEqual(['claude', 'codex', 'gemini'])
    settings.claude.enabled = false
    expect(enabledProviders(settings)).toEqual(['codex', 'gemini'])
  })
})

describe('offeredProviders', () => {
  it('offers Gemini CLI only once it is installed, Claude Code and Codex always', () => {
    const settings = defaultSettings()
    expect(offeredProviders(settings, [])).toEqual(['claude', 'codex'])
    expect(offeredProviders(settings, ['claude'])).toEqual(['claude', 'codex'])
    expect(offeredProviders(settings, ['claude', 'gemini'])).toEqual(['claude', 'codex', 'gemini'])
  })

  it('leaves out a CLI that is off, installed or not', () => {
    const settings = defaultSettings()
    settings.gemini.enabled = false
    expect(offeredProviders(settings, ['gemini'])).toEqual(['claude', 'codex'])
  })
})

describe('providerTogglePatch', () => {
  it('switches a CLI off and moves the default for new chats away from it', () => {
    const settings = defaultSettings()
    expect(providerTogglePatch(settings, 'codex', false)).toEqual({ codex: { enabled: false } })
    expect(providerTogglePatch(settings, 'claude', false)).toEqual({ claude: { enabled: false }, defaults: { provider: 'codex' } })
  })

  it('keeps the last CLI on and changes nothing that is so already', () => {
    const settings = defaultSettings()
    settings.codex.enabled = false
    settings.gemini.enabled = false
    expect(providerTogglePatch(settings, 'claude', false)).toBeNull()
    expect(providerTogglePatch(settings, 'claude', true)).toBeNull()
    expect(providerTogglePatch(settings, 'codex', true)).toEqual({ codex: { enabled: true } })
  })
})
