import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/defaults'
import type { ToolSettings } from '@shared/types'
import { claudeToolNames, codexToolApprovals, nexaToolGrant, nexaToolsOn } from './tool-grant'

const names = { render: ['render_chart', 'render_table'], browser: ['browser_navigate', 'browser_click', 'browser_evaluate', 'browser_storage'] }
const sensitive = new Set(['browser_evaluate', 'browser_storage'])
const tools = (patch: Partial<ToolSettings>): ToolSettings => ({ ...defaultSettings().tools, ...patch })

describe('nexaToolGrant', () => {
  it('allows the render tools and the browser tools that stay on the page', () => {
    expect(nexaToolGrant(tools({}), names, sensitive)).toEqual({
      allowed: ['render_chart', 'render_table', 'browser_navigate', 'browser_click'],
      ask: ['browser_evaluate', 'browser_storage'],
    })
  })

  it('leaves out what the settings turned off', () => {
    expect(nexaToolGrant(tools({ browserTools: false }), names, sensitive)).toEqual({ allowed: ['render_chart', 'render_table'], ask: [] })
    expect(nexaToolGrant(tools({ renderTools: false }), names, sensitive).allowed).toEqual(['browser_navigate', 'browser_click'])
  })

  it('starts the server only while one kind of tool is on', () => {
    expect(nexaToolsOn(tools({ renderTools: false, browserTools: false }))).toBe(false)
    expect(nexaToolsOn(tools({ renderTools: false }))).toBe(true)
    expect(nexaToolsOn(tools({ renderTools: false, browserTools: false, chatTools: true }))).toBe(true)
  })

  it('allows the chat tools only once the user switched them on', () => {
    const withChat = { ...names, chat: ['chat_list', 'chat_send'] }
    expect(nexaToolGrant(tools({ browserTools: false }), withChat, sensitive).allowed).toEqual(['render_chart', 'render_table'])
    expect(nexaToolGrant(tools({ browserTools: false, chatTools: true }), withChat, sensitive).allowed).toEqual([
      'render_chart',
      'render_table',
      'chat_list',
      'chat_send',
    ])
  })
})

describe('the CLIs’ names and approvals', () => {
  it('prefixes the tools for Claude Code', () => {
    expect(claudeToolNames(['browser_click'])).toEqual(['mcp__nexa__browser_click'])
  })

  it('lets Codex ask for the sensitive tools unless it has full permissions', () => {
    const grant = { allowed: ['browser_click'], ask: ['browser_evaluate'] }
    expect(codexToolApprovals(grant, 'edits')).toEqual({ browser_click: { approval_mode: 'approve' }, browser_evaluate: { approval_mode: 'prompt' } })
    expect(codexToolApprovals(grant, 'full')).toEqual({ browser_click: { approval_mode: 'approve' } })
  })
})
