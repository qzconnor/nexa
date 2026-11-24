import type { ITheme } from '@xterm/xterm'
import type { TerminalPalette } from '@shared/themes/types'
import { CODE_FONT_FALLBACKS, fontStack } from './fonts'

/**
 * xterm's colours from the theme's terminal palette. The background stays clear: the panel lies on
 * the code background of the theme (`--code-bg`), as code blocks do, and the window shows through it
 * as it does everywhere else.
 */
export function xtermTheme(t: TerminalPalette): ITheme {
  return {
    background: '#00000000',
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.cursorAccent,
    selectionBackground: t.selectionBackground,
    black: t.black,
    red: t.red,
    green: t.green,
    yellow: t.yellow,
    blue: t.blue,
    magenta: t.magenta,
    cyan: t.cyan,
    white: t.white,
    brightBlack: t.brightBlack,
    brightRed: t.brightRed,
    brightGreen: t.brightGreen,
    brightYellow: t.brightYellow,
    brightBlue: t.brightBlue,
    brightMagenta: t.brightMagenta,
    brightCyan: t.brightCyan,
    brightWhite: t.brightWhite,
  }
}

/**
 * Fonts with the icons of prompts like Starship or Oh My Posh (Nerd Fonts), where one is installed:
 * the browser takes a sign the code font lacks from the next font that has it, so the prompt shows
 * its symbols instead of boxes, as in Windows Terminal with such a font.
 */
const SYMBOL_FONTS = [
  'Symbols Nerd Font Mono',
  'JetBrainsMono Nerd Font Mono',
  'CaskaydiaCove Nerd Font Mono',
  'CaskaydiaMono Nerd Font Mono',
  'FiraCode Nerd Font Mono',
  'Hack Nerd Font Mono',
  'MesloLGS NF',
  'MesloLGS Nerd Font Mono',
] as const

/** The code font of the settings, then Nexa's own, then the symbol fonts, then any monospace font. */
export function terminalFontStack(codeFont: string): string {
  const fallbacks = [...CODE_FONT_FALLBACKS.filter((f) => f !== 'monospace'), ...SYMBOL_FONTS, 'monospace']
  return fontStack(codeFont, fallbacks)
}

/** The terminal's font size for the interface's: a little smaller, as code is in the chat. */
export function terminalFontSize(uiFontSize: number): number {
  return Math.max(9, Math.round(uiFontSize * 0.93))
}
