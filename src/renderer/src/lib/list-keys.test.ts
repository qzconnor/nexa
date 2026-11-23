import { describe, expect, it } from 'vitest'
import { isMenuKey, listMove } from './list-keys'

const row = (index: number, expanded: boolean | null = null, parent = -1) => ({ index, count: 5, expanded, parent })

describe('listMove', () => {
  it('goes up and down and stops at the ends', () => {
    expect(listMove('ArrowDown', row(1))).toEqual({ to: 2 })
    expect(listMove('ArrowDown', row(4))).toEqual({ to: 4 })
    expect(listMove('ArrowUp', row(0))).toEqual({ to: 0 })
    expect(listMove('Home', row(3))).toEqual({ to: 0 })
    expect(listMove('End', row(1))).toEqual({ to: 4 })
  })

  it('opens and enters a group to the right, closes it or goes up to the left', () => {
    expect(listMove('ArrowRight', row(1, false))).toEqual({ toggle: true })
    expect(listMove('ArrowRight', row(1, true))).toEqual({ to: 2 })
    expect(listMove('ArrowRight', row(2))).toBeNull()
    expect(listMove('ArrowLeft', row(1, true))).toEqual({ toggle: true })
    expect(listMove('ArrowLeft', row(3, null, 1))).toEqual({ to: 1 })
    expect(listMove('ArrowLeft', row(0))).toBeNull()
  })

  it('leaves other keys alone', () => {
    expect(listMove('Enter', row(1))).toBeNull()
    expect(listMove('ArrowDown', { index: -1, count: 5, expanded: null, parent: -1 })).toBeNull()
  })
})

describe('isMenuKey', () => {
  const base = { key: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
  it('knows the menu key and Shift+F10', () => {
    expect(isMenuKey({ ...base, key: 'ContextMenu' })).toBe(true)
    expect(isMenuKey({ ...base, key: 'F10', shiftKey: true })).toBe(true)
    expect(isMenuKey({ ...base, key: 'F10' })).toBe(false)
    expect(isMenuKey({ ...base, key: 'ContextMenu', ctrlKey: true })).toBe(false)
  })
})
