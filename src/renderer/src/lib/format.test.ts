import { describe, expect, it } from 'vitest'
import { andList } from './format'

describe('andList', () => {
  it('names one, two and more as prose', () => {
    expect(andList([])).toBe('')
    expect(andList(['Codex'])).toBe('Codex')
    expect(andList(['Claude Code', 'Codex'])).toBe('Claude Code und Codex')
    expect(andList(['Claude Code', 'Codex', 'Antigravity CLI'])).toBe('Claude Code, Codex und Antigravity CLI')
  })
})
