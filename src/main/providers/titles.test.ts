import { describe, expect, it } from 'vitest'
import { cleanTitle, titleDescription, titleRequest } from './titles'

describe('cleanTitle', () => {
  it('keeps a plain title', () => {
    expect(cleanTitle('Kirschblüte in Kyoto planen')).toBe('Kirschblüte in Kyoto planen')
  })

  it('takes the first line that has text', () => {
    expect(cleanTitle('\n  Leuchtturm im Herbststurm  \nWeil es um ein Gedicht geht.')).toBe('Leuchtturm im Herbststurm')
  })

  it('drops quotes, markdown, a label and the closing period', () => {
    expect(cleanTitle('„Japanreise im Frühling“')).toBe('Japanreise im Frühling')
    expect(cleanTitle('"Fix the login bug."')).toBe('Fix the login bug')
    expect(cleanTitle('**Titel:** Rechnungen exportieren')).toBe('Rechnungen exportieren')
    expect(cleanTitle('# Build reparieren')).toBe('Build reparieren')
    expect(cleanTitle('*„Tests beschleunigen“*')).toBe('Tests beschleunigen')
  })

  it('keeps an ellipsis and quotes inside the title', () => {
    expect(cleanTitle('Warten auf …')).toBe('Warten auf …')
    expect(cleanTitle('Und dann...')).toBe('Und dann...')
    expect(cleanTitle('Der „neue“ Composer')).toBe('Der „neue“ Composer')
  })

  it('cuts a long answer', () => {
    const title = cleanTitle('Wort '.repeat(40))!
    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('…')).toBe(true)
  })

  it('is null without text', () => {
    expect(cleanTitle('')).toBeNull()
    expect(cleanTitle('  \n ""  ')).toBeNull()
    expect(cleanTitle(null)).toBeNull()
  })
})

describe('titleRequest', () => {
  it('marks the prompt as the message to name', () => {
    expect(titleRequest('  Schreib ein Gedicht  ')).toBe('Title for a chat that begins with this message:\n\n<message>\nSchreib ein Gedicht\n</message>')
  })

  it('cuts a long prompt', () => {
    expect(titleDescription('x'.repeat(5000))).toHaveLength(2001)
  })
})
