import { describe, expect, it } from 'vitest'
import { searchTerms } from '@shared/utils'
import { matchSettings, settingsIndex } from './settings-index'

const windows = settingsIndex('win32')
const linux = settingsIndex('linux')
const ids = new Set(windows.map((e) => e.id))

describe('settingsIndex', () => {
  it('has every anchor once', () => {
    expect(ids.size).toBe(windows.length)
  })

  it('leaves out what needs the window material elsewhere', () => {
    expect(windows.some((e) => e.id === 'appearance.material')).toBe(true)
    expect(linux.some((e) => e.id === 'appearance.material')).toBe(false)
  })

  it('leaves out the nx command with its rows elsewhere', () => {
    expect(windows.filter((e) => e.id === 'general.command' || e.section === 'general.command')).toHaveLength(3)
    expect(linux.some((e) => e.id === 'general.command' || e.section === 'general.command')).toBe(false)
  })

  it('knows every anchor the settings components use, and they use every one', () => {
    const sources = import.meta.glob<string>('../components/settings/*.vue', { query: '?raw', import: 'default', eager: true })
    const used = new Set<string>()
    for (const source of Object.values(sources)) {
      for (const m of source.matchAll(/(?<![:\w])(?:anchor|data-setting)="([\w.]+)"/g)) used.add(m[1])
      // Anchors of cards made in a loop, from an object: `anchor: 'usage.claude'`.
      for (const m of source.matchAll(/\banchor: '([\w.]+)'/g)) used.add(m[1])
      // The cards of the CLIs: `:anchor="id"` and `cliAnchor(id, 'row')` for each CLI.
      if (source.includes(':anchor="id"')) ['claude', 'codex', 'gemini'].forEach((id) => used.add(id))
      for (const m of source.matchAll(/cliAnchor\(id, '(\w+)'\)/g)) ['claude', 'codex', 'gemini'].forEach((id) => used.add(`${id}.${m[1]}`))
    }
    for (const anchor of used) expect(ids.has(anchor as never), anchor).toBe(true)
    for (const id of ids) expect(used.has(id), id).toBe(true)
  })
})

describe('matchSettings', () => {
  const match = (query: string) => matchSettings(windows, searchTerms(query))

  it('finds nothing to filter without a query', () => {
    expect(match('  ')).toBeNull()
  })

  it('shows a row with its card, and counts the hits per section', () => {
    const found = match('acryl')!
    expect(found.ids.has('appearance.material')).toBe(true)
    expect(found.ids.has('appearance.window')).toBe(true)
    expect(found.ids.has('appearance.radius')).toBe(false)
    expect([...found.tabs.keys()]).toEqual(['appearance'])
  })

  it('shows every row of a card whose title matches', () => {
    const found = match('fenster')!
    expect(found.ids.has('appearance.radius')).toBe(true)
  })

  it('ignores case and accents and needs every word', () => {
    expect(match('SCHRIFTGROSSE')).not.toBeNull()
    expect(match('gedanken thinking')!.ids.has('chat.showThinking')).toBe(true)
    expect(match('gedanken port')!.ids.size).toBe(0)
  })

  it('finds the rows of every CLI', () => {
    const found = match('zusätzliche argumente')!
    expect(found.ids.has('claude.extraArgs')).toBe(true)
    expect(found.ids.has('codex.extraArgs')).toBe(true)
    expect(found.ids.has('gemini.extraArgs')).toBe(true)
    expect(found.tabs.get('providers')).toBe(3)
  })
})
