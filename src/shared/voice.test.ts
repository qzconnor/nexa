import { describe, expect, it } from 'vitest'
import { parseVoiceMessage, voiceKeyterms, voiceLanguage } from './voice'

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
