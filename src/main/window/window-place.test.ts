import { describe, expect, it } from 'vitest'
import { chatWindowPlace, isSavedBounds, onScreen, trayMenuPlace } from './window-place'

const area = { x: 0, y: 0, width: 1920, height: 1040 }

describe('trayMenuPlace', () => {
  const size = { width: 300, height: 400 }

  it('opens above a taskbar at the bottom, to the left where the right has no room', () => {
    expect(trayMenuPlace({ x: 1800, y: 1060 }, size, area)).toEqual({ x: 1500, y: 640, width: 300, height: 400 })
  })

  it('opens to the right of the pointer where there is room', () => {
    expect(trayMenuPlace({ x: 1000, y: 1060 }, size, area)).toEqual({ x: 1000, y: 640, width: 300, height: 400 })
  })

  it('opens below a taskbar at the top', () => {
    const below = { x: 0, y: 48, width: 1920, height: 1032 }
    expect(trayMenuPlace({ x: 1800, y: 20 }, size, below)).toEqual({ x: 1500, y: 48, width: 300, height: 400 })
  })

  it('stays beside a taskbar on the left or right', () => {
    const left = { x: 60, y: 0, width: 1860, height: 1080 }
    expect(trayMenuPlace({ x: 30, y: 1000 }, size, left)).toEqual({ x: 60, y: 600, width: 300, height: 400 })
    const right = { x: 0, y: 0, width: 1860, height: 1080 }
    expect(trayMenuPlace({ x: 1890, y: 1000 }, size, right)).toEqual({ x: 1560, y: 600, width: 300, height: 400 })
  })

  it('fits a display smaller than the menu, on a second display too', () => {
    expect(trayMenuPlace({ x: 2000, y: 500 }, { width: 300, height: 900 }, { x: 1920, y: 0, width: 1280, height: 600 })).toEqual({
      x: 2000,
      y: 0,
      width: 300,
      height: 600,
    })
  })
})

describe('chatWindowPlace', () => {
  it('puts a chat window down and right of the main window', () => {
    expect(chatWindowPlace({ x: 100, y: 50, width: 1280, height: 860 }, area)).toEqual({ x: 148, y: 98, width: 920, height: 820 })
  })

  it('keeps it on the display when the main window sits at its edge', () => {
    const place = chatWindowPlace({ x: 1500, y: 600, width: 400, height: 400 }, area)
    expect(place.x + place.width).toBeLessThanOrEqual(1920)
    expect(place.y + place.height).toBeLessThanOrEqual(1040)
  })

  it('fits a small display and centres without a main window', () => {
    expect(chatWindowPlace(null, { x: 1920, y: 0, width: 800, height: 600 })).toEqual({ x: 1920, y: 0, width: 800, height: 600 })
    expect(chatWindowPlace(null, area)).toEqual({ x: 500, y: 110, width: 920, height: 820 })
  })
})

describe('onScreen', () => {
  it('knows a place on a display that is gone', () => {
    expect(onScreen({ x: 200, y: 100, width: 800, height: 600 }, [area])).toBe(true)
    expect(onScreen({ x: 2200, y: 100, width: 800, height: 600 }, [area])).toBe(false)
  })
})

describe('isSavedBounds', () => {
  it('takes only complete bounds', () => {
    expect(isSavedBounds({ x: 1, y: 2, width: 3, height: 4, maximized: false })).toBe(true)
    expect(isSavedBounds({ x: 1, y: 2, width: 3, height: 4 })).toBe(false)
    expect(isSavedBounds({ x: 'a', y: 2, width: 3, height: 4, maximized: true })).toBe(false)
  })
})
