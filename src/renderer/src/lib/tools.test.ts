import { describe, expect, it } from 'vitest'
import type { ToolItem } from '@shared/chat'
import { nexaToolView, toolSummary } from './tools'

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
})

describe('toolSummary', () => {
  it('doesn’t count Claude loading Nexa’s tools', () => {
    expect(toolSummary([loads('select:mcp__nexa__render_chart'), tool({ tool: 'bash' })])).toBe('1 Befehl')
  })
})
