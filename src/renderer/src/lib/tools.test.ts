import { describe, expect, it } from 'vitest'
import type { ChatItem, ToolItem } from '@shared/chat'
import { chatBlocks, nexaToolView, toolSummary } from './tools'

const tool = (patch: Partial<ToolItem>): ToolItem => ({
  kind: 'tool',
  id: patch.name ?? 'x',
  ts: 0,
  provider: 'claude',
  tool: 'other',
  name: 'x',
  title: 'x',
  status: 'done',
  startedAt: 0,
  ...patch,
})

const loads = (query: string) => tool({ name: 'ToolSearch', tool: 'search', title: 'Werkzeuge laden', input: { query, max_results: 5 } })

describe('nexaToolView', () => {
  it('shows Claude loading Nexa’s tools as the app getting them ready, in words', () => {
    expect(nexaToolView(loads('select:mcp__nexa__render_diagram,mcp__nexa__render_chart,mcp__nexa__browser_click'))).toEqual({
      title: 'Nexa-Werkzeuge laden',
      detail: 'Diagramm, Chart, Klicken',
      plumbing: true,
    })
  })

  it('leaves loading other tools and searching for tools as they are', () => {
    expect(nexaToolView(loads('select:mcp__nexa__render_chart,mcp__github__create_issue'))).toBeNull()
    expect(nexaToolView(loads('nexa render'))).toBeNull()
    expect(nexaToolView(tool({ name: 'mcp__github__create_issue', server: 'github', tool: 'mcp' }))).toBeNull()
  })

  it('names Nexa’s tools as Claude and Codex call them', () => {
    expect(nexaToolView(tool({ name: 'mcp__nexa__render_table', server: 'nexa', tool: 'mcp', detail: 'x' }))).toEqual({ title: 'Tabelle', detail: 'x', plumbing: false })
    expect(nexaToolView(tool({ name: 'nexa.browser_navigate', server: 'nexa', tool: 'mcp' }))?.title).toBe('Seite öffnen')
    expect(nexaToolView(tool({ name: 'mcp__nexa__something_new', server: 'nexa', tool: 'mcp' }))?.title).toBe('something new')
  })

  it('names the chat a message goes to, by its title for an id', () => {
    const titleOf = (id: string) => (id === 'c1' ? 'Code-Review' : undefined)
    const send = (to: string) => tool({ name: 'nexa.chat_send', server: 'nexa', tool: 'mcp', input: { to, text: 'Hallo' } })
    expect(nexaToolView(send('c1'), titleOf)).toEqual({ title: 'Nachricht an Chat', detail: '„Code-Review“', plumbing: false })
    expect(nexaToolView(send('Review'), titleOf)?.detail).toBe('„Review“')
    const created = tool({ name: 'mcp__nexa__chat_new', server: 'nexa', tool: 'mcp', input: { cli: 'codex', text: 'x', title: 'Prüfen' } })
    expect(nexaToolView(created)).toEqual({ title: 'Neuer Chat', detail: 'Codex · „Prüfen“', plumbing: false })
  })
})

describe('toolSummary', () => {
  it('doesn’t count Claude loading Nexa’s tools', () => {
    expect(toolSummary([loads('select:mcp__nexa__render_chart'), tool({ tool: 'bash' })])).toBe('1 Befehl')
  })
})

describe('chatBlocks', () => {
  const thought = (id: string, text = id): ChatItem => ({ kind: 'thinking', id, ts: 0, provider: 'codex', text })
  const say = (id: string): ChatItem => ({ kind: 'assistant', id, ts: 0, provider: 'codex', text: id })
  const shape = (items: ChatItem[]) =>
    chatBlocks(items, null, true).map((b) => (b.type === 'thinking' ? b.items.map((i) => i.id) : b.type === 'item' ? b.item.id : b.tools.map((t) => t.id)))

  it('shows thoughts in a row as one block, with the calls between them in the group above', () => {
    const items = [thought('t1'), tool({ id: 'a' }), thought('t2'), tool({ id: 'b' }), thought('t3'), say('fertig'), thought('t4')]
    expect(shape(items)).toEqual([['t1'], ['a', 'b'], ['t2', 't3'], 'fertig', ['t4']])
  })

  it('leaves out empty thoughts and all of them when they are hidden', () => {
    expect(shape([thought('t1', ' '), thought('t2')])).toEqual([['t2']])
    expect(chatBlocks([thought('t1')], null, false)).toEqual([])
  })

  it('lets the user’s own commands stand alone, between the agent’s calls', () => {
    const items = [tool({ id: 'a' }), tool({ id: 'mine', byUser: true }), tool({ id: 'b' })]
    expect(shape(items)).toEqual([['a'], 'mine', ['b']])
  })
})
