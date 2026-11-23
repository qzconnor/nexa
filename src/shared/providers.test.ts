import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { enabledProviders, providerTogglePatch } from './providers'

describe('enabledProviders', () => {
  it('lists the CLIs that are on, in their order', () => {
    const settings = defaultSettings()
    expect(enabledProviders(settings)).toEqual(['claude', 'codex'])
    settings.claude.enabled = false
    expect(enabledProviders(settings)).toEqual(['codex'])
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
    expect(providerTogglePatch(settings, 'claude', false)).toBeNull()
    expect(providerTogglePatch(settings, 'claude', true)).toBeNull()
    expect(providerTogglePatch(settings, 'codex', true)).toEqual({ codex: { enabled: true } })
  })
})
