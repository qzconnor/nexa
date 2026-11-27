import { encode } from 'uqr'

export interface QrPath {
  /** Modules per side, the quiet zone included. */
  size: number
  /** The dark modules as one SVG path in module units. */
  d: string
}

/** Modules of light around the code: scanners find its edge by it, on any background. */
const QUIET_ZONE = 2

/**
 * A QR code of `text` as one path, a run of dark modules in a row per rectangle: hundreds of single
 * squares would be as many DOM nodes and show hairline gaps between them when scaled.
 */
export function qrPath(text: string): QrPath {
  // Shown on a screen, nothing smudges it: the fewest modules (larger ones scan from further away),
  // with as much correction as fits in them.
  const { size, data } = encode(text, { ecc: 'L', boostEcc: true, border: QUIET_ZONE })
  let d = ''
  data.forEach((row, y) => {
    for (let x = 0; x < size; x++) {
      if (!row[x]) continue
      const start = x
      while (row[x + 1]) x++
      d += `M${start} ${y}h${x - start + 1}v1H${start}z`
    }
  })
  return { size, d }
}
