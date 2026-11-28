import { describe, expect, it } from 'vitest'
import { defaultSettings } from './defaults'
import { NEXA_TOOLS, nexaCategoryOn, nexaToolLabel, nexaToolOn, withToolsSwitched } from './nexa-tools'
import type { ToolSettings } from './types'

const tools = (patch: Partial<ToolSettings>): ToolSettings => ({ ...defaultSettings().tools, ...patch })

describe('nexaToolOn', () => {
  it('needs its category on and itself not switched off', () => {
    expect(nexaToolOn(tools({}), 'browser_click')).toBe(true)
    expect(nexaToolOn(tools({ browserTools: false }), 'browser_click')).toBe(false)
    expect(nexaToolOn(tools({ disabled: ['browser_click'] }), 'browser_click')).toBe(false)
    expect(nexaToolOn(tools({}), 'chat_send')).toBe(false)
  })

  it('takes the app’s tools as on unless switched off themselves', () => {
    expect(nexaToolOn(tools({ renderTools: false, browserTools: false }), 'notify')).toBe(true)
    expect(nexaToolOn(tools({ disabled: ['notify'] }), 'notify')).toBe(false)
  })

  it('knows no tool outside the catalog', () => {
    expect(nexaToolOn(tools({}), 'Bash')).toBe(false)
  })
})

describe('nexaCategoryOn', () => {
  it('is off once every tool of the category is', () => {
    const render = NEXA_TOOLS.filter((tool) => tool.name.startsWith('render_')).map((tool) => tool.name)
    expect(nexaCategoryOn(tools({ disabled: render.slice(1) }), 'render')).toBe(true)
    expect(nexaCategoryOn(tools({ disabled: render }), 'render')).toBe(false)
  })
})

describe('withToolsSwitched', () => {
  it('switches tools on and off in the catalog’s order and keeps names it doesn’t know', () => {
    expect(withToolsSwitched(['browser_storage', 'future_tool'], ['render_chart', 'browser_click'], false)).toEqual([
      'render_chart',
      'browser_click',
      'browser_storage',
      'future_tool',
    ])
    expect(withToolsSwitched(['render_chart', 'browser_click'], ['render_chart'], true)).toEqual(['browser_click'])
  })
})

describe('nexaToolLabel', () => {
  it('names a tool in words, or by its name when it doesn’t know it', () => {
    expect(nexaToolLabel('browser_evaluate')).toBe('Skript ausführen')
    expect(nexaToolLabel('future_tool')).toBe('future_tool')
  })
})
