import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { runErrorToShow } from './run-error'

const base = { ts: 0, provider: 'claude' as const }
const user: ChatItem = { ...base, id: 'u', kind: 'user', text: 'test' }
const failed = (error: string): ChatItem => ({ ...base, id: 't', kind: 'turn', status: 'error', error })

describe('runErrorToShow', () => {
  const missing = 'No conversation found with session ID: 5479bf82'

  it('leaves out what the failed turn shows already', () => {
    expect(runErrorToShow([user, failed(missing)], missing)).toBeNull()
    expect(runErrorToShow([user, failed(missing)], `${missing}\n`)).toBeNull()
  })

  it('leaves out what the notice of a crash shows', () => {
    const notice: ChatItem = { ...base, id: 'n', kind: 'notice', level: 'error', text: 'Claude Code wurde unerwartet beendet', detail: 'boom' }
    expect(runErrorToShow([user, notice], 'boom')).toBeNull()
  })

  it('shows an error the chat doesn’t show, also when an older turn had it', () => {
    expect(runErrorToShow([user, failed('other')], missing)).toBe(missing)
    expect(runErrorToShow([user, failed(missing), user], missing)).toBe(missing)
    expect(runErrorToShow([], undefined)).toBeNull()
  })
})
