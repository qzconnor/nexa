import { describe, expect, it } from 'vitest'
import { followsAfterScroll, type ScrollSample } from './useStickToBottom'

const at = (top: number, height: number, client = 500): ScrollSample => ({ top, height, distance: height - top - client })

describe('followsAfterScroll', () => {
  it('follows at the end', () => {
    expect(followsAfterScroll(false, at(1500, 2000), at(1000, 2000))).toBe(true)
  })

  it('keeps following when more came in between our scroll to the end and its event', () => {
    // Scrolled to the end of 2000, then a tool's card of 300 px came before the event.
    expect(followsAfterScroll(true, at(1500, 2300), at(1200, 1700))).toBe(true)
  })

  it('stops when the user moves up', () => {
    expect(followsAfterScroll(true, at(1200, 2000), at(1500, 2000))).toBe(false)
  })

  it('keeps following when content above shrinks and moves the view up', () => {
    expect(followsAfterScroll(true, at(1100, 1900), at(1300, 2000))).toBe(true)
  })

  it('stays stopped when the user scrolls down without reaching the end', () => {
    expect(followsAfterScroll(false, at(900, 2000), at(600, 2000))).toBe(false)
  })

  it('keeps its state on the first event', () => {
    expect(followsAfterScroll(true, at(0, 2000), null)).toBe(true)
    expect(followsAfterScroll(false, at(0, 2000), null)).toBe(false)
  })
})
