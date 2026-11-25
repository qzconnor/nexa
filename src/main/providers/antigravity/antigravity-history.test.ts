import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { USER_STEP, type AntigravityStep } from './antigravity-conversations'
import { promptOf, stampHistory } from './antigravity-history'

const user = (id: string, text: string): ChatItem => ({ kind: 'user', id, ts: 0, provider: 'antigravity', text })
const answer = (id: string, text: string): ChatItem => ({ kind: 'assistant', id, ts: 0, provider: 'antigravity', parentId: null, text })
const turn = (id: string): ChatItem => ({ kind: 'turn', id, ts: 0, provider: 'antigravity', status: 'done' })
const tool = (id: string): ChatItem => ({ kind: 'tool', id, ts: 0, provider: 'antigravity', parentId: null, tool: 'bash', name: 'run_command', title: 'Befehl ausführen', status: 'done', startedAt: 5, endedAt: 9 })

/** As `replay` gives a conversation of two prompts. */
const ITEMS = [user('u1', 'Test'), answer('a1', 'Hallo'), turn('t1'), user('u2', 'Führe echo aus'), tool('c2'), answer('a2', 'Erledigt'), turn('t2')]
const STEPS: AntigravityStep[] = [
  { type: USER_STEP, at: 1000 },
  { type: 15, at: 1500 },
  { type: USER_STEP, at: 5000 },
  { type: 132, at: 5200 },
  { type: 15, at: 6000 },
]

describe('stampHistory', () => {
  it('gives a prompt its step’s time, what follows the next milliseconds and a turn’s end its last step’s', () => {
    const stamped = stampHistory(ITEMS, STEPS)
    expect(stamped.map((i) => [i.id, i.ts])).toEqual([
      ['u1', 1000],
      ['a1', 1001],
      ['t1', 1500],
      ['u2', 5000],
      ['c2', 5001],
      ['a2', 5002],
      ['t2', 6000],
    ])
    // No durations from a replay.
    expect(stamped[4]).toMatchObject({ startedAt: 5001, endedAt: 5001 })
  })

  it('takes only the turns of prompts made after `since`', () => {
    expect(stampHistory(ITEMS, STEPS, 1500).map((i) => i.id)).toEqual(['u2', 'c2', 'a2', 't2'])
    expect(stampHistory(ITEMS, STEPS, 6000)).toEqual([])
  })

  it('counts back from the last step when the prompts and their steps don’t match, and takes nothing since then', () => {
    const steps = STEPS.slice(0, 2)
    const stamped = stampHistory(ITEMS, steps)
    expect(stamped.map((i) => i.ts)).toEqual([1493, 1494, 1495, 1496, 1497, 1498, 1499])
    expect(stampHistory(ITEMS, steps, 0)).toEqual([])
  })

  it('shows a prompt without the blocks Nexa put before it, and a handoff’s context as one', () => {
    const items = [user('u1', '<nexa-instructions>\nSei nett.\n</nexa-instructions>\n\nHallo'), turn('t1'), user('u2', '<nexa-context>\nVorher: Codex.\n</nexa-context>'), turn('t2')]
    const stamped = stampHistory(items, [STEPS[0]!, STEPS[2]!])
    expect(stamped[0]).toMatchObject({ kind: 'user', text: 'Hallo' })
    expect(stamped[2]).toMatchObject({ kind: 'user', handoff: true, text: '<nexa-context>\nVorher: Codex.\n</nexa-context>' })
  })
})

describe('promptOf', () => {
  it('leaves a prompt of the user’s own as it is', () => {
    expect(promptOf('Wie geht’s?')).toEqual({ text: 'Wie geht’s?' })
  })

  it('takes the text after Nexa’s context', () => {
    expect(promptOf('<nexa-context>\nx\n</nexa-context>\n\nWeiter so')).toEqual({ text: 'Weiter so' })
  })
})
