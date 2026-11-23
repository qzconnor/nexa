import { describe, expect, it } from 'vitest'
import type { CommandOption, ModelOption } from '@shared/types'
import { appCommandOf, appCommandOptions, dirFromArg, matchEffort, matchModel, mergeCommands } from './chat-commands'

const cli = (name: string, extra: Partial<CommandOption> = {}): CommandOption => ({ name, kind: 'command', insert: `/${name}`, ...extra })

describe('appCommandOf', () => {
  it('finds a command by its name or alias, with what follows it', () => {
    expect(appCommandOf('/diff', 'claude')?.command.id).toBe('diff')
    expect(appCommandOf('/new', 'claude')?.command.id).toBe('clear')
    expect(appCommandOf('/branch Anderer Weg', 'claude')).toMatchObject({ command: { id: 'fork' }, args: 'Anderer Weg' })
    expect(appCommandOf('  /rename  Neuer Titel ', 'codex')).toMatchObject({ command: { id: 'rename' }, args: 'Neuer Titel' })
    expect(appCommandOf('/RENAME x', 'claude')?.command.id).toBe('rename')
  })

  it('keeps a multi-line argument', () => {
    expect(appCommandOf('/rename a\nb', 'claude')?.args).toBe('a\nb')
  })

  it("leaves the CLI's own commands and plain text alone", () => {
    expect(appCommandOf('/review', 'claude')).toBeNull()
    expect(appCommandOf('/diffs', 'claude')).toBeNull()
    expect(appCommandOf('zeig /diff', 'claude')).toBeNull()
    expect(appCommandOf('/', 'claude')).toBeNull()
  })

  it('leaves to Claude Code what it does well itself', () => {
    expect(appCommandOf('/compact', 'claude')).toBeNull()
    expect(appCommandOf('/compact', 'codex')?.command.id).toBe('compact')
    expect(appCommandOf('/usage', 'claude')).toBeNull()
    expect(appCommandOf('/cost', 'codex')?.command.id).toBe('usage')
  })
})

describe('mergeCommands', () => {
  it("puts Nexa's first and leaves out the CLI's of the same name or alias", () => {
    const app = appCommandOptions('claude')
    const merged = mergeCommands(app, [cli('clear'), cli('new'), cli('review'), cli('model'), cli('compact')])
    expect(merged.slice(0, app.length)).toEqual(app)
    expect(merged.slice(app.length).map((c) => c.name)).toEqual(['review', 'compact'])
  })

  it("keeps Codex's skills even when one is named like a command", () => {
    const merged = mergeCommands(appCommandOptions('codex'), [cli('diff', { kind: 'skill', insert: '$diff' })])
    expect(merged.at(-1)).toMatchObject({ name: 'diff', kind: 'skill' })
  })
})

describe('matchModel', () => {
  const models: ModelOption[] = [
    { id: '', label: 'Standard', isDefault: true },
    { id: 'opus', label: 'Opus 5.5' },
    { id: 'sonnet', label: 'Sonnet 5.5' },
    { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
  ]

  it('finds by id or label, exact or in part', () => {
    expect(matchModel(models, 'opus')?.id).toBe('opus')
    expect(matchModel(models, 'Sonnet 5.5')?.id).toBe('sonnet')
    expect(matchModel(models, 'haiku')?.id).toBe('claude-haiku-5-5')
    expect(matchModel(models, 'standard')?.id).toBe('')
  })

  it('finds nothing when several fit or none does', () => {
    expect(matchModel(models, '5.5')).toBeNull()
    expect(matchModel(models, 'gpt')).toBeNull()
    expect(matchModel(models, '')).toBeNull()
  })
})

describe('dirFromArg', () => {
  it('takes absolute folders as they are and others relative to the chat', () => {
    expect(dirFromArg('D:\\libs', 'F:\\app')).toBe('D:\\libs')
    expect(dirFromArg('"..\\shared lib"', 'F:\\app\\')).toBe('F:\\app\\..\\shared lib')
    expect(dirFromArg('/srv/x', '/home/a')).toBe('/srv/x')
    expect(dirFromArg('lib', '/home/a')).toBe('/home/a/lib')
  })

  it("puts the user's folder for ~", () => {
    expect(dirFromArg('~/code', 'F:\\app', 'C:\\Users\\me')).toBe('C:\\Users\\me/code')
    expect(dirFromArg('~', 'F:\\app', 'C:\\Users\\me')).toBe('C:\\Users\\me')
  })
})

describe('matchEffort', () => {
  const levels = ['low', 'medium', 'high', 'xhigh', 'max']

  it("finds a level by the CLI's name or Nexa's", () => {
    expect(matchEffort(levels, 'high')).toBe('high')
    expect(matchEffort(levels, 'Hoch')).toBe('high')
    expect(matchEffort(levels, 'sehr hoch')).toBe('xhigh')
    expect(matchEffort(levels, 'standard')).toBe('')
    expect(matchEffort(levels, 'ultra')).toBeNull()
  })
})
