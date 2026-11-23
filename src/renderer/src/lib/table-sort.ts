export type SortDirection = 'ascending' | 'descending'

/**
 * A cell as a number, if it is one: `1.234,5` and `1,234.5`, `42 %`, `−3`, `12 ms`, `€ 9,90`. Null for
 * text, so a column sorts by numbers only when all its cells are numbers.
 */
export function cellNumber(text: string): number | null {
  const compact = text.replace(/[\s  ']/g, '').replace(/−/g, '-')
  // A currency before, a unit or percent after; a version (`v1.2`, `1.2.3-beta`) is text.
  const match = /^[€$£¥]?([+-]?\d[\d.,]*)(?:%|[a-zA-Zµ°€$£¥]{1,4})?$/.exec(compact)
  if (!match || /[.,]$/.test(match[1]!)) return null
  let number = match[1]!
  const dots = number.split('.').length - 1
  const commas = number.split(',').length - 1
  if (dots && commas) {
    // Both: the one further right separates the decimals.
    const decimal = number.lastIndexOf('.') > number.lastIndexOf(',') ? '.' : ','
    number = number.replace(decimal === '.' ? /,/g : /\./g, '').replace(decimal, '.')
  } else if (commas) {
    // `1,234,567` groups thousands, `3,5` has decimals.
    if (/^[+-]?[1-9]\d{0,2}(,\d{3}){2,}$/.test(number)) number = number.replace(/,/g, '')
    else if (commas === 1) number = number.replace(',', '.')
    else return null
  } else if (dots) {
    // `1.234.567` and `1.000` group thousands as German writes them; `1.5` has decimals.
    if (/^[+-]?[1-9]\d{0,2}(\.\d{3})+$/.test(number)) number = number.replace(/\./g, '')
    else if (dots > 1) return null
  }
  const value = Number(number)
  return Number.isFinite(value) ? value : null
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

/**
 * The order of a column's rows (indices into `values`) sorted by its cells: as numbers when every
 * filled cell is one, else as text with the numbers in it counted (`Datei 2` before `Datei 10`).
 * Empty cells go last either way; equal ones keep their order.
 */
export function sortOrder(values: readonly string[], direction: SortDirection): number[] {
  const cells = values.map((text) => text.trim())
  const numbers = cells.map((text) => (text ? cellNumber(text) : null))
  const numeric = cells.some(Boolean) && cells.every((text, i) => !text || numbers[i] !== null)
  const sign = direction === 'ascending' ? 1 : -1
  return cells
    .map((_, index) => index)
    .sort((a, b) => {
      const emptyA = !cells[a]
      const emptyB = !cells[b]
      if (emptyA || emptyB) return Number(emptyA) - Number(emptyB) || a - b
      const compared = numeric ? numbers[a]! - numbers[b]! : collator.compare(cells[a]!, cells[b]!)
      return compared * sign || a - b
    })
}
