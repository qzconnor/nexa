import { describe, expect, it } from 'vitest'
import type { SessionRuntime } from '@shared/chat'
import type { SessionMeta } from '@shared/types'
import { chatCounts, groupState, isLive } from './chat-state'

describe('isLive', () => {
  it('counts a chat whose CLI is up, also while it waits for the next prompt', () => {
    expect(isLive({ status: 'idle', connected: true })).toBe(true)
    expect(isLive({ status: 'running', connected: true })).toBe(true)
  })

  it('counts one that starts or works before its process says it is up', () => {
    expect(isLive({ status: 'starting', connected: false })).toBe(true)
    expect(isLive({ status: 'waiting', connected: false })).toBe(true)
  })

  it('leaves out what never started, ended or failed', () => {
    expect(isLive({ status: 'idle', connected: false })).toBe(false)
    expect(isLive({ status: 'stopped', connected: false })).toBe(false)
    expect(isLive({ status: 'error', connected: false, error: 'Der Prozess endete.' })).toBe(false)
  })
})

describe('chatCounts', () => {
  const chat = (id: string) => ({ id }) as SessionMeta
  const runtimes: Record<string, SessionRuntime> = {
    a: { status: 'running', connected: true },
    b: { status: 'idle', connected: true },
    c: { status: 'stopped', connected: false },
  }
  const runtime = (id: string): SessionRuntime => runtimes[id] ?? { status: 'idle', connected: false }

  it('counts every chat and those that run, idle ones whose CLI is up too', () => {
    expect(chatCounts([chat('a'), chat('b'), chat('c'), chat('d')], runtime)).toEqual({ all: 4, live: 2 })
  })

  it('is zero without chats', () => {
    expect(chatCounts([], runtime)).toEqual({ all: 0, live: 0 })
  })
})

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
