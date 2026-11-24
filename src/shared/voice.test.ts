import { describe, expect, it } from 'vitest'
import type { Account } from './accounts'
import { parseVoiceMessage, voiceAvailable, voiceCandidates, voiceKeyterms, voiceLanguage } from './voice'

type Row = Pick<Account, 'id' | 'provider' | 'kind' | 'authState'>
const row = (id: string, patch: Partial<Row> = {}): Row => ({ id, provider: 'claude', kind: 'oauth', authState: 'ok', ...patch })

describe('voiceCandidates', () => {
  const list = [row('system', { kind: 'system' }), row('b'), row('key', { kind: 'apiKey' }), row('c'), row('x', { provider: 'codex' })]

  it('tries the chat’s account first, then the others; never API keys or other CLIs', () => {
    expect(voiceCandidates(list, '', 'c').map((a) => a.id)).toEqual(['c', 'b', 'system'])
    // A Codex chat's account isn't one: the Claude accounts in their order.
    expect(voiceCandidates(list, '', 'x').map((a) => a.id)).toEqual(['b', 'c', 'system'])
  })

  it('tries only the account set, unless it was removed', () => {
    expect(voiceCandidates(list, 'b', 'c').map((a) => a.id)).toEqual(['b'])
    expect(voiceCandidates(list, 'gone', 'c').map((a) => a.id)).toEqual(['c', 'b', 'system'])
  })
})

describe('voiceAvailable', () => {
  it('needs Claude switched on and a Claude account signed in', () => {
    expect(voiceAvailable([row('a')], '', true)).toBe(true)
    expect(voiceAvailable([row('a')], '', false)).toBe(false)
    expect(voiceAvailable([row('a', { authState: 'missing' }), row('k', { kind: 'apiKey' })], '', true)).toBe(false)
  })

  it('is not there with Codex alone', () => {
    expect(voiceAvailable([row('x', { provider: 'codex' })], '', true)).toBe(false)
  })

  it('counts an expired login, which Claude Code renews', () => {
    expect(voiceAvailable([row('a', { authState: 'expired' })], '', true)).toBe(true)
    expect(voiceAvailable([row('a', { authState: 'dead' })], '', true)).toBe(false)
  })

  it('asks only the account set', () => {
    expect(voiceAvailable([row('a', { authState: 'missing' }), row('b')], 'a', true)).toBe(false)
  })
})

describe('voiceLanguage', () => {
  it('takes the language set', () => {
    expect(voiceLanguage('fr', 'de-DE')).toBe('fr')
  })

  it('takes the system language without a setting, by its first part', () => {
    expect(voiceLanguage('', 'de-DE')).toBe('de')
    expect(voiceLanguage('', 'pt_BR')).toBe('pt')
  })

  it('falls back to the system language and then to English, as Claude Code does', () => {
    expect(voiceLanguage('xx', 'nl')).toBe('nl')
    expect(voiceLanguage('', 'zh-CN')).toBe('en')
    expect(voiceLanguage('', '')).toBe('en')
  })
})

describe('parseVoiceMessage', () => {
  it('reads the words so far', () => {
    expect(parseVoiceMessage('{"type": "TranscriptText", "data": "Bitte erstelle"}')).toEqual({ kind: 'text', text: 'Bitte erstelle' })
    expect(parseVoiceMessage('{"type": "TranscriptInterim", "data": "Hallo"}')).toEqual({ kind: 'text', text: 'Hallo' })
  })

  it('ignores empty words and messages it does not know', () => {
    expect(parseVoiceMessage('{"type": "TranscriptText", "data": ""}')).toBeNull()
    expect(parseVoiceMessage('{"type": "Metadata"}')).toBeNull()
    expect(parseVoiceMessage('not json')).toBeNull()
    expect(parseVoiceMessage('null')).toBeNull()
  })

  it('reads the end of an utterance', () => {
    expect(parseVoiceMessage('{"type": "TranscriptEndpoint"}')).toEqual({ kind: 'endpoint' })
  })

  it('reads errors of both kinds', () => {
    expect(parseVoiceMessage('{"type": "TranscriptError", "description": "audio too long"}')).toEqual({ kind: 'error', message: 'audio too long' })
    expect(parseVoiceMessage('{"type": "TranscriptError", "error_code": "rate_limited"}')).toEqual({ kind: 'error', message: 'rate_limited' })
    expect(parseVoiceMessage('{"type": "error", "message": "unauthorized"}')).toEqual({ kind: 'error', message: 'unauthorized' })
    expect(parseVoiceMessage('{"type": "error"}')).toEqual({ kind: 'error', message: 'unbekannter Fehler' })
  })
})

describe('voiceKeyterms', () => {
  it('joins printable terms once each, without their commas', () => {
    expect(voiceKeyterms(['Nexa', ' nexa ', 'Nexa', 'a,b', 'Größe', ''])).toBe('Nexa,nexa,a b,Gre')
  })

  it('stops before 1024 characters', () => {
    const terms = Array.from({ length: 300 }, (_, i) => `term${i}`)
    const joined = voiceKeyterms(terms)
    expect(joined.length).toBeLessThanOrEqual(1024)
    expect(joined.startsWith('term0,term1,')).toBe(true)
  })
})
