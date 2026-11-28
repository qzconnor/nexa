import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/defaults'
import { NEXA_TOOLS, nexaToolCategory } from '@shared/nexa-tools'
import type { ToolSettings } from '@shared/types'
import type { BrowserControl } from '../browser/browser-control'
import { BrowserTools, SENSITIVE_BROWSER_TOOLS } from '../browser/browser-tools'
import { ASK_TOOL_DEF } from './ask-tool'
import { CHAT_TOOL_NAMES, type ChatTools } from './chat-tools'
import { LIMITS_TOOL_DEF } from './limits-tool'
import { grantFor, nexaServerSpec } from './nexa-tools'
import { NOTIFY_TOOL_DEF } from './notify-tool'
import { RENDER_TOOL_DEFS } from './render-tools'

// Listing the tools doesn't touch the browser.
const browser = new BrowserTools({} as BrowserControl)
const chats = { call: async () => ({ content: [] }) } as unknown as ChatTools
const tools = (patch: Partial<ToolSettings>): ToolSettings => ({ ...defaultSettings().tools, ...patch })
const caller = { sessionId: 'chat-1' }
const signal = new AbortController().signal

describe('the catalog of the settings (shared/nexa-tools.ts)', () => {
  it('has every tool the server offers, in its category, and no other', () => {
    const server = {
      render: RENDER_TOOL_DEFS.map((tool) => tool.name),
      browser: browser.list().map((tool) => tool.name),
      chat: CHAT_TOOL_NAMES,
      app: [LIMITS_TOOL_DEF.name, ASK_TOOL_DEF.name, NOTIFY_TOOL_DEF.name],
    }
    for (const [category, names] of Object.entries(server)) {
      for (const name of names) expect(nexaToolCategory(name)?.id, name).toBe(category)
    }
    expect(NEXA_TOOLS.map((tool) => tool.name).sort()).toEqual(Object.values(server).flat().sort())
  })

  it('marks the browser tools that ask first', () => {
    expect(NEXA_TOOLS.filter((tool) => tool.asks).map((tool) => tool.name).sort()).toEqual([...SENSITIVE_BROWSER_TOOLS].sort())
  })
})

describe('nexaServerSpec', () => {
  it('leaves out the tools switched off one by one, and tells the agent', () => {
    const spec = nexaServerSpec(caller, tools({ chatTools: true, disabled: ['browser_evaluate', 'render_table', 'chat_send'] }), browser, chats, null)
    const names = spec.tools.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['render_chart', 'browser_click', 'chat_list']))
    for (const name of ['browser_evaluate', 'render_table', 'chat_send']) {
      expect(names).not.toContain(name)
      expect(spec.instructions).toContain(name)
    }
  })

  it('offers a category only while one of its tools is on', () => {
    const render = RENDER_TOOL_DEFS.map((tool) => tool.name)
    const spec = nexaServerSpec(caller, tools({ disabled: render }), browser, null, null)
    expect(spec.tools.some((tool) => tool.name.startsWith('render_'))).toBe(false)
    expect(spec.instructions).not.toMatch(/render_chart/)
  })

  it('leaves out the app’s own tools switched off', () => {
    const ask = { call: async () => ({ content: [] }) } as never
    const on = nexaServerSpec(caller, tools({}), browser, null, null, ask).tools.map((tool) => tool.name)
    const off = nexaServerSpec(caller, tools({ disabled: ['ask_user'] }), browser, null, null, ask).tools.map((tool) => tool.name)
    expect(on).toContain('ask_user')
    expect(off).not.toContain('ask_user')
  })

  it('refuses a call of a tool switched off since the CLI listed it', async () => {
    await expect(nexaServerSpec(caller, tools({ disabled: ['render_chart'] }), browser, null, null).callTool('render_chart', {}, signal)).rejects.toThrow(
      /turned render_chart off/,
    )
    await expect(nexaServerSpec(caller, tools({ renderTools: false }), browser, null, null).callTool('render_chart', {}, signal)).rejects.toThrow(
      /draw in the chat off/,
    )
    await expect(nexaServerSpec(caller, tools({ browserTools: false }), browser, null, null).callTool('browser_click', {}, signal)).rejects.toThrow(
      /browser off/,
    )
  })
})

describe('grantFor', () => {
  it('grants no tool switched off one by one', () => {
    const grant = grantFor(tools({ disabled: ['browser_click', 'browser_evaluate', 'limits'] }), browser)
    expect(grant.allowed).toContain('browser_navigate')
    expect(grant.allowed).not.toContain('browser_click')
    expect(grant.allowed).not.toContain('limits')
    expect(grant.ask).not.toContain('browser_evaluate')
    expect(grant.ask).toContain('browser_storage')
  })
})
