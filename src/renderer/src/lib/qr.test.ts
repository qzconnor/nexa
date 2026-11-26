import { encode } from 'uqr'
import { describe, expect, it } from 'vitest'
import { qrPath } from './qr'

/** The modules a path paints, read back from its runs. */
function painted(d: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false))
  for (const [, x, y, width] of d.matchAll(/M(\d+) (\d+)h(\d+)v1H\d+z/g)) {
    for (let i = 0; i < Number(width); i++) grid[Number(y)]![Number(x) + i] = true
  }
  return grid
}

describe('qrPath', () => {
  const text = 'https://nexa.example.com/app/#nexa1:eyJ1IjoiaHR0cHM6Ly9uZXhhLmV4YW1wbGUuY29tIn0'

  it('paints exactly the dark modules, with a quiet zone of two', () => {
    const { size, d } = qrPath(text)
    const { data } = encode(text, { ecc: 'L', boostEcc: true, border: 2 })
    expect(size).toBe(data.length)
    expect(painted(d, size)).toEqual(data)
    expect(data[0]!.some(Boolean) || data[1]!.some(Boolean)).toBe(false)
    // The finder pattern's dark corner sits right inside the quiet zone.
    expect(data[2]![2]).toBe(true)
  })

  it('joins dark modules in a row into one rectangle', () => {
    const { d } = qrPath(text)
    // The finder pattern's top edge: seven modules in one run.
    expect(d).toContain('M2 2h7v1H2z')
  })
})
