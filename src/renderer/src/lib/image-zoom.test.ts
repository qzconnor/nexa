import { describe, expect, it } from 'vitest'
import { canPan, clampView, detailScale, fitScale, MAX_SCALE, wheelFactor, zoomAt } from './image-zoom'

const stage = { width: 800, height: 600 }
const large = { width: 1600, height: 900 }
const small = { width: 200, height: 100 }

describe('fitScale', () => {
  it('shrinks a large picture to the stage along its tighter axis', () => {
    expect(fitScale(large, stage)).toBe(0.5)
    expect(fitScale({ width: 400, height: 1200 }, stage)).toBe(0.5)
  })

  it('keeps a small picture at its own size', () => {
    expect(fitScale(small, stage)).toBe(1)
  })

  it('is 1 while a size is not known yet', () => {
    expect(fitScale({ width: 0, height: 0 }, stage)).toBe(1)
    expect(fitScale(large, { width: 0, height: 0 })).toBe(1)
  })
})

describe('clampView', () => {
  it('centres an axis on which the picture is smaller than the stage', () => {
    const view = clampView({ scale: 0.5, x: 120, y: -80 }, large, stage)
    expect(view.x).toBeCloseTo(0)
    expect(view.y).toBeCloseTo(0)
  })

  it('stops the edges of a larger picture at the stage', () => {
    // 1600 × 900 at 1: 400 to spare on each side horizontally, 150 vertically.
    expect(clampView({ scale: 1, x: 1000, y: -1000 }, large, stage)).toEqual({ scale: 1, x: 400, y: -150 })
    expect(clampView({ scale: 1, x: 100, y: 20 }, large, stage)).toEqual({ scale: 1, x: 100, y: 20 })
  })
})

describe('zoomAt', () => {
  it('keeps the point under the pointer where it is', () => {
    const point = { x: 200, y: 100 }
    const before = { scale: 1, x: 0, y: 0 }
    const after = zoomAt(before, 2, point, large, stage)
    // The picture's pixel under the point, before and after.
    const pixel = (v: typeof before) => ({ x: (point.x - v.x) / v.scale, y: (point.y - v.y) / v.scale })
    expect(after.scale).toBe(2)
    expect(pixel(after).x).toBeCloseTo(pixel(before).x)
    expect(pixel(after).y).toBeCloseTo(pixel(before).y)
  })

  it('zooms no further than the limits', () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 100, { x: 0, y: 0 }, large, stage).scale).toBe(MAX_SCALE)
    // Half the fitted 0.5.
    expect(zoomAt({ scale: 0.5, x: 0, y: 0 }, 0.01, { x: 0, y: 0 }, large, stage).scale).toBe(0.25)
  })

  it('centres the picture again when it gets smaller than the stage', () => {
    const view = zoomAt({ scale: 2, x: 300, y: 200 }, 0.5, { x: 300, y: 200 }, large, stage)
    expect(view.x).toBeCloseTo(0)
    expect(view.y).toBeCloseTo(0)
  })
})

describe('detailScale', () => {
  it('goes to the actual size from a picture shrunk a lot, else to twice the fitted size', () => {
    expect(detailScale(0.2)).toBe(1)
    expect(detailScale(0.8)).toBe(1.6)
    expect(detailScale(1)).toBe(2)
  })
})

describe('canPan', () => {
  it('is true only while the picture is larger than the stage', () => {
    expect(canPan({ scale: 0.5, x: 0, y: 0 }, large, stage)).toBe(false)
    expect(canPan({ scale: 1, x: 0, y: 0 }, large, stage)).toBe(true)
    expect(canPan({ scale: 1, x: 0, y: 0 }, small, stage)).toBe(false)
  })
})

describe('wheelFactor', () => {
  it('zooms in when the wheel turns up and out when it turns down, alike in both directions', () => {
    const up = wheelFactor({ deltaY: -100, deltaMode: 0 })
    const down = wheelFactor({ deltaY: 100, deltaMode: 0 })
    expect(up).toBeGreaterThan(1)
    expect(down).toBeLessThan(1)
    expect(up * down).toBeCloseTo(1)
  })

  it('counts lines as pixels', () => {
    expect(wheelFactor({ deltaY: 3, deltaMode: 1 })).toBeCloseTo(wheelFactor({ deltaY: 48, deltaMode: 0 }))
  })
})
