import { describe, expect, it } from 'vitest'
import { THEMES } from '@shared/themes/builtin'
import { terminalFontSize, terminalFontStack, xtermTheme } from './terminal-theme'

describe('xtermTheme', () => {
  it("takes the theme's palette and leaves the background to the panel", () => {
    const palette = THEMES[0]!.terminal
    const theme = xtermTheme(palette)
    expect(theme.background).toBe('#00000000')
    expect(theme.foreground).toBe(palette.foreground)
    expect(theme.brightMagenta).toBe(palette.brightMagenta)
  })
})

describe('terminalFontStack', () => {
  it('puts the symbol fonts of prompts behind the code font, before any monospace', () => {
    const stack = terminalFontStack('Cascadia Code')
    expect(stack.startsWith('"Cascadia Code", "Geist Mono Variable"')).toBe(true)
    expect(stack).toContain('"JetBrainsMono Nerd Font Mono"')
    expect(stack.endsWith(', monospace')).toBe(true)
  })
})

describe('terminalFontSize', () => {
  it('is a little smaller than the interface', () => {
    expect(terminalFontSize(14)).toBe(13)
    expect(terminalFontSize(8)).toBe(9)
  })
})
