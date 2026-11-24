import { describe, expect, it } from 'vitest'
import { pauseOver, spokenText, voiceAnchor, voiceLevel, withSpoken, VOICE_FIRST_WORDS_MS, VOICE_PAUSE_MS } from './voice-text'

describe('withSpoken', () => {
  it('fills an empty field', () => {
    expect(withSpoken(voiceAnchor('', 0, 0), 'Hallo Welt')).toEqual({ text: 'Hallo Welt', cursor: 10 })
  })

  it('puts a space between typed and spoken words', () => {
    const at = voiceAnchor('Bitte', 5, 5)
    expect(withSpoken(at, 'prüfe das')).toEqual({ text: 'Bitte prüfe das', cursor: 15 })
    expect(withSpoken(voiceAnchor('Bitte ', 6, 6), 'prüfe')).toEqual({ text: 'Bitte prüfe', cursor: 11 })
  })

  it('writes at the cursor, with a space before the rest but not before punctuation', () => {
    expect(withSpoken(voiceAnchor('Erst dann', 4, 4), 'das und')).toEqual({ text: 'Erst das und dann', cursor: 12 })
    expect(withSpoken(voiceAnchor('Fertig.', 6, 6), 'und gut')).toEqual({ text: 'Fertig und gut.', cursor: 14 })
  })

  it('replaces the selection', () => {
    expect(withSpoken(voiceAnchor('ein altes Wort', 4, 9), 'neues')).toEqual({ text: 'ein neues Wort', cursor: 9 })
  })

  it('leaves the text as it was while nothing is heard', () => {
    expect(withSpoken(voiceAnchor('Text', 4, 4), '  ')).toEqual({ text: 'Text', cursor: 4 })
  })
})

describe('spokenText', () => {
  it('joins the closed utterances and the one being heard', () => {
    expect(spokenText(['Erster Satz.', ' Zweiter Satz. '], 'Und noch')).toBe('Erster Satz. Zweiter Satz. Und noch')
    expect(spokenText(['Nur einer.'], '')).toBe('Nur einer.')
    expect(spokenText([], '')).toBe('')
  })
})

describe('voiceLevel', () => {
  it('maps loudness to 0–1 on a decibel scale', () => {
    expect(voiceLevel(0)).toBe(0)
    expect(voiceLevel(Number.NaN)).toBe(0)
    expect(voiceLevel(0.001)).toBe(0)
    expect(voiceLevel(1)).toBe(1)
    const middle = voiceLevel(10 ** (-37.5 / 20))
    expect(middle).toBeCloseTo(0.5, 5)
  })
})

describe('pauseOver', () => {
  const quiet = Array.from({ length: 32 }, () => 0.1)

  it('ends after a pause from the last new words', () => {
    const at = { since: 0, words: 5_000 }
    expect(pauseOver(at, 5_000 + VOICE_PAUSE_MS - 1, quiet)).toBe(false)
    expect(pauseOver(at, 5_000 + VOICE_PAUSE_MS, quiet)).toBe(true)
  })

  it('waits longer for the first words', () => {
    const at = { since: 1_000, words: null }
    expect(pauseOver(at, 1_000 + VOICE_PAUSE_MS, quiet)).toBe(false)
    expect(pauseOver(at, 1_000 + VOICE_FIRST_WORDS_MS, quiet)).toBe(true)
  })

  it('goes on while the microphone hears speech in the last half second', () => {
    const at = { since: 0, words: 0 }
    expect(pauseOver(at, 10_000, [...quiet.slice(1), 0.7])).toBe(false)
    expect(pauseOver(at, 10_000, [...quiet.slice(0, 20), 0.9, ...quiet.slice(21)])).toBe(true)
  })
})
