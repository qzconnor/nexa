import { describe, expect, it, vi } from 'vitest'
import { askResult, AskTool, formRequest } from './ask-tool'

describe('formRequest', () => {
  it('takes the fields with their kinds, options and fitting defaults', () => {
    expect(
      formRequest({
        title: ' Projekt anlegen ',
        description: 'Für das Gerüst',
        fields: [
          { key: 'name', label: 'Name', type: 'text', required: true, default: 'app' },
          { key: 'port', label: 'Port', type: 'number', default: '5173' },
          { key: 'ts', label: 'TypeScript', type: 'boolean', default: 'ja' },
          { key: 'ui', label: 'UI', type: 'select', options: ['Vue', 'React', 'Vue'], default: 'Svelte' },
          { key: 'extras', label: 'Extras', type: 'multiselect', options: ['Tests', 'Lint'], default: ['Lint', 'Docker'] },
        ],
        submitLabel: 'Anlegen',
      }),
    ).toEqual({
      type: 'form',
      title: 'Projekt anlegen',
      description: 'Für das Gerüst',
      fields: [
        { key: 'name', label: 'Name', type: 'text', default: 'app', required: true },
        { key: 'port', label: 'Port', type: 'number', default: 5173 },
        // A default that doesn't fit its field is dropped, not refused.
        { key: 'ts', label: 'TypeScript', type: 'boolean' },
        { key: 'ui', label: 'UI', type: 'select', options: ['Vue', 'React'] },
        { key: 'extras', label: 'Extras', type: 'multiselect', options: ['Tests', 'Lint'], default: ['Lint'] },
      ],
      submitLabel: 'Anlegen',
    })
  })

  it('refuses what makes no form, saying why', () => {
    expect(() => formRequest({ fields: [{ key: 'a', label: 'A', type: 'text' }] })).toThrow(/title/)
    expect(() => formRequest({ title: 'T', fields: [] })).toThrow(/at least one field/)
    expect(() => formRequest({ title: 'T', fields: [{ key: 'a', label: 'A', type: 'date' }] })).toThrow(/type/)
    expect(() => formRequest({ title: 'T', fields: [{ key: 'a', label: 'A', type: 'select' }] })).toThrow(/needs options/)
    expect(() =>
      formRequest({
        title: 'T',
        fields: [
          { key: 'a', label: 'A', type: 'text' },
          { key: 'a', label: 'B', type: 'text' },
        ],
      }),
    ).toThrow(/twice/)
  })
})

describe('askResult', () => {
  it('gives the values as JSON, a refusal in words, and an error when nobody answered', () => {
    const sent = askResult({ type: 'form', action: 'submit', values: { port: 3000 } }).content[0]
    expect(sent?.type === 'text' && JSON.parse(sent.text)).toEqual({ port: 3000 })
    expect(askResult({ type: 'form', action: 'decline' })).toMatchObject({ content: [{ text: expect.stringContaining('declined') }] })
    expect(askResult(null).isError).toBe(true)
  })
})

describe('AskTool', () => {
  it('asks in the calling chat and needs one', async () => {
    const ask = vi.fn(async () => ({ type: 'form' as const, action: 'submit' as const, values: { name: 'x' } }))
    const tool = new AskTool({ ask })
    const args = { title: 'T', fields: [{ key: 'name', label: 'Name', type: 'text' }] }
    expect((await tool.call('s1', args)).isError).toBeUndefined()
    expect(ask).toHaveBeenCalledWith('s1', expect.objectContaining({ type: 'form', title: 'T' }), undefined)
    expect((await tool.call(null, args)).isError).toBe(true)
    expect((await tool.call('s1', { title: 'T' })).isError).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })
})
