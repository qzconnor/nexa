import { describe, expect, it } from 'vitest'
import { THEME_COLOR_KEYS } from '@shared/themes/file'
import { COLOR_SECTIONS } from './color-info'

const described = COLOR_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.colors))

describe('COLOR_SECTIONS', () => {
  it('describes every color of a theme exactly once', () => {
    const keys = described.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual([...THEME_COLOR_KEYS].sort())
  })

  it('has a label and a description for each', () => {
    for (const info of described) {
      expect(info.label.trim(), info.key).not.toBe('')
      expect(info.description.trim(), info.key).not.toBe('')
    }
  })

  it('puts the app colors under App and the palette under Code', () => {
    for (const section of COLOR_SECTIONS) {
      const prefix = section.id === 'app' ? 'app.' : 'terminal.'
      for (const group of section.groups) {
        for (const info of group.colors) expect(info.key.startsWith(prefix), info.key).toBe(true)
      }
    }
  })
})
