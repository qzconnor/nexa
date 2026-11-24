import { describe, expect, it } from 'vitest'
import { fontFamilies } from './fonts'

describe('fontFamilies', () => {
  it('lists each family once, sorted, without blank lines and line ends', () => {
    // fc-list prints a line per font file, so a family with several styles comes more than once.
    const stdout = 'Fira Code\r\nCascadia Mono\r\n\r\n  JetBrains Mono  \nFira Code\n'
    expect(fontFamilies(stdout)).toEqual(['Cascadia Mono', 'Fira Code', 'JetBrains Mono'])
  })

  it('finds nothing in an empty listing', () => {
    expect(fontFamilies('')).toEqual([])
    expect(fontFamilies('\r\n')).toEqual([])
  })
})
