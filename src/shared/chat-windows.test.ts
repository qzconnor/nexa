import { describe, expect, it } from 'vitest'
import { chatWindowSession, MAX_HANDOFF_IMAGES, parseHandoff, parseMainWindowRequest } from './chat-windows'

describe('chatWindowSession', () => {
  it('reads the chat of a window from its address', () => {
    expect(chatWindowSession('?chat=abc')).toBe('abc')
    expect(chatWindowSession('')).toBeNull()
    expect(chatWindowSession('?chat=')).toBeNull()
    expect(chatWindowSession(`?chat=${'x'.repeat(201)}`)).toBeNull()
  })
})

describe('parseHandoff', () => {
  it('keeps a draft and the panels, nothing else', () => {
    expect(parseHandoff({ draft: { text: 'Hallo', images: ['C:\\a.png', 3] }, terminal: true, browser: 'ja', extra: 1 })).toEqual({
      draft: { text: 'Hallo', images: ['C:\\a.png'] },
      terminal: true,
      browser: false,
    })
  })

  it('drops an empty draft and anything that is not one', () => {
    expect(parseHandoff({ draft: { text: '', images: [] } }).draft).toBeNull()
    expect(parseHandoff(null)).toEqual({ draft: null, terminal: false, browser: false })
    expect(parseHandoff([1]).draft).toBeNull()
  })

  it('caps what a window can send', () => {
    const images = Array.from({ length: MAX_HANDOFF_IMAGES + 5 }, (_, i) => `C:\\${i}.png`)
    expect(parseHandoff({ draft: { text: 'x', images } }).draft?.images).toHaveLength(MAX_HANDOFF_IMAGES)
  })
})

describe('parseMainWindowRequest', () => {
  it('takes the requests a chat window may make', () => {
    expect(parseMainWindowRequest({ kind: 'open', sessionId: 's1' })).toEqual({ kind: 'open', sessionId: 's1' })
    expect(parseMainWindowRequest({ kind: 'new', projectId: null })).toEqual({ kind: 'new', projectId: null })
    expect(parseMainWindowRequest({ kind: 'palette', query: '>' })).toEqual({ kind: 'palette', query: '>' })
  })

  it('refuses others', () => {
    expect(() => parseMainWindowRequest({ kind: 'quit' })).toThrow()
    expect(() => parseMainWindowRequest({ kind: 'remove' })).toThrow()
    expect(() => parseMainWindowRequest('open')).toThrow()
  })
})
