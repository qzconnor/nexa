import { describe, expect, it } from 'vitest'
import { contextDetailOf } from './claude-context'

// Shape of Claude Code 2.1.330's answer to `get_context_usage { detail: 'summary' }`.
const answer = {
  categories: [
    { id: 'system_prompt', name: 'System prompt', tokens: 2675, color: 'promptBorder', kind: 'used' },
    { id: 'mcp_tools', name: 'MCP tools', tokens: 589, kind: 'used' },
    { id: 'mcp_tools_deferred', name: 'MCP tools (deferred)', tokens: 169452, isDeferred: true, kind: 'deferred' },
    { id: 'something_new', name: 'Something new', tokens: 10, kind: 'used' },
    { id: 'autocompact_buffer', name: 'Autocompact buffer', tokens: 33000, kind: 'buffer' },
    { id: 'free_space', name: 'Free space', tokens: 336506, kind: 'free' },
  ],
  totalTokens: 30494,
  maxTokens: 400000,
  rawMaxTokens: 400000,
  gridRows: [[]],
  mcpTools: [
    { name: 'mcp__a__one', serverName: 'a', tokens: 100, isLoaded: false },
    { name: 'mcp__b__one', serverName: 'b', tokens: 500, isLoaded: true },
    { name: 'mcp__a__two', serverName: 'a', tokens: 300, isLoaded: true },
  ],
  agents: [],
  memoryFiles: [{ path: 'C:\\p\\CLAUDE.md', type: 'Project', tokens: 8306 }],
  autoCompactThreshold: 367000,
  isAutoCompactEnabled: true,
}

describe('contextDetailOf', () => {
  it('takes the total, the window and the parts with German names', () => {
    const detail = contextDetailOf(answer, 1)!
    expect(detail.used).toBe(30494)
    expect(detail.window).toBe(400000)
    expect(detail.compactAt).toBe(367000)
    expect(detail.parts.map((p) => [p.id, p.name, p.kind])).toEqual([
      ['system_prompt', 'Systemprompt', 'used'],
      ['mcp_tools', 'MCP-Werkzeuge', 'used'],
      ['mcp_tools_deferred', 'MCP-Werkzeuge (bei Bedarf)', 'deferred'],
      ['something_new', 'Something new', 'used'],
      ['autocompact_buffer', 'Puffer fürs Zusammenfassen', 'buffer'],
      ['free_space', 'Frei', 'free'],
    ])
  })

  it('groups MCP tools by server, the biggest first', () => {
    const detail = contextDetailOf(answer)!
    expect(detail.mcpServers).toEqual([
      { name: 'b', tokens: 500, count: 1, loaded: 1 },
      { name: 'a', tokens: 400, count: 2, loaded: 1 },
    ])
    expect(detail.agents).toBeUndefined()
    expect(detail.memoryFiles).toEqual([{ name: 'C:\\p\\CLAUDE.md', tokens: 8306 }])
  })

  it('has no compaction point when auto-compact is off', () => {
    expect(contextDetailOf({ ...answer, isAutoCompactEnabled: false })!.compactAt).toBeUndefined()
  })

  it('is null without a total or window', () => {
    expect(contextDetailOf({ categories: [] })).toBeNull()
    expect(contextDetailOf(null)).toBeNull()
  })
})
