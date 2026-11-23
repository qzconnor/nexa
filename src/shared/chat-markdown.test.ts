import { describe, expect, it } from 'vitest'
import type { ChatItem } from './chat'
import { chatMarkdown, fenced, inlineCode, lastAnswer, markdownFileName } from './chat-markdown'

const at = (time: string) => Date.parse(`2026-11-23T${time}:00Z`)
const base = { provider: 'claude' as const }

describe('chatMarkdown', () => {
  const info = { title: 'Fix *the* build', cwd: 'F:\\code\\app', branch: 'main', model: 'Opus 5.5', createdAt: at('09:00'), updatedAt: at('09:30'), cli: { claude: 'abc-123' } }

  it('puts the facts first and the messages under the authors', () => {
    const items: ChatItem[] = [
      { ...base, kind: 'user', id: 'u1', ts: at('09:00'), text: 'Bau es' },
      { ...base, kind: 'thinking', id: 't1', ts: at('09:01'), text: 'hmm' },
      { ...base, kind: 'tool', id: 'x1', ts: at('09:01'), tool: 'bash', name: 'Bash', title: 'Befehl ausführen', detail: 'npm run build', status: 'error', startedAt: at('09:01') },
      { ...base, kind: 'assistant', id: 'a1', ts: at('09:02'), text: 'Gebaut.' },
      { ...base, kind: 'tool', id: 'x2', ts: at('09:02'), tool: 'read', name: 'Read', title: 'Lesen', detail: 'a.ts', status: 'done', startedAt: at('09:02'), parentId: 'g1' },
      { ...base, kind: 'notice', id: 'n1', ts: at('09:03'), level: 'info', text: 'Kontext wurde zusammengefasst', detail: '90k → 10k Tokens', compaction: { before: 90_000, after: 10_000 } },
      { ...base, kind: 'user', id: 'h1', ts: at('09:04'), text: 'context', handoff: true },
      { provider: 'codex', kind: 'assistant', id: 'a2', ts: at('09:05'), text: 'Weiter mit Codex' },
    ]
    const md = chatMarkdown(info, items, { timeZone: 'UTC' })
    expect(md).toBe(
      [
        '# Fix \\*the\\* build',
        '',
        '- **Ordner:** `F:\\code\\app`\n- **Branch:** `main`\n- **Modell:** Opus 5.5\n- **Begonnen:** 23.11.2026, 09:00\n- **Zuletzt aktiv:** 23.11.2026, 09:30\n- **Claude Code:** `abc-123`',
        '',
        '## Montag, 23. November 2026',
        '',
        '### Du · 09:00',
        '',
        'Bau es',
        '',
        '### Claude · 09:01',
        '',
        '- **Befehl ausführen** `npm run build` (Fehler)',
        '',
        'Gebaut.',
        '',
        '---',
        '',
        '*Kontext wurde zusammengefasst · 90k → 10k Tokens*',
        '',
        '### Codex · 09:05',
        '',
        'Weiter mit Codex',
        '',
      ].join('\n'),
    )
  })

  it('starts a day anew with its own heading', () => {
    const items: ChatItem[] = [
      { ...base, kind: 'user', id: 'u1', ts: Date.parse('2026-11-22T23:59:00Z'), text: 'a' },
      { ...base, kind: 'user', id: 'u2', ts: Date.parse('2026-11-23T00:01:00Z'), text: 'b' },
    ]
    const md = chatMarkdown({ ...info, cli: {} }, items, { timeZone: 'UTC' })
    expect(md).toContain('## Sonntag, 22. November 2026\n\n### Du · 23:59\n\na\n\n## Montag, 23. November 2026\n\n### Du · 00:01\n\nb')
  })
})

describe('lastAnswer', () => {
  it("takes the main thread's last words", () => {
    const items: ChatItem[] = [
      { ...base, kind: 'assistant', id: 'a1', ts: 1, text: ' Erste ' },
      { ...base, kind: 'assistant', id: 'a2', ts: 2, text: 'Vom Agent', parentId: 'g' },
      { ...base, kind: 'assistant', id: 'a3', ts: 3, text: '  ' },
    ]
    expect(lastAnswer(items)).toBe('Erste')
    expect(lastAnswer([])).toBeNull()
  })
})

describe('helpers', () => {
  it('fences and quotes code with enough backticks', () => {
    expect(fenced('a ``` b')).toBe('````\na ``` b\n````')
    expect(inlineCode('a `b`')).toBe('`` a `b` ``')
  })

  it('makes a file name Windows takes', () => {
    expect(markdownFileName('Fix: a/b?')).toBe('Fix a b.md')
    expect(markdownFileName('con')).toBe('Chat.md')
  })
})
