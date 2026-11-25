import { describe, expect, it } from 'vitest'
import { claudeMcpServers, claudeToolUis, codexMcpServers, codexToolUis } from './mcp-servers'

describe('claudeToolUis', () => {
  it('keys the servers as tool names do and reads each tool’s page', () => {
    const map = claudeToolUis({
      mcpServers: [
        { name: 'nexa', tools: [{ name: 'render_chart' }] },
        {
          name: 'my.weather',
          tools: [
            { name: 'show', _meta: { ui: { resourceUri: 'ui://weather/view' } } },
            { name: 'refresh', _meta: { ui: { resourceUri: 'ui://weather/view', visibility: ['app'] } } },
            { name: 'plain' },
          ],
        },
      ],
    })
    expect([...map.keys()]).toEqual(['my_weather'])
    const weather = map.get('my_weather')!
    expect(weather.server).toBe('my.weather')
    expect(weather.tools.get('show')).toEqual({ resourceUri: 'ui://weather/view', visibility: ['model', 'app'] })
    expect(weather.tools.get('refresh')?.visibility).toEqual(['app'])
    expect(weather.tools.get('plain')).toEqual({ resourceUri: null, visibility: ['model', 'app'] })
  })
})

describe('codexToolUis', () => {
  it('reads the tool map of mcpServerStatus/list by the server’s own name', () => {
    const map = codexToolUis({
      data: [{ name: 'my.weather', tools: { show: { name: 'show', _meta: { ui: { resourceUri: 'ui://weather/view', visibility: ['model'] } } } } }],
    })
    expect(map.get('my.weather')?.tools.get('show')).toEqual({ resourceUri: 'ui://weather/view', visibility: ['model'] })
    expect(codexToolUis(null).size).toBe(0)
  })
})

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
