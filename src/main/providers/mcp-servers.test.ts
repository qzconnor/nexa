import { describe, expect, it } from 'vitest'
import { claudeMcpServers, codexMcpServers } from './mcp-servers'

describe('claudeMcpServers', () => {
  it('lists the servers of mcp_status without Nexa’s own', () => {
    const raw = {
      mcpServers: [
        { name: 'nexa', status: 'connected', scope: 'dynamic', tools: [{ name: 'render_chart' }] },
        { name: 'rea', status: 'connected', scope: 'user', source: 'user', tools: [{ name: 'a' }, { name: 'b' }] },
        { name: 'claude.ai Gmail', status: 'needs-auth', scope: 'claudeai' },
        { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
        { name: 'odd', status: 'something' },
      ],
    }
    expect(claudeMcpServers(raw)).toEqual([
      { name: 'rea', status: 'connected', scope: 'user', tools: 2, error: undefined },
      { name: 'claude.ai Gmail', status: 'needs-auth', scope: 'claudeai', tools: undefined, error: undefined },
      { name: 'broken', status: 'failed', scope: undefined, tools: undefined, error: 'spawn ENOENT' },
      { name: 'odd', status: 'pending', scope: undefined, tools: undefined, error: undefined },
    ])
  })

  it('is empty for anything else', () => {
    expect(claudeMcpServers(null)).toEqual([])
    expect(claudeMcpServers({ mcpServers: 'x' })).toEqual([])
  })
})

describe('codexMcpServers', () => {
  it('counts the tools of each server and leaves out the built-in ones', () => {
    const raw = {
      data: [
        { name: 'codex_apps', runtimeStatus: null, tools: { a: {} } },
        { name: 'nexa', tools: {} },
        { name: 'docs', runtimeStatus: null, tools: { search: {}, read: {} } },
        { name: 'cold', runtimeStatus: null },
      ],
    }
    expect(codexMcpServers(raw)).toEqual([
      { name: 'docs', status: 'connected', tools: 2 },
      { name: 'cold', status: 'pending', tools: undefined },
    ])
  })
})
