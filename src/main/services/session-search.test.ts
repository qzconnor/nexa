import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { chatTexts, findInChat } from './session-search'

let n = 0
const user = (text: string, extra: Partial<ChatItem> = {}): ChatItem => ({ kind: 'user', id: `u${n++}`, ts: 0, provider: 'claude', text, ...extra }) as ChatItem
const answer = (text: string, provider: 'claude' | 'codex' = 'claude', extra: Partial<ChatItem> = {}): ChatItem =>
  ({ kind: 'assistant', id: `a${n++}`, ts: 0, provider, text, ...extra }) as ChatItem

describe('chatTexts', () => {
  it('keeps the prompts and answers of the main thread', () => {
    const texts = chatTexts([
      user('Baue den Login'),
      { kind: 'thinking', id: 't', ts: 0, provider: 'claude', text: 'hmm' } as ChatItem,
      answer('Fertig.', 'codex'),
      answer('Im Subagenten', 'claude', { parentId: 'agent' }),
      user('   '),
    ])
    expect(texts.map((t) => [t.role, t.provider, t.text])).toEqual([
      ['user', 'claude', 'Baue den Login'],
      ['assistant', 'codex', 'Fertig.'],
    ])
    expect(texts[0]!.folded).toBe('baue den login')
  })
})

describe('findInChat', () => {
  const texts = chatTexts([
    user('Wie öffne ich die Einstellungen?'),
    answer('Mit Strg+Komma öffnest du die Einstellungen. Dort gibt es auch das Theme.'),
    answer('Das Theme liegt unter Darstellung.', 'codex'),
  ])

  it('needs every term somewhere in the chat', () => {
    expect(findInChat(texts, ['einstellungen', 'darstellung'])).not.toBeNull()
    expect(findInChat(texts, ['einstellungen', 'gibtsnicht'])).toBeNull()
    expect(findInChat(texts, [])).toBeNull()
  })

  it('takes the message with the most terms, without regard to case and accents', () => {
    expect(findInChat(texts, ['offnest', 'theme'])).toEqual({
      role: 'assistant',
      provider: 'claude',
      snippet: 'Mit Strg+Komma öffnest du die Einstellungen. Dort gibt es auch das Theme.',
    })
    expect(findInChat(texts, ['darstellung'])?.provider).toBe('codex')
  })

  it('cuts a long message around the place found, on one line', () => {
    const long = chatTexts([user(`${'Vorher '.repeat(40)}hier\nsteht der Treffer ${'danach '.repeat(60)}`)])
    const hit = findInChat(long, ['treffer'])!
    expect(hit.snippet.startsWith('…')).toBe(true)
    expect(hit.snippet.endsWith('…')).toBe(true)
    expect(hit.snippet).toContain('hier steht der Treffer')
    expect(hit.snippet).not.toContain('\n')
    expect(hit.snippet.length).toBeLessThan(200)
  })
})
