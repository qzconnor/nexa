import { describe, expect, it } from 'vitest'
import { compactionNotice } from '@shared/chat'
import { compactionOf } from './claude-tools'

describe('compactionOf', () => {
  it('reads the stream’s snake_case metadata', () => {
    // As Claude Code 2.1 sends it after /compact.
    const meta = { trigger: 'manual', pre_tokens: 37774, post_tokens: 10296, cumulative_dropped_tokens: 27478, duration_ms: 5512 }
    expect(compactionOf(meta)).toEqual({ trigger: 'manual', before: 37774, after: 10296, durationMs: 5512 })
  })

  it('leaves out what is missing', () => {
    expect(compactionOf({ trigger: 'auto', preTokens: 150000 })).toEqual({ trigger: 'auto', before: 150000, after: undefined, durationMs: undefined })
    expect(compactionOf({ trigger: 'other' }).trigger).toBeUndefined()
  })
})

describe('compactionNotice', () => {
  const base = { id: 'c', ts: 1, provider: 'claude' as const }

  it('says in words what the numbers say', () => {
    expect(compactionNotice(base, { trigger: 'manual', before: 37774, after: 10296 })).toMatchObject({
      kind: 'notice',
      level: 'info',
      text: 'Kontext wurde zusammengefasst',
      detail: '38k → 10k Tokens',
    })
    expect(compactionNotice(base, { trigger: 'auto', before: 150000 })).toMatchObject({ text: 'Kontext wurde automatisch zusammengefasst', detail: '150k Tokens vorher' })
    expect(compactionNotice(base, {}).detail).toBeUndefined()
  })
})
