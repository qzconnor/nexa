import { describe, expect, it } from 'vitest'
import type { ChatItem } from './chat'
import {
  levelAllows,
  pageOf,
  parseInteractionResponse,
  parseRemoteChatId,
  parseRemoteEvents,
  parseRemoteRequest,
  parseRemoteResponse,
  remoteChatId,
  remoteErrorText,
  REMOTE_BATCH_BYTES,
  REMOTE_TEXT_LIMIT,
  slimItem,
} from './remote'

const user = (id: string, text = 'Hallo'): ChatItem => ({ kind: 'user', id, ts: 1, provider: 'claude', text })

describe('levels', () => {
  it('include the ones below them', () => {
    expect(levelAllows('full', 'prompt')).toBe(true)
    expect(levelAllows('prompt', 'read')).toBe(true)
    expect(levelAllows('read', 'prompt')).toBe(false)
    expect(levelAllows('off', 'read')).toBe(false)
  })
})

describe('parseRemoteRequest', () => {
  it('takes the requests with their parameters', () => {
    expect(parseRemoteRequest({ m: 'hello' })).toEqual({ m: 'hello', p: {} })
    expect(parseRemoteRequest({ m: 'open', p: { id: 'abc', before: 40 } })).toEqual({ m: 'open', p: { id: 'abc', before: 40 } })
    expect(parseRemoteRequest({ m: 'watch', p: { ids: ['a', 'a', 'b'] } })).toEqual({ m: 'watch', p: { ids: ['a', 'b'] } })
    expect(parseRemoteRequest({ m: 'send', p: { id: 'abc', text: 'Los' } })).toEqual({ m: 'send', p: { id: 'abc', text: 'Los' } })
  })

  it('refuses what isn’t one', () => {
    expect(parseRemoteRequest(null)).toBeNull()
    expect(parseRemoteRequest({ m: 'delete', p: { id: 'abc' } })).toBeNull()
    expect(parseRemoteRequest({ m: 'open', p: { id: '../x' } })).toBeNull()
    expect(parseRemoteRequest({ m: 'open', p: { id: 'abc', before: -1 } })).toBeNull()
    expect(parseRemoteRequest({ m: 'send', p: { id: 'abc', text: '   ' } })).toBeNull()
    expect(parseRemoteRequest({ m: 'watch', p: { ids: Array.from({ length: 33 }, (_, i) => `c${i}`) } })).toBeNull()
  })

  it('takes answers to the agent’s questions, item ids of the CLIs included', () => {
    const request = parseRemoteRequest({ m: 'respond', p: { id: 'abc', itemId: 'ask:1b2c-3d', response: { type: 'permission', decision: 'allow' } } })
    expect(request).toEqual({ m: 'respond', p: { id: 'abc', itemId: 'ask:1b2c-3d', response: { type: 'permission', decision: 'allow' } } })
    expect(parseRemoteRequest({ m: 'respond', p: { id: 'abc', itemId: 'x', response: { type: 'permission', decision: 'sure' } } })).toBeNull()
  })
})

describe('parseInteractionResponse', () => {
  it('checks each shape', () => {
    expect(parseInteractionResponse({ type: 'question', answers: { Farbe: ['Blau'] } })).toEqual({ type: 'question', answers: { Farbe: ['Blau'] } })
    expect(parseInteractionResponse({ type: 'question', answers: { Farbe: 'Blau' } })).toBeNull()
    expect(parseInteractionResponse({ type: 'plan', approve: true, mode: 'auto' })).toMatchObject({ approve: true })
    expect(parseInteractionResponse({ type: 'plan', approve: true, mode: 'root' })).toBeNull()
    expect(parseInteractionResponse({ type: 'form', action: 'submit', values: { n: 3, tags: ['a'] } })).toMatchObject({ action: 'submit' })
    expect(parseInteractionResponse({ type: 'form', action: 'submit', values: { n: { deep: 1 } } })).toBeNull()
  })
})

describe('parseRemoteResponse', () => {
  it('reads results and errors; an unknown code counts as failed', () => {
    expect(parseRemoteResponse({ re: 'm1', r: null })).toEqual({ re: 'm1', r: null })
    expect(parseRemoteResponse({ re: 'm1', e: { code: 'forbidden', message: 'x' } })).toEqual({ re: 'm1', e: { code: 'forbidden', message: 'x' } })
    expect(parseRemoteResponse({ re: 'm1', e: { code: 'weird', message: 'x' } })).toMatchObject({ e: { code: 'failed' } })
    expect(parseRemoteResponse({ re: 'm1' })).toBeNull()
  })

  it('has a German text for each error', () => {
    expect(remoteErrorText({ code: 'disabled', message: '' })).toMatch(/Fernsteuerung aus/)
    expect(remoteErrorText({ code: 'failed', message: 'Das Projekt der Session gibt es nicht mehr.' })).toBe('Das Projekt der Session gibt es nicht mehr.')
  })
})

describe('parseRemoteEvents', () => {
  it('keeps what looks like events and drops the rest', () => {
    const events = parseRemoteEvents({
      events: [
        { type: 'item', sessionId: 's', item: user('u1') },
        { type: 'delta', sessionId: 's', itemId: 'a1', field: 'text', text: 'Hal' },
        { type: 'delta', sessionId: 's', itemId: 'a1', field: 'html', text: '<b>' },
        { type: 'runtime', sessionId: 's', runtime: { status: 'running', connected: true } },
        { type: 'chats' },
        { type: 'item', sessionId: 's', item: { id: 'x' } },
        'nonsense',
      ],
    })
    expect(events?.map((e) => e.type)).toEqual(['item', 'delta', 'runtime', 'chats'])
  })
})

describe('slimItem and pageOf', () => {
  it('cuts long output from its start and leaves out what only works at the host', () => {
    const tool: ChatItem = {
      kind: 'tool',
      id: 't1',
      ts: 1,
      provider: 'claude',
      tool: 'bash',
      title: 'Bash',
      status: 'done',
      startedAt: 1,
      output: 'a'.repeat(REMOTE_TEXT_LIMIT) + 'ENDE',
      app: { resourceUri: 'ui://x', server: 'srv' },
    } as ChatItem
    const slim = slimItem(tool) as Extract<ChatItem, { kind: 'tool' }>
    expect(slim.output!.endsWith('ENDE')).toBe(true)
    expect(slim.output!.length).toBeLessThan(REMOTE_TEXT_LIMIT + 20)
    expect(slim.app).toBeUndefined()
    const withImage = slimItem({ ...user('u1'), images: ['C:\\bild.png'] } as ChatItem) as Extract<ChatItem, { kind: 'user' }>
    expect(withImage.images).toBeUndefined()
  })

  it('pages from the end backwards, within the size of a bundle', () => {
    const items = Array.from({ length: 500 }, (_, i) => user(`u${i}`))
    const last = pageOf(items)
    expect(last.start).toBe(200)
    expect(last.items.at(-1)?.id).toBe('u499')
    const before = pageOf(items, last.start)
    expect(before).toMatchObject({ start: 0 })
    expect(before.items.at(-1)?.id).toBe('u199')

    const big = Array.from({ length: 20 }, (_, i) => user(`b${i}`, 'x'.repeat(100_000)))
    const page = pageOf(big)
    expect(JSON.stringify(page.items).length).toBeLessThanOrEqual(REMOTE_BATCH_BYTES)
    expect(page.items.length).toBeGreaterThan(0)
    // One item larger than a page still makes one, so the chat goes on.
    expect(pageOf([user('huge', 'y'.repeat(4 * REMOTE_TEXT_LIMIT))]).items).toHaveLength(1)
  })
})

describe('remote chat ids', () => {
  it('name device and chat, and come apart again', () => {
    const id = remoteChatId('inst-1', 'chat_2')
    expect(parseRemoteChatId(id)).toEqual({ instance: 'inst-1', sessionId: 'chat_2' })
    expect(parseRemoteChatId('chat_2')).toBeNull()
  })
})
