import { describe, expect, it } from 'vitest'
import { groupState } from './chat-state'

describe('groupState', () => {
  it('is empty without anything going on', () => {
    expect(groupState([])).toEqual({ running: false, signal: null })
    expect(groupState([null, null])).toEqual({ running: false, signal: null })
  })

  it('shows that one works and what another finished, both at once', () => {
    expect(groupState(['running', null])).toEqual({ running: true, signal: null })
    expect(groupState(['running', 'unread'])).toEqual({ running: true, signal: 'unread' })
  })

  it('takes the most urgent signal: a question before a failure before something new', () => {
    expect(groupState(['unread', 'error'])).toEqual({ running: false, signal: 'error' })
    expect(groupState(['unread', 'waiting', 'error'])).toEqual({ running: false, signal: 'waiting' })
    expect(groupState(['unread', null, 'unread'])).toEqual({ running: false, signal: 'unread' })
  })
})
