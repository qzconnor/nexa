import { describe, expect, it } from 'vitest'
import { cellNumber, sortOrder } from './table-sort'

describe('cellNumber', () => {
  it('reads numbers as German and English write them, with units', () => {
    expect(cellNumber('42')).toBe(42)
    expect(cellNumber('1.234,5')).toBe(1234.5)
    expect(cellNumber('1,234.5')).toBe(1234.5)
    expect(cellNumber('3,5')).toBe(3.5)
    expect(cellNumber('1,234,567')).toBe(1234567)
    expect(cellNumber('42 %')).toBe(42)
    expect(cellNumber('−3')).toBe(-3)
    expect(cellNumber('12 ms')).toBe(12)
    expect(cellNumber('€ 9,90')).toBe(9.9)
  })

  it('leaves text as it is', () => {
    expect(cellNumber('Datei 2')).toBeNull()
    expect(cellNumber('v1.2.3-beta')).toBeNull()
    expect(cellNumber('ja')).toBeNull()
  })
})

describe('sortOrder', () => {
  it('sorts numbers by value and text with the numbers in it counted', () => {
    expect(sortOrder(['10', '9', '1.000'], 'ascending')).toEqual([1, 0, 2])
    expect(sortOrder(['Datei 10', 'Datei 2', 'apfel'], 'ascending')).toEqual([2, 1, 0])
    expect(sortOrder(['b', 'a', 'c'], 'descending')).toEqual([2, 0, 1])
  })

  it('puts empty cells last and keeps equal ones in their order', () => {
    expect(sortOrder(['', '2', '1', ''], 'descending')).toEqual([1, 2, 0, 3])
    expect(sortOrder(['x', 'X', 'a'], 'ascending')).toEqual([2, 0, 1])
  })
})
