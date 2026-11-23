import { describe, expect, it } from 'vitest'
import type { InteractionRequest } from '@shared/chat'
import { attentionText, formatReset, limitReset, nearLimitLines, plainText } from './notification-text'

// Local times: the notification shows the reset in the user's time zone. 23 November 2026 is a Monday.
const NOW = new Date(2026, 10, 23, 12, 0).getTime()
const EVENING = new Date(2026, 10, 23, 19, 40).getTime()
const FRIDAY = new Date(2026, 10, 27, 9, 5).getTime()

const input = (request: InteractionRequest) => ({ kind: 'input' as const, provider: 'claude' as const, request })

describe('attentionText', () => {
  it('tells a finished turn with the beginning of the answer', () => {
    const done = { kind: 'done' as const, provider: 'claude' as const, busyMs: 60_000, answer: '## Fertig\n\nDie **Tests** laufen:\n```sh\nnpm test\n```' }
    expect(attentionText(done, 'Claude', true)).toEqual({ title: 'Claude ist fertig', detail: 'Fertig Die Tests laufen:' })
    expect(attentionText(done, 'Claude', false)).toEqual({ title: 'Claude ist fertig', detail: null })
  })

  it('tells a failed turn with its error', () => {
    const failed = { kind: 'done' as const, provider: 'codex' as const, busyMs: 1, answer: null, error: 'Netzwerk weg' }
    expect(attentionText(failed, 'Codex', true)).toEqual({ title: 'Codex ist auf einen Fehler gestoßen', detail: 'Netzwerk weg' })
  })

  it('cuts long answers', () => {
    const done = { kind: 'done' as const, provider: 'claude' as const, busyMs: 1, answer: 'x'.repeat(500) }
    expect(attentionText(done, 'Claude', true).detail).toHaveLength(180)
  })

  it('names what waits for the user', () => {
    const permission = input({ type: 'permission', toolName: 'Bash', title: 'Befehl ausführen', detail: 'npm   install', options: [] })
    expect(attentionText(permission, 'Claude', true)).toEqual({ title: 'Claude braucht deine Erlaubnis', detail: 'Befehl ausführen: npm install' })
    expect(attentionText(permission, 'Claude', false)).toEqual({ title: 'Claude braucht deine Erlaubnis', detail: 'Befehl ausführen' })
    const question = input({
      type: 'question',
      questions: [{ id: 'q', header: 'Weg', question: 'Welcher Weg?', options: [], multiSelect: false, allowOther: true }],
    })
    expect(attentionText(question, 'Claude', true)).toEqual({ title: 'Claude hat eine Frage', detail: 'Welcher Weg?' })
    expect(attentionText(input({ type: 'plan', plan: '# Plan\n- Schritt' }), 'Claude', true)).toEqual({
      title: 'Claude wartet auf die Freigabe des Plans',
      detail: 'Plan Schritt',
    })
    expect(attentionText(input({ type: 'elicitation', server: 'github', message: 'Token?' }), 'Codex', false)).toEqual({
      title: '„github“ braucht eine Eingabe',
      detail: null,
    })
  })

  it('tells when a limit resets, else what the CLI said', () => {
    const limit = { kind: 'limit' as const, provider: 'claude' as const, accountId: 'a', message: "You've hit your limit" }
    expect(attentionText(limit, 'Claude', true, EVENING, NOW)).toEqual({ title: 'Limit erreicht', detail: 'Reset um 19:40' })
    expect(attentionText(limit, 'Claude', false, EVENING, NOW)).toEqual({ title: 'Limit erreicht', detail: 'Reset um 19:40' })
    expect(attentionText(limit, 'Claude', true)).toEqual({ title: 'Limit erreicht', detail: "You've hit your limit" })
    expect(attentionText(limit, 'Claude', false)).toEqual({ title: 'Limit erreicht', detail: null })
  })
})

describe('limits', () => {
  it('formats the reset for today and other days', () => {
    expect(formatReset(EVENING, NOW)).toBe('um 19:40')
    expect(formatReset(FRIDAY, NOW)).toBe('Fr. 09:05')
  })

  it('takes the latest reset of the full windows', () => {
    expect(
      limitReset([
        { key: 'five_hour', label: '5 Stunden', usedPercent: 100, resetsAt: EVENING },
        { key: 'seven_day', label: 'Woche', usedPercent: 100, resetsAt: FRIDAY },
        { key: 'opus', label: 'Opus', usedPercent: 50, resetsAt: FRIDAY + 1 },
      ]),
    ).toBe(FRIDAY)
    expect(limitReset([{ key: 'five_hour', label: '5 Stunden', usedPercent: 99, resetsAt: EVENING }])).toBeUndefined()
  })

  it('lists the windows of a warning', () => {
    const lines = nearLimitLines(
      [
        { window: { key: 'five_hour', label: '5 Stunden', usedPercent: 82.4, resetsAt: EVENING }, percent: 82 },
        { window: { key: 'primary', label: 'Monat', usedPercent: 80 }, percent: 80 },
      ],
      NOW,
    )
    expect(lines).toEqual(['5 Stunden: 82 %, Reset um 19:40', 'Monat: 80 %'])
  })
})

describe('plainText', () => {
  it('drops Markdown and code blocks', () => {
    expect(plainText('> Zitat mit [Link](https://x) und `code`')).toBe('Zitat mit Link und code')
    expect(plainText('```\nnur Code\n```')).toBeNull()
    expect(plainText(null)).toBeNull()
  })
})
