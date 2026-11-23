import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { pendingSteers } from './steer'

const user = (id: string, steer = false): ChatItem => ({ kind: 'user', id, ts: 0, provider: 'claude', text: id, ...(steer ? { steer: true } : {}) })
const turn = (id: string, parentId: string | null = null): ChatItem => ({ kind: 'turn', id, ts: 0, provider: 'claude', parentId, status: 'done' })
const answer = (id: string): ChatItem => ({ kind: 'assistant', id, ts: 0, provider: 'claude', parentId: null, text: 'ok', streaming: false })

describe('pendingSteers', () => {
  it('marks a prompt sent into the running turn', () => {
    expect([...pendingSteers([user('a'), answer('x'), user('b', true), answer('y')], true)]).toEqual(['b'])
  })

  it('lets it go once the turn it cut into ended', () => {
    expect(pendingSteers([user('a'), user('b', true), answer('y'), turn('t')], true).size).toBe(0)
  })

  it('keeps it while a subagent’s turn ends', () => {
    expect([...pendingSteers([user('a'), user('b', true), turn('t', 'agent')], true)]).toEqual(['b'])
  })

  it('marks nothing when the chat rests', () => {
    expect(pendingSteers([user('a'), user('b', true)], false).size).toBe(0)
  })
})
