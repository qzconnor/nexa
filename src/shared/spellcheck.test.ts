import { describe, expect, it } from 'vitest'
import { isLanguageCode, languageName, MAX_SPELLCHECK_LANGUAGES, shortLanguageNames, spellcheckLanguages } from './spellcheck'

/** Part of what Chromium's spellchecker offers on Windows and Linux. */
const AVAILABLE = ['de', 'de-DE', 'en-AU', 'en-GB', 'en-US', 'es', 'es-ES', 'fr', 'fr-FR', 'it', 'it-IT', 'nl', 'pl', 'pt-BR', 'pt-PT', 'sv']

describe('spellcheckLanguages', () => {
  it('takes the system’s language and English when none is chosen', () => {
    expect(spellcheckLanguages([], ['de-DE', 'en-US'], AVAILABLE)).toEqual(['de-DE', 'en-US'])
    expect(spellcheckLanguages([], ['en-GB'], AVAILABLE)).toEqual(['en-GB', 'en-US'])
    expect(spellcheckLanguages([], ['en-US'], AVAILABLE)).toEqual(['en-US'])
    expect(spellcheckLanguages([], [], AVAILABLE)).toEqual(['en-US'])
  })

  it('takes the chosen ones as the spellchecker has them, the same language of another region where it lacks one', () => {
    expect(spellcheckLanguages(['fr-FR', 'de-AT'], ['de-DE'], AVAILABLE)).toEqual(['fr-FR', 'de'])
    expect(spellcheckLanguages(['en'], [], AVAILABLE)).toEqual(['en-US'])
    expect(spellcheckLanguages(['pt'], [], AVAILABLE)).toEqual(['pt-PT'])
    expect(spellcheckLanguages(['pt'], [], ['en-US', 'pt-BR'])).toEqual(['pt-BR'])
    expect(spellcheckLanguages(['it'], [], AVAILABLE)).toEqual(['it'])
    expect(spellcheckLanguages(['de-de'], [], AVAILABLE)).toEqual(['de-DE'])
  })

  it('leaves out what it doesn’t have, and each language once', () => {
    expect(spellcheckLanguages(['tlh', 'de-DE', 'de-DE'], [], AVAILABLE)).toEqual(['de-DE'])
    expect(spellcheckLanguages(['tlh'], [], AVAILABLE)).toEqual([])
    expect(spellcheckLanguages([], ['de-DE'], [])).toEqual([])
  })

  it('takes a few languages at most', () => {
    expect(spellcheckLanguages(AVAILABLE, [], AVAILABLE)).toHaveLength(MAX_SPELLCHECK_LANGUAGES)
  })
})

describe('isLanguageCode', () => {
  it('takes the codes of the spellchecker and nothing else', () => {
    for (const code of ['de', 'de-DE', 'en-GB-oxendict', 'es-419', 'fil']) expect(isLanguageCode(code), code).toBe(true)
    for (const code of ['', 'DE', 'de_DE', 'de-', '../de', 'de-DE-x-y-z', 42]) expect(isLanguageCode(code), String(code)).toBe(false)
  })
})

describe('languageName', () => {
  it('names a language in German, and keeps a code without a name', () => {
    expect(languageName('de-DE')).toBe('Deutsch (Deutschland)')
    expect(languageName('en-US')).toBe('Englisch (Vereinigte Staaten)')
    expect(languageName('fr')).toBe('Französisch')
    expect(languageName('not a code')).toBe('not a code')
  })

  it('names short what is set, with the region only where it tells two apart', () => {
    expect(shortLanguageNames(['de-DE', 'en-US'])).toEqual(['Deutsch', 'Englisch'])
    expect(shortLanguageNames(['de-DE', 'en-GB', 'en-US'])).toEqual(['Deutsch', 'Englisch (Vereinigtes Königreich)', 'Englisch (Vereinigte Staaten)'])
  })
})
