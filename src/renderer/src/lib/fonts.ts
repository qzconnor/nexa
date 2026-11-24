/**
 * Nexa's own fonts (fontsource, always there) and what stands in for them: what shows without a
 * choice, and behind a chosen font for what it lacks. main.css paints the same first.
 */
export const UI_FONT_FALLBACKS = ['Geist Variable', 'Segoe UI Variable Text', 'Segoe UI', 'system-ui', 'sans-serif'] as const
export const CODE_FONT_FALLBACKS = ['Geist Mono Variable', 'Cascadia Mono', 'Consolas', 'monospace'] as const

/** Suggested first in the font pickers, where installed. */
export const RECOMMENDED_UI_FONTS = [
  'Segoe UI Variable Text',
  'Segoe UI',
  'Inter',
  'Geist',
  'Roboto',
  'Open Sans',
  'Noto Sans',
  'Source Sans 3',
  'IBM Plex Sans',
  'Ubuntu',
  'Cantarell',
] as const
export const RECOMMENDED_CODE_FONTS = [
  'Cascadia Mono',
  'Cascadia Code',
  'CaskaydiaCove Nerd Font',
  'CaskaydiaMono Nerd Font',
  'JetBrains Mono',
  'JetBrainsMono Nerd Font',
  'JetBrainsMono Nerd Font Mono',
  'Fira Code',
  'FiraCode Nerd Font',
  'Geist Mono',
  'Iosevka',
  'Hack',
  'Source Code Pro',
  'Consolas',
] as const

/** Keywords of CSS, not names: they stay unquoted. */
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'emoji',
  'math',
  'fangsong',
])

/** The fonts of a choice (one or a comma separated list, maybe quoted), in order. */
function fontNames(choice: string): string[] {
  return choice
    .split(',')
    .map((part) => part.trim().replace(/^["']|["']$/g, '').trim())
    .filter(Boolean)
}

/**
 * A CSS font stack: the chosen fonts first, then the `fallbacks` they don't name already. Names are
 * quoted, without the quotes, backslashes and control characters typed into them, so the stack
 * stays valid CSS whatever the user entered.
 */
export function fontStack(choice: string, fallbacks: readonly string[]): string {
  const chosen = fontNames(choice)
  const named = new Set(chosen.map((name) => name.toLowerCase()))
  return [...chosen, ...fallbacks.filter((name) => !named.has(name.toLowerCase()))]
    .map((name) => (GENERIC_FAMILIES.has(name.toLowerCase()) ? name.toLowerCase() : `"${name.replace(/[\p{Cc}"\\]/gu, '')}"`))
    .join(', ')
}

/**
 * The code font's features: contextual alternates (how JetBrains Mono, Fira Code or Cascadia Code
 * join `=>`) and the standard ligatures. Switched on explicitly too, as in the Claude Manager:
 * Chromium leaves them out for any letter spacing.
 */
export function ligatureFeatures(on: boolean): string {
  return on ? '"calt" 1, "liga" 1' : '"calt" 0, "liga" 0'
}

let cache: Promise<string[]> | null = null

/** Installed font families; listed once per app session (PowerShell or fontconfig in the main process). */
export function listInstalledFonts(): Promise<string[]> {
  cache ??= window.api.app.listFonts().catch(() => {
    cache = null
    return []
  })
  return cache
}
