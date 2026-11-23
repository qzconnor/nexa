import { describe, expect, it } from 'vitest'
import { changeLines, changeStats, diffTexts, parseUnifiedDiff } from './diff'

describe('diffTexts', () => {
  it('marks the changed lines with their numbers', () => {
    const lines = diffTexts('a\nb\nc', 'a\nB\nc')
    expect(lines).toEqual([
      { kind: 'ctx', text: 'a', old: 1, new: 1 },
      { kind: 'del', text: 'b', old: 2, new: null },
      { kind: 'add', text: 'B', old: null, new: 2 },
      { kind: 'ctx', text: 'c', old: 3, new: 3 },
    ])
  })

  it('keeps only the context around a change', () => {
    const old = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    const lines = diffTexts(old, old.replace('line 10', 'line ten'), 2)
    expect(lines.filter((l) => l.kind === 'ctx').map((l) => l.old)).toEqual([8, 9, 11, 12])
    expect(changeStats(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('treats a new file as all added', () => {
    expect(changeStats(changeLines({ path: 'x.txt', type: 'add', newText: 'one\ntwo' }))).toEqual({ added: 2, removed: 0 })
  })
})

describe('parseUnifiedDiff', () => {
  it('numbers the lines of each hunk', () => {
    const lines = parseUnifiedDiff(['--- a/x', '+++ b/x', '@@ -3,2 +3,2 @@', ' keep', '-old', '+new', '\\ No newline at end of file'].join('\n'))
    expect(lines.map((l) => [l.kind, l.old, l.new])).toEqual([
      ['hunk', null, null],
      ['ctx', 3, 3],
      ['del', 4, null],
      ['add', null, 4],
    ])
  })
})
