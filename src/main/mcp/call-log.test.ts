import { describe, expect, it } from 'vitest'
import { McpCallLog } from './call-log'

describe('McpCallLog', () => {
  it('hands out the calls of a tool in the order they came, each once', () => {
    const log = new McpCallLog()
    log.record('render_chart', { title: 'A' }, 0)
    log.record('browser_navigate', { url: 'http://x' }, 1)
    log.record('render_chart', { title: 'B' }, 2)
    expect(log.take('render_chart', 3)).toEqual({ title: 'A' })
    expect(log.take('render_chart', 3)).toEqual({ title: 'B' })
    expect(log.take('render_chart', 3)).toBeUndefined()
    expect(log.take('browser_navigate', 3)).toEqual({ url: 'http://x' })
  })

  it('forgets calls nobody picked up', () => {
    const log = new McpCallLog()
    log.record('render_chart', { title: 'alt' }, 0)
    expect(log.take('render_chart', 11 * 60_000)).toBeUndefined()
    for (let i = 0; i < 60; i++) log.record('render_table', { i }, 1000)
    expect(log.take('render_table', 1000)).toEqual({ i: 10 })
  })
})
