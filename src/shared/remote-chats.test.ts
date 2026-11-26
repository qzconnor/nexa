import { describe, expect, it } from 'vitest'
import { METHOD_LEVEL, parseRemoteRequest } from './remote'
import { MAX_REMOTE_MESSAGE, MAX_REMOTE_READ, parseChatResult, parseRemoteChatId, remoteChatId } from './remote-chats'

const from = { sessionId: 'c-1', title: 'Hier', provider: 'claude' }

describe('chats.* requests', () => {
  it('needs the level to read for looking and the level to prompt for writing', () => {
    expect(METHOD_LEVEL['chats.list']).toBe('read')
    expect(METHOD_LEVEL['chats.read']).toBe('read')
    expect(METHOD_LEVEL['chats.search']).toBe('read')
    expect(METHOD_LEVEL['chats.send']).toBe('prompt')
    expect(METHOD_LEVEL['chats.new']).toBe('prompt')
  })

  it('takes them through the same door as the other requests, their parameters checked', () => {
    expect(parseRemoteRequest({ m: 'chats.list', p: { extra: 1 } })).toEqual({ m: 'chats.list', p: {} })
    expect(parseRemoteRequest({ m: 'chats.read', p: { id: 'c1', last: 500 } })).toEqual({ m: 'chats.read', p: { id: 'c1', last: MAX_REMOTE_READ } })
    expect(parseRemoteRequest({ m: 'chats.search', p: { query: ' plan ', project: '' } })).toEqual({ m: 'chats.search', p: { query: 'plan' } })
    expect(parseRemoteRequest({ m: 'chats.send', p: { from, chain: 3, to: 'c2', text: ' Bitte prüfen. ' } })).toEqual({
      m: 'chats.send',
      p: { from, chain: 3, to: 'c2', text: 'Bitte prüfen.' },
    })
    expect(parseRemoteRequest({ m: 'chats.new', p: { from, chain: 1, provider: 'codex', text: 'Review', title: ' ', project: 'nexa', near: 'nexa' } })).toEqual({
      m: 'chats.new',
      p: { from, chain: 1, provider: 'codex', text: 'Review', project: 'nexa', near: 'nexa' },
    })
  })

  it('refuses what is broken or more than a message may be', () => {
    const bad = [
      { m: 'chats.read', p: { id: 'c1' } },
      { m: 'chats.read', p: { id: '../c1', last: 3 } },
      { m: 'chats.read', p: { id: 'c1', last: 0 } },
      { m: 'chats.search', p: { query: '   ' } },
      { m: 'chats.search', p: { query: 'x'.repeat(501) } },
      { m: 'chats.send', p: { from, to: 'c2', text: 'ohne Kette' } },
      { m: 'chats.send', p: { from, chain: 0, to: 'c2', text: 'x' } },
      { m: 'chats.send', p: { from, chain: 1.5, to: 'c2', text: 'x' } },
      { m: 'chats.send', p: { from, chain: 1, to: 'c2', text: '' } },
      { m: 'chats.send', p: { from, chain: 1, to: 'c2', text: 'x'.repeat(MAX_REMOTE_MESSAGE + 1) } },
      { m: 'chats.send', p: { from: { ...from, provider: 'aider' }, chain: 1, to: 'c2', text: 'x' } },
      { m: 'chats.send', p: { from: { ...from, sessionId: 'a b' }, chain: 1, to: 'c2', text: 'x' } },
      { m: 'chats.new', p: { from, chain: 1, provider: 'aider', text: 'x' } },
      { m: 'chats.new', p: { from, chain: 1, provider: 'codex', text: 'x', title: 42 } },
      { m: 'chats.remove', p: { id: 'c1' } },
    ]
    for (const request of bad) expect(parseRemoteRequest(request), JSON.stringify(request)).toBeNull()
  })

  it('takes the sending chat’s title as one line', () => {
    const request = parseRemoteRequest({ m: 'chats.send', p: { from: { ...from, title: 'Zwei\nZeilen' }, chain: 1, to: 'c2', text: 'x' } })
    expect(request).toMatchObject({ p: { from: { title: 'Zwei Zeilen' } } })
  })
})

describe('ids of other devices’ chats', () => {
  it('names device and chat apart from any id of this device', () => {
    const id = remoteChatId('inst1xxxxxxxxxxxxxxxxx', '6f1c2d3e-aaaa-bbbb-cccc-1234567890ab')
    expect(parseRemoteChatId(id)).toEqual({ device: 'inst1xxxxxxxxxxxxxxxxx', session: '6f1c2d3e-aaaa-bbbb-cccc-1234567890ab' })
    expect(parseRemoteChatId(` ${id} `)).not.toBeNull()
    expect(parseRemoteChatId('6f1c2d3e-aaaa-bbbb-cccc-1234567890ab')).toBeNull()
    expect(parseRemoteChatId('Review: Server')).toBeNull()
    expect(parseRemoteChatId('a:b:c')).toBeNull()
  })
})

describe('answers to chats.*', () => {
  const chat = { id: 'c1', title: 'Server-Umbau', provider: 'claude', projectId: 'p1', project: 'nexa', folder: 'F:\\nexa', status: 'running', updatedAt: 5, archived: false }

  it('keeps the chats that are whole and drops the rest', () => {
    const list = parseChatResult['chats.list']({ chats: [chat, { id: 'x' }, null, { ...chat, id: 'c2', status: 'weird', updatedAt: 'gestern' }] })
    expect(list?.chats.map((c) => [c.id, c.status, c.updatedAt])).toEqual([
      ['c1', 'running', 5],
      ['c2', 'idle', 0],
    ])
    expect(parseChatResult['chats.list']({})).toBeNull()
  })

  it('checks the other answers', () => {
    expect(parseChatResult['chats.read']({ chat, transcript: 'User: Hallo' })).toMatchObject({ chat: { id: 'c1' }, transcript: 'User: Hallo' })
    expect(parseChatResult['chats.read']({ chat })).toBeNull()
    expect(parseChatResult['chats.send']({ chat })).toMatchObject({ chat: { title: 'Server-Umbau' } })
    expect(parseChatResult['chats.new']({ id: 'n1', title: 'Neu', project: 'nexa' })).toEqual({ id: 'n1', title: 'Neu', project: 'nexa' })
    expect(parseChatResult['chats.new']({ id: 'n 1', title: 'Neu' })).toBeNull()
    const found = parseChatResult['chats.search']({ found: [{ chat, hit: { sessionId: 'c1', role: 'user', provider: 'codex', snippet: '…Plan…' } }, { chat: {} }], total: 7 })
    expect(found).toEqual({ found: [{ chat: expect.objectContaining({ id: 'c1' }), hit: { sessionId: 'c1', role: 'user', provider: 'codex', snippet: '…Plan…' } }], total: 7 })
  })
})
