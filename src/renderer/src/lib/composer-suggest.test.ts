import { describe, expect, it } from 'vitest'
import type { CommandOption } from '@shared/types'
import { applySuggestion, filterCommands, findPaths, suggestionText, triggerAt } from './composer-suggest'

const cmd = (name: string, extra: Partial<CommandOption> = {}): CommandOption => ({ name, kind: 'command', insert: `/${name}`, ...extra })

describe('triggerAt', () => {
  it('finds a command only as the first word', () => {
    expect(triggerAt('/rev', 4, 'claude')).toEqual({ kind: 'command', query: 'rev', from: 0, to: 4 })
    expect(triggerAt('/', 1, 'claude')).toEqual({ kind: 'command', query: '', from: 0, to: 1 })
    expect(triggerAt('mach /rev', 9, 'claude')).toBeNull()
    expect(triggerAt('/review jetzt', 13, 'claude')).toBeNull()
  })

  it('replaces the rest of the word after the cursor', () => {
    expect(triggerAt('/reviewx dies', 3, 'claude')).toEqual({ kind: 'command', query: 're', from: 0, to: 8 })
  })

  it('finds skills for Codex only', () => {
    expect(triggerAt('nutze $pdf', 10, 'codex')).toEqual({ kind: 'skill', query: 'pdf', from: 6, to: 10 })
    expect(triggerAt('nutze $pdf', 10, 'claude')).toBeNull()
    expect(triggerAt('kostet a$b', 10, 'codex')).toBeNull()
  })

  it('finds files after @, with and without quotes', () => {
    expect(triggerAt('schau @src/ma', 13, 'claude')).toEqual({ kind: 'file', query: 'src/ma', from: 6, to: 13 })
    expect(triggerAt('@', 1, 'codex')).toEqual({ kind: 'file', query: '', from: 0, to: 1 })
    expect(triggerAt('mail@host', 9, 'claude')).toBeNull()
    expect(triggerAt('lies @"My Docs/a', 16, 'claude')).toEqual({ kind: 'file', query: 'My Docs/a', from: 5, to: 16 })
  })

  it('takes a quoted path up to its closing quote', () => {
    const text = 'lies @"My Docs/a.md" bitte'
    expect(triggerAt(text, 14, 'claude')).toMatchObject({ kind: 'file', query: 'My Docs', from: 5, to: 20 })
    expect(triggerAt(text, 9, 'claude')).toMatchObject({ query: 'My', to: 20 })
  })
})

describe('filterCommands', () => {
  const list = [cmd('review'), cmd('rea:investigate_feature', { kind: 'mcp' }), cmd('init', { description: 'Review the repo' }), cmd('compact', { aliases: ['rv'] })]

  it('keeps the order of the CLI without a query', () => {
    expect(filterCommands(list, '').map((c) => c.name)).toEqual(['review', 'rea:investigate_feature', 'init', 'compact'])
  })

  it('ranks name, start of a part, alias, then description', () => {
    expect(filterCommands(list, 're').map((c) => c.name)).toEqual(['review', 'rea:investigate_feature', 'init'])
    expect(filterCommands(list, 'inv').map((c) => c.name)).toEqual(['rea:investigate_feature'])
    expect(filterCommands(list, 'rv').map((c) => c.name)).toEqual(['compact'])
    expect(filterCommands(list, 'repo').map((c) => c.name)).toEqual(['init'])
  })

  it('narrows to a kind', () => {
    expect(filterCommands(list, '', 'mcp').map((c) => c.name)).toEqual(['rea:investigate_feature'])
  })
})

describe('findPaths', () => {
  const paths = ['README.md', 'src/main.ts', 'src/lib/main-utils.ts', 'docs/Main Notes.md', 'package.json']

  it('lists the top level, folders first, without a query', () => {
    expect(findPaths(paths, '')).toEqual([
      { path: 'docs', dir: true },
      { path: 'src', dir: true },
      { path: 'package.json', dir: false },
      { path: 'README.md', dir: false },
    ])
  })

  it('lists a folder after its slash', () => {
    expect(findPaths(paths, 'src/')).toEqual([
      { path: 'src/lib', dir: true },
      { path: 'src/main.ts', dir: false },
    ])
  })

  it('ranks names before paths, shorter first', () => {
    expect(findPaths(paths, 'main').map((e) => e.path)).toEqual(['src/main.ts', 'docs/Main Notes.md', 'src/lib/main-utils.ts'])
    expect(findPaths(paths, 'src/m').map((e) => e.path)).toEqual(['src/main.ts'])
  })
})

describe('applySuggestion', () => {
  it('puts a command with a space in place of the trigger', () => {
    const text = '/rev'
    const trigger = triggerAt(text, 4, 'claude')!
    expect(applySuggestion(text, trigger, { type: 'command', option: cmd('review') })).toEqual({ text: '/review ', cursor: 8 })
  })

  it('inserts the full name of an MCP prompt', () => {
    const option: CommandOption = { name: 'rea:inv', kind: 'mcp', insert: '/rea:inv (MCP)' }
    expect(suggestionText({ type: 'command', option })).toBe('/rea:inv (MCP) ')
  })

  it('keeps a folder open and quotes paths with spaces', () => {
    expect(suggestionText({ type: 'file', path: 'src', dir: true })).toBe('@src/')
    expect(suggestionText({ type: 'file', path: 'My Docs', dir: true })).toBe('@"My Docs/')
    expect(suggestionText({ type: 'file', path: 'My Docs/a.md', dir: false })).toBe('@"My Docs/a.md" ')
  })

  it('does not double a following space', () => {
    const text = 'lies @ma bitte'
    const trigger = triggerAt(text, 8, 'claude')!
    expect(applySuggestion(text, trigger, { type: 'file', path: 'src/main.ts', dir: false })).toEqual({ text: 'lies @src/main.ts bitte', cursor: 18 })
  })

  it('replaces a quoted path whole', () => {
    const text = 'lies @"My Docs/a" bitte'
    const trigger = triggerAt(text, 10, 'claude')!
    expect(applySuggestion(text, trigger, { type: 'file', path: 'My Docs/a.md', dir: false }).text).toBe('lies @"My Docs/a.md" bitte')
  })
})
