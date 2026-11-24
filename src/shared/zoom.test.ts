import { describe, expect, it } from 'vitest'
import { DEFAULT_ZOOM, normalizeZoom, stepZoom, ZOOM_STEPS } from './zoom'

describe('normalizeZoom', () => {
  it('keeps the steps', () => {
    for (const step of ZOOM_STEPS) expect(normalizeZoom(step)).toBe(step)
  })

  it('takes the nearest step for other values', () => {
    expect(normalizeZoom(123)).toBe(125)
    expect(normalizeZoom(10)).toBe(67)
    expect(normalizeZoom(500)).toBe(200)
  })

  it('falls back to 100 % for what is no number', () => {
    expect(normalizeZoom(Number.NaN)).toBe(DEFAULT_ZOOM)
    expect(normalizeZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ZOOM)
  })
})

describe('stepZoom', () => {
  it('goes to the neighbouring step', () => {
    expect(stepZoom(100, 1)).toBe(110)
    expect(stepZoom(110, 1)).toBe(125)
    expect(stepZoom(100, -1)).toBe(90)
    expect(stepZoom(75, -1)).toBe(67)
  })

  it('stays at the ends', () => {
    expect(stepZoom(200, 1)).toBe(200)
    expect(stepZoom(67, -1)).toBe(67)
  })

  it('steps on from the nearest step', () => {
    expect(stepZoom(130, 1)).toBe(150)
  })
})
