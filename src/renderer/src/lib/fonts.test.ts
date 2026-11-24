import { describe, expect, it } from 'vitest'
import { CODE_FONT_FALLBACKS, fontStack, ligatureFeatures, UI_FONT_FALLBACKS } from './fonts'

const families = (stack: string) => stack.split(', ')
const quoted = (names: readonly string[]) => names.map((f) => (f === 'monospace' || f === 'sans-serif' || f === 'system-ui' ? f : `"${f}"`))

describe('fontStack', () => {
  it("puts the chosen font first, then Nexa's own, with generic families unquoted", () => {
    const stack = families(fontStack('Fira Code', CODE_FONT_FALLBACKS))
    expect(stack[0]).toBe('"Fira Code"')
    expect(stack.slice(1)).toEqual(quoted(CODE_FONT_FALLBACKS))
    expect(stack.at(-1)).toBe('monospace')
  })

  it("is Nexa's own without a choice", () => {
    expect(fontStack('', UI_FONT_FALLBACKS)).toBe(quoted(UI_FONT_FALLBACKS).join(', '))
    expect(fontStack(' , ', CODE_FONT_FALLBACKS)).toBe(quoted(CODE_FONT_FALLBACKS).join(', '))
  })

  it('does not repeat a fallback that was chosen, whatever the case', () => {
    const stack = families(fontStack('consolas', CODE_FONT_FALLBACKS))
    expect(stack[0]).toBe('"consolas"')
    expect(stack.filter((f) => f.toLowerCase() === '"consolas"')).toHaveLength(1)
    expect(stack).toHaveLength(CODE_FONT_FALLBACKS.length)
  })

  it('takes a comma separated list with quotes and spaces', () => {
    const stack = families(fontStack(` "JetBrains Mono" , 'Fira Code',ui-monospace, `, CODE_FONT_FALLBACKS))
    expect(stack.slice(0, 3)).toEqual(['"JetBrains Mono"', '"Fira Code"', 'ui-monospace'])
  })

  it('keeps a generic family put in the middle and does not add it again', () => {
    const stack = families(fontStack('Hack, Monospace', CODE_FONT_FALLBACKS))
    expect(stack.slice(0, 2)).toEqual(['"Hack"', 'monospace'])
    expect(stack.filter((f) => f === 'monospace')).toHaveLength(1)
  })

  it('drops quotes, backslashes and line breaks inside a name, so the stack stays valid CSS', () => {
    expect(families(fontStack('My"Font\\', UI_FONT_FALLBACKS))[0]).toBe('"MyFont"')
    expect(families(fontStack('Bad\nFont', UI_FONT_FALLBACKS))[0]).toBe('"BadFont"')
  })
})

describe('ligatureFeatures', () => {
  it('switches the contextual alternates and the standard ligatures on or off', () => {
    expect(ligatureFeatures(true)).toBe('"calt" 1, "liga" 1')
    expect(ligatureFeatures(false)).toBe('"calt" 0, "liga" 0')
  })
})
