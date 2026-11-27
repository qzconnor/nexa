import { describe, expect, it } from 'vitest'
import { MAX_PUSH_BODY, MAX_PUSH_TITLE, parsePushNotice, pushNotice } from './push'

describe('push notice', () => {
  it('cuts title and text to their limits, counting characters, not UTF-16 units', () => {
    const notice = pushNotice('done', 'chat-1', 'T'.repeat(200), '😀'.repeat(400))
    expect([...notice.title]).toHaveLength(MAX_PUSH_TITLE)
    expect(notice.title.endsWith('…')).toBe(true)
    expect([...notice.body]).toHaveLength(MAX_PUSH_BODY)
    expect(pushNotice('input', 'c', 'Claude hat eine Frage', 'Chat\nWelcher Weg?')).toEqual({
      v: 1,
      reason: 'input',
      chat: 'c',
      title: 'Claude hat eine Frage',
      body: 'Chat\nWelcher Weg?',
    })
  })

  it('reads back what it wrote and nothing else', () => {
    const notice = pushNotice('limit', 'abc_DEF-1', 'Limit erreicht', 'Chat\nReset um 19:40')
    expect(parsePushNotice(JSON.parse(JSON.stringify(notice)))).toEqual(notice)
    expect(parsePushNotice({ ...notice, v: 2 })).toBeNull()
    expect(parsePushNotice({ ...notice, reason: 'other' })).toBeNull()
    // The chat goes into the address the click opens.
    expect(parsePushNotice({ ...notice, chat: '../settings' })).toBeNull()
    expect(parsePushNotice({ ...notice, title: 3 })).toBeNull()
    expect(parsePushNotice(null)).toBeNull()
    expect(parsePushNotice([notice])).toBeNull()
  })
})
