import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'

/** A token of the theme mixed into transparency, for the tints of lines. */
const tint = (token: string, percent: number) => `color-mix(in oklab, var(${token}) ${percent}%, transparent)`

/**
 * How diffs look: in the code colours of the theme (`--code-*`, `--syn-*`, see themes/apply.ts), like
 * the code in the chat. `colors` are the variables the lines' tints read; `--diff-add-new` is the
 * lighter tint of a file that is all added, so it reads like code.
 */
export function useDiffStyle() {
  const settings = useSettingsStore(null)

  const colors: Record<string, string> = {
    background: 'var(--code-bg)',
    color: 'var(--code-fg)',
    '--diff-add': tint('--syn-green', 15),
    '--diff-add-new': tint('--syn-green', 6),
    '--diff-add-gutter': tint('--syn-green', 24),
    '--diff-del': tint('--syn-red', 15),
    '--diff-del-gutter': tint('--syn-red', 24),
    // The words that changed in a line, over its tint.
    '--diff-add-word': tint('--syn-green', 32),
    '--diff-del-word': tint('--syn-red', 32),
    '--diff-hunk': tint('--code-fg', 6),
    // The hatching of a side without a line, side by side.
    '--diff-filler': tint('--code-fg', 12),
    '--diff-header': tint('--code-fg', 5),
    '--diff-number': tint('--code-fg', 40),
    '--diff-add-number': 'var(--syn-green)',
    '--diff-del-number': 'var(--syn-red)',
  }

  const fontSize = computed(() => Math.max(10, Math.round(settings.settings.appearance.uiFontSize * 0.93)))
  const rowHeight = computed(() => Math.round(fontSize.value * 1.55))
  /**
   * The code font with its ligatures, as everywhere code shows. Fonts for code keep a ligature as
   * wide as the characters it joins, so the columns (and the probe's count of them) stay as they are.
   */
  const font = { fontFamily: 'var(--code-font)', fontFeatureSettings: 'var(--code-font-features)' }

  return { colors: computed(() => colors), fontSize, rowHeight, font: computed(() => font) }
}
