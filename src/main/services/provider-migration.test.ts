import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { defaultSettings } from '@shared/defaults'
import type { AppSettings, SessionMeta } from '@shared/types'
import { mergeKnown } from '@shared/utils'
import { migrateItem, migrateSessionMeta, migrateSettings } from './provider-migration'

/** A chat of Nexa 0.x that ran Gemini CLI, after Claude Code before it. */
const GEMINI_CHAT = {
  id: 's1',
  title: 'Alt',
  projectId: 'p',
  provider: 'gemini',
  permissionMode: 'ask',
  createdAt: 1,
  updatedAt: 2,
  cli: { claude: { sessionId: 'c1', seen: 3 }, gemini: { sessionId: 'g1', seen: 9 } },
  earlierCli: [{ gemini: { sessionId: 'g0' } }],
  accounts: { claude: 'system', gemini: 'x-google' },
  cliArgs: { gemini: ['--sandbox'] },
} as unknown as SessionMeta

describe('migrateSessionMeta', () => {
  it('lets a Gemini chat go on with the default CLI, without its link, so the chat comes as context', () => {
    expect(migrateSessionMeta(GEMINI_CHAT, 'claude')).toEqual({
      ...GEMINI_CHAT,
      provider: 'claude',
      cli: { claude: { sessionId: 'c1', seen: 3 } },
      earlierCli: undefined,
      accounts: { claude: 'system' },
      cliArgs: {},
    })
  })

  it('leaves a chat of a CLI there is as it is', () => {
    const meta = { ...GEMINI_CHAT, provider: 'codex', cli: { codex: { sessionId: 'x' } }, earlierCli: undefined, accounts: undefined, cliArgs: undefined } as unknown as SessionMeta
    expect(migrateSessionMeta(meta, 'claude')).toBe(meta)
  })
})

describe('migrateItem', () => {
  it('shows an item of Gemini CLI as its successor’s', () => {
    const item = { kind: 'assistant', id: 'a', ts: 1, provider: 'gemini', parentId: null, text: 'Hi' } as unknown as ChatItem
    expect(migrateItem(item).provider).toBe('antigravity')
    const user = { kind: 'user', id: 'u', ts: 1, text: 'Hallo' } as unknown as ChatItem
    expect(migrateItem(user)).toBe(user)
  })
})

describe('migrateSettings', () => {
  it('drops the settings of Gemini CLI and a default naming it', () => {
    const saved = { defaults: { provider: 'gemini', accounts: { claude: 'system', gemini: 'system-gemini' } }, gemini: { enabled: true, path: 'C:\\gemini.cmd' } }
    const settings = migrateSettings(mergeKnown(defaultSettings(), saved)) as AppSettings & { gemini?: unknown }
    expect(settings.gemini).toBeUndefined()
    expect(settings.defaults.provider).toBe('claude')
    expect(settings.defaults.accounts).toEqual({ claude: 'system', codex: 'system-codex', antigravity: 'system-antigravity' })
  })
})
