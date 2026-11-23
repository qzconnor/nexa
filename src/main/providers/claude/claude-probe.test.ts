import { describe, expect, it } from 'vitest'
import { claudeCommands } from './claude-probe'

describe('claudeCommands', () => {
  it('maps commands and MCP prompts', () => {
    expect(
      claudeCommands([
        { name: 'review', description: 'Review a pull request', argumentHint: '<pr>', aliases: ['rv'] },
        { name: 'rea:investigate_feature (MCP)', description: 'Trace a feature' },
      ]),
    ).toEqual([
      { name: 'review', description: 'Review a pull request', argumentHint: '<pr>', aliases: ['rv'], kind: 'command', insert: '/review' },
      { name: 'rea:investigate_feature', description: 'Trace a feature', argumentHint: undefined, aliases: undefined, kind: 'mcp', insert: '/rea:investigate_feature (MCP)' },
    ])
  })

  it('leaves out what only the terminal or Nexa itself does', () => {
    const names = claudeCommands([{ name: 'clear' }, { name: 'model' }, { name: '__internal' }, { name: '' }, { name: 'compact' }, 'junk'])?.map((c) => c.name)
    expect(names).toEqual(['compact'])
  })

  it('is null without a list', () => {
    expect(claudeCommands(undefined)).toBeNull()
  })
})
