import { describe, expect, it } from 'vitest'
import { claudeCommands, claudeModels } from './claude-probe'

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

describe('claudeModels', () => {
  const opus = { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'For complex work', supportedEffortLevels: ['low', 'high'] }

  it('names the default after the model it stands for', () => {
    const models = claudeModels([
      { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Best for everyday, complex tasks', supportedEffortLevels: ['low', 'high'] },
      opus,
    ])
    expect(models).toEqual([
      { id: '', label: 'Standard (Opus 5.5)', description: 'Best for everyday, complex tasks', efforts: ['low', 'high'], isDefault: true },
      { id: 'opus', label: 'Opus 5.5', description: 'For complex work', efforts: ['low', 'high'] },
    ])
  })

  it('takes the name from the description when no model in the list is the same', () => {
    const [model] = claudeModels([{ value: 'default', resolvedModel: 'claude-x', displayName: 'Default', description: 'Sonnet 9 · Fast' }])!
    expect(model).toMatchObject({ label: 'Standard (Sonnet 9)', description: 'Fast' })
  })

  it('stays „Standard“ when nothing names the model', () => {
    const [model] = claudeModels([{ value: 'default', displayName: 'Default (recommended)', description: 'The model from your settings' }])!
    expect(model).toMatchObject({ id: '', label: 'Standard', description: 'The model from your settings' })
  })
})
