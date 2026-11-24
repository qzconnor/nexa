import { describe, expect, it } from 'vitest'
import type { ChatItem } from './chat'
import { artifactChatMap, artifactIds, artifactLinks, chatOfArtifact } from './artifacts'

describe('artifactIds', () => {
  it('finds the ids of artifact links in a text, as the Artifact tool and Claude Code on the web write them', () => {
    expect(artifactIds('Published at https://claude.ai/artifact/R7RbnhAPX1Qy (Version 1) und [Seite](https://claude.ai/code/artifact/second-one).')).toEqual([
      'R7RbnhAPX1Qy',
      'second-one',
    ])
    expect(artifactIds('https://claude.ai/code/artifact/short')).toEqual([])
  })
})

describe('artifactLinks', () => {
  it('tells what the Artifact tool published from what the chat only names, each artifact once', () => {
    const items = [
      { kind: 'user', text: 'Mach eine Seite wie https://claude.ai/artifact/pasted-by-user' },
      { kind: 'tool', tool: 'other', name: 'Artifact', status: 'done', input: { title: 'x' }, output: 'Published at https://claude.ai/artifact/published-1 (Version 1)' },
      { kind: 'assistant', text: 'Fertig: https://claude.ai/artifact/published-1' },
      { kind: 'tool', tool: 'other', name: 'Artifact', status: 'error', output: 'Failed for https://claude.ai/artifact/failed-one' },
      { kind: 'tool', tool: 'mcp', name: 'mcp__x__y', input: { url: 'https://claude.ai/code/artifact/from-input-2' } },
      { kind: 'notice', text: 'https://claude.ai/artifact/not-a-message' },
    ] as unknown as ChatItem[]
    expect(artifactLinks(items)).toEqual({ published: ['published-1'], named: ['pasted-by-user', 'failed-one', 'from-input-2'] })
  })
})

describe('chatOfArtifact', () => {
  it('finds the chat by the short id of the link, else by the id', () => {
    const chats = { R7RbnhAPX1Qy: 'chat-1', 'c340f35b-uuid': 'chat-2' }
    expect(chatOfArtifact(chats, { id: 'c340f35b-other', shortId: 'R7RbnhAPX1Qy' })).toBe('chat-1')
    expect(chatOfArtifact(chats, { id: 'c340f35b-uuid', shortId: null })).toBe('chat-2')
    expect(chatOfArtifact(chats, { id: 'none', shortId: 'none-either' })).toBeNull()
  })
})

describe('artifactChatMap', () => {
  it('takes the newest chat that published it before one that only names it', () => {
    const map = artifactChatMap([
      { id: 'newest-lists-them', mentions: { published: [], named: ['a1', 'a2'] } },
      { id: 'made-a1', mentions: { published: ['a1'], named: [] } },
      { id: 'older-made-a1', mentions: { published: ['a1'], named: [] } },
    ])
    expect(map).toEqual({ a1: 'made-a1', a2: 'newest-lists-them' })
  })
})
