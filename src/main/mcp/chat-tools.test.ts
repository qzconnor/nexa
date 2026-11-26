import { describe, expect, it } from 'vitest'
import type { ChatItem, ProviderId } from '@shared/chat'
import type { RemoteChat } from '@shared/remote-chats'
import type { SessionSearchHit } from '@shared/types'
import type { PeerChat } from '../services/session-service'
import { ChatTools, chatTranscript, resolveChat, splitDevice, type ChatDevice, type ChatPeers, type DeviceChatPeers } from './chat-tools'

const NOW = 1_800_000_000_000

function chat(id: string, title: string, patch: Partial<PeerChat> = {}): PeerChat {
  return { id, title, provider: 'claude', projectId: 'p1', project: 'nexa', folder: 'F:\\nexa', status: 'idle', updatedAt: NOW - 60_000, archived: false, ...patch }
}

const CHATS = [
  chat('self', 'Hier'),
  chat('c1', 'Code-Review MCP', { provider: 'codex' }),
  chat('c2', 'Ühersetzung der Hinweise'),
  chat('c3', 'Release vorbereiten', { projectId: 'p2', project: 'cm' }),
  chat('c4', 'Release vorbereiten'),
  chat('c5', 'Alter Plan', { archived: true }),
]

const pick = (ref: string, chats = CHATS) => {
  const match = resolveChat(ref, chats, 'self', NOW)
  return 'chat' in match ? match.chat.id : match.error
}

describe('resolveChat', () => {
  it('finds a chat by its id or its title as it is now', () => {
    expect(pick('c1')).toBe('c1')
    expect(pick('code-review mcp')).toBe('c1')
    expect(pick('„Code-Review MCP“')).toBe('c1')
  })

  it('takes a part of the title, without minding case and accents', () => {
    expect(pick('Code-Review')).toBe('c1')
    expect(pick('hinweise')).toBe('c2')
    expect(pick('uhersetzung')).toBe('c2')
    expect(pick('review code')).toBe('c1')
  })

  it('prefers the chat in the caller’s project when the name fits several', () => {
    expect(pick('Release vorbereiten')).toBe('c4')
  })

  it('lets the agent choose when the name fits several in its project, with all that fit', () => {
    const twins = [...CHATS, chat('c6', 'Release vorbereiten (2)')]
    const error = pick('Release', twins)
    expect(error).toMatch(/^"Release" fits 3 chats\. Ask your user which one they mean/)
    expect(error).toContain('id: c3')
    expect(error).toContain('id: c6')
  })

  it('reaches archived chats only when no other fits', () => {
    expect(pick('Alter Plan')).toBe('c5')
    expect(pick('Plan', [...CHATS, chat('c7', 'Plan B')])).toBe('c7')
  })

  it('refuses the caller’s own chat and names that are nowhere', () => {
    expect(pick('self')).toBe('That is the chat you are in.')
    expect(pick('Hier')).toBe('That is the chat you are in.')
    expect(pick('Gibt es nicht')).toMatch(/^No chat in Nexa is called "Gibt es nicht"/)
    expect(pick('  ')).toMatch(/^Name the chat/)
  })
})

describe('chatTranscript', () => {
  const base = { ts: 1, provider: 'codex' as ProviderId }
  const items: ChatItem[] = [
    { ...base, kind: 'user', id: 'u1', text: 'Prüf das' },
    { ...base, kind: 'assistant', id: 'a0', text: 'Ich schaue …', phase: 'commentary' },
    { ...base, kind: 'assistant', id: 'a1', text: 'Sieht gut aus.', phase: 'final' },
    { ...base, kind: 'assistant', id: 'sub', text: 'vom Subagent', parentId: 'agent' },
    { ...base, kind: 'user', id: 'u2', text: 'Und das?', from: { sessionId: 'x', title: 'Hier', provider: 'claude' } },
    { ...base, kind: 'user', id: 'h', text: '<nexa-context>…', handoff: true },
  ]

  it('gives prompts and final answers of the main thread, the latest last', () => {
    expect(chatTranscript(items, 10)).toBe(['User: Prüf das', 'Codex: Sieht gut aus.', 'Message from the chat "Hier" (Claude): Und das?'].join('\n\n'))
    expect(chatTranscript(items, 1)).toBe('Message from the chat "Hier" (Claude): Und das?')
  })
})

describe('ChatTools', () => {
  function tools(chats = CHATS, items: Record<string, ChatItem[]> = {}, hits: SessionSearchHit[] = []) {
    const sent: { from: string; to: string; text: string }[] = []
    const created: unknown[] = []
    const searched: string[] = []
    let now = NOW
    const peers: ChatPeers = {
      list: () => chats,
      items: async (id) => items[id] ?? null,
      search: async (query) => {
        searched.push(query)
        return hits
      },
      send: async (from, to, text) => void sent.push({ from, to, text }),
      create: async (from, input) => {
        created.push({ from, ...input })
        return { id: 'new', title: input.title ?? 'Neue Session' }
      },
    }
    const chatTools = new ChatTools(peers, () => now)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await chatTools.call('self', name, args)
      return { text: result.content.map((c) => (c.type === 'text' ? c.text : '')).join(''), error: !!result.isError }
    }
    return { call, sent, created, searched, later: (ms: number) => (now += ms) }
  }

  it('searches the titles and the conversations of the other chats, archived ones too', async () => {
    const hits: SessionSearchHit[] = [
      { sessionId: 'c5', role: 'assistant', provider: 'codex', snippet: '…der alte Plan war gut' },
      { sessionId: 'self', role: 'user', provider: 'claude', snippet: 'Plan hier' },
    ]
    const { call, searched } = tools(CHATS, {}, hits)
    const { text } = await call('sessions_search', { query: '„Plan“' })
    expect(searched).toEqual(['plan'])
    expect(text).toMatch(/^One chat fits "„Plan“", newest first:\n- "Alter Plan" \(Claude Code, project nexa, active 1 min ago \(\d{4}-\d\d-\d\d\), archived\) id: c5\n  Codex: …der alte Plan war gut\n/)
    expect(text).toContain('Read one with chat_read.')
  })

  it('finds a chat by its title alone, without minding accents, and narrows it to a project', async () => {
    const { call } = tools()
    expect((await call('sessions_search', { query: 'uhersetzung HINWEISE' })).text).toContain('- "Ühersetzung der Hinweise"')
    expect((await call('sessions_search', { query: 'Ühersetzung' })).text).toContain('(the words are in its title)')
    const inCm = (await call('sessions_search', { query: 'release', project: 'cm' })).text
    expect(inCm).toContain('id: c3')
    expect(inCm).not.toContain('id: c4')
    expect(await call('sessions_search', { query: 'nirgends' })).toMatchObject({ error: false, text: 'No other chat fits "nirgends".' })
    expect(await call('sessions_search', { query: ' „“ ' })).toMatchObject({ error: true })
  })

  it('gives at most as many as asked for and says how many more there are', async () => {
    const many = [chat('self', 'Hier'), ...Array.from({ length: 5 }, (_, i) => chat(`r${i}`, `Release ${i}`))]
    const { text } = await tools(many).call('sessions_search', { query: 'release', limit: 2 })
    expect(text.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2)
    expect(text).toContain('… and 3 more')
  })

  it('lists the other chats, without archived ones unless asked', async () => {
    const { call } = tools()
    const { text } = await call('chat_list', {})
    expect(text).toContain('You are in "Hier" (id: self, project nexa).')
    expect(text).toContain('- "Code-Review MCP" (Codex, project nexa, idle, active 1 min ago) id: c1')
    expect(text).not.toContain('Alter Plan')
    expect((await call('chat_list', { archived: true })).text).toContain('Alter Plan')
    expect((await call('chat_list', { query: 'cm' })).text.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(1)
  })

  it('sends to the chat a name means and says whether it is busy', async () => {
    const busy = CHATS.map((c) => (c.id === 'c1' ? { ...c, status: 'running' as const } : c))
    const { call, sent } = tools(busy)
    const result = await call('chat_send', { to: 'Code-Review', text: '  Bitte prüfen.  ' })
    expect(result).toMatchObject({ error: false })
    expect(result.text).toMatch(/^Sent to "Code-Review MCP" \(Codex\)\. It is busy/)
    expect(sent).toEqual([{ from: 'self', to: 'c1', text: 'Bitte prüfen.' }])
  })

  it('sends nothing when the name is unclear or the message empty', async () => {
    const { call, sent } = tools()
    expect(await call('chat_send', { to: 'nirgends', text: 'x' })).toMatchObject({ error: true })
    expect(await call('chat_send', { to: 'c1', text: ' ' })).toMatchObject({ error: true, text: 'The message is empty.' })
    expect(sent).toEqual([])
  })

  it('reads another chat', async () => {
    const { call } = tools(CHATS, { c1: [{ kind: 'assistant', id: 'a', ts: 1, provider: 'codex', text: 'Zwei Fehler gefunden.' }] })
    expect((await call('chat_read', { chat: 'Code-Review' })).text).toBe('"Code-Review MCP" (Codex, idle), id: c1\n\nCodex: Zwei Fehler gefunden.')
  })

  it('starts a new chat with the CLI asked for', async () => {
    const { call, created } = tools()
    expect(await call('chat_new', { cli: 'aider', text: 'x' })).toMatchObject({ error: true })
    const result = await call('chat_new', { cli: 'codex', text: 'Review bitte', title: 'Codex-Review' })
    expect(result.text).toMatch(/^Started the chat "Codex-Review" \(Codex, id: new\)/)
    expect(created).toEqual([{ from: 'self', provider: 'codex', text: 'Review bitte', title: 'Codex-Review' }])
  })

  it('stops a chat that sends too much, until the window passed', async () => {
    const { call, sent, later } = tools()
    for (let i = 0; i < 20; i++) await call('chat_send', { to: 'c1', text: `#${i}` })
    expect(await call('chat_send', { to: 'c1', text: 'eins zu viel' })).toMatchObject({ error: true })
    expect(sent).toHaveLength(20)
    later(10 * 60_000 + 1)
    expect(await call('chat_send', { to: 'c1', text: 'wieder' })).toMatchObject({ error: false })
  })
})

describe('splitDevice', () => {
  const devices = [{ name: 'Laptop' }, { name: 'Laptop alt' }, { name: 'Büro-PC' }]
  const split = (ref: string) => {
    const found = splitDevice(ref, devices)
    return found && [found.device.name, found.rest]
  }

  it('takes the device in front of a chat’s name, however it is separated', () => {
    expect(split('Laptop › Server-Umbau')).toEqual(['Laptop', 'Server-Umbau'])
    expect(split('„laptop > Server-Umbau“')).toEqual(['Laptop', 'Server-Umbau'])
    expect(split('Laptop: Server-Umbau')).toEqual(['Laptop', 'Server-Umbau'])
    expect(split('Laptop Server-Umbau')).toEqual(['Laptop', 'Server-Umbau'])
    expect(split('Laptop alt › Plan')).toEqual(['Laptop alt', 'Plan'])
    expect(split('buero-pc/Plan')).toBeNull()
    expect(split('Büro-PC/Plan')).toEqual(['Büro-PC', 'Plan'])
  })

  it('takes nothing that only starts like a device', () => {
    expect(split('Laptops einrichten')).toBeNull()
    expect(split('Laptop')).toBeNull()
    expect(split('Laptop › ')).toBeNull()
  })
})

describe('chatTranscript of a message from another device', () => {
  it('names the device the sending chat is on', () => {
    const item: ChatItem = { kind: 'user', id: 'u', ts: 1, provider: 'claude', text: 'Prüf das', from: { sessionId: 'x', title: 'Hier', provider: 'codex', device: { id: 'lap', name: 'Laptop' } } }
    expect(chatTranscript([item], 5)).toBe('Message from the chat "Hier" on the device "Laptop" (Codex): Prüf das')
  })
})

describe('ChatTools with the user’s other devices', () => {
  const laptop: ChatDevice = { id: 'lap', name: 'Laptop', online: true }
  const tablet: ChatDevice = { id: 'tab', name: 'Tablet', online: false }
  const remote = (id: string, title: string, patch: Partial<RemoteChat> = {}): RemoteChat => ({ ...chat(id, title, { projectId: 'rp', project: 'nexa' }), ...patch })
  const LAPTOP_CHATS = [remote('r1', 'Server-Umbau', { status: 'running' }), remote('r2', 'Code-Review MCP'), remote('r3', 'Alter Plan', { archived: true })]

  function tools(devices: ChatDevice[] = [laptop, tablet], patch: Partial<DeviceChatPeers> = {}) {
    const sent: { device: string; from: string; to: string; text: string }[] = []
    const created: unknown[] = []
    const local: string[] = []
    const peers: ChatPeers = {
      list: () => CHATS,
      items: async () => [],
      search: async () => [{ sessionId: 'c5', role: 'assistant', provider: 'codex', snippet: '…der alte Plan war gut' }],
      send: async (_from, to) => void local.push(to),
      create: async () => ({ id: 'new', title: 'Neu' }),
    }
    const notConnected = (device: ChatDevice) => new Error(`The device "${device.name}" is not connected right now, so its chats are out of reach.`)
    const others: DeviceChatPeers = {
      devices: () => devices,
      selfName: () => 'Desktop',
      list: async (device) => {
        if (!device.online) throw notConnected(device)
        return LAPTOP_CHATS
      },
      read: async (device, id) => {
        if (!device.online) throw notConnected(device)
        return { chat: LAPTOP_CHATS.find((c) => c.id === id)!, transcript: 'User: Bau den Server um' }
      },
      search: async (device) => {
        if (!device.online) throw notConnected(device)
        return { found: [{ chat: { ...LAPTOP_CHATS[2]!, updatedAt: NOW - 10_000 }, hit: { sessionId: 'r3', role: 'user', provider: 'claude', snippet: '…Plan vom Laptop' } }], total: 1 }
      },
      send: async (device, from, to, text) => {
        sent.push({ device: device.id, from, to, text })
        return LAPTOP_CHATS.find((c) => c.id === to)!
      },
      create: async (device, from, input) => {
        created.push({ device: device.id, from, ...input })
        return { id: 'n1', title: input.title ?? 'Neue Session', project: input.project ?? 'nexa' }
      },
      ...patch,
    }
    const chatTools = new ChatTools(peers, () => NOW, others)
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = await chatTools.call('self', name, args)
      return { text: result.content.map((c) => (c.type === 'text' ? c.text : '')).join(''), error: !!result.isError }
    }
    return { call, sent, created, local }
  }

  it('lists the chats of each device after this one’s, and says which device it couldn’t reach', async () => {
    const { text } = await tools().call('chat_list', {})
    expect(text).toContain('You are in "Hier" (id: self, project nexa) on the device "Desktop".\nChats on this device, newest first:\n- "Code-Review MCP"')
    expect(text).toContain('Chats on the device "Laptop", newest first:\n- "Laptop › Server-Umbau" (Claude Code, project nexa, working right now, active 1 min ago) id: lap:r1')
    expect(text).not.toContain('Laptop › Alter Plan')
    expect(text).toContain('The device "Tablet" is not connected right now')
    const narrowed = (await tools().call('chat_list', { query: 'laptop review' })).text
    expect(narrowed).toContain('No other chat on this device fits.')
    expect(narrowed).toContain('- "Laptop › Code-Review MCP"')
  })

  it('keeps finding this device’s chats first, by the same names as before', async () => {
    const { call, local, sent } = tools()
    expect((await call('chat_send', { to: 'Code-Review', text: 'Hier bitte' })).text).toMatch(/^Sent to "Code-Review MCP" \(Codex\)/)
    expect(local).toEqual(['c1'])
    expect(sent).toEqual([])
  })

  it('reaches another device’s chat by its id, by „Device › Title“, or by a title only it has', async () => {
    const { call, sent } = tools()
    expect((await call('chat_send', { to: 'lap:r1', text: 'eins' })).text).toMatch(/^Sent to "Laptop › Server-Umbau" \(Claude Code\)\. It is busy/)
    expect((await call('chat_send', { to: 'Laptop › Code-Review', text: 'zwei' })).text).toMatch(/^Sent to "Laptop › Code-Review MCP"/)
    expect((await call('chat_send', { to: 'Server-Umbau', text: 'drei' })).text).toMatch(/^Sent to "Laptop › Server-Umbau"/)
    expect(sent).toEqual([
      { device: 'lap', from: 'self', to: 'r1', text: 'eins' },
      { device: 'lap', from: 'self', to: 'r2', text: 'zwei' },
      { device: 'lap', from: 'self', to: 'r1', text: 'drei' },
    ])
  })

  it('says when a device isn’t connected or has no such chat, and names who couldn’t be asked', async () => {
    const { call, sent } = tools()
    expect(await call('chat_send', { to: 'Tablet › Notizen', text: 'x' })).toMatchObject({ error: true, text: expect.stringMatching(/^The device "Tablet" is not connected right now/) })
    expect(await call('chat_send', { to: 'Laptop › Gibt es nicht', text: 'x' })).toMatchObject({ error: true, text: expect.stringMatching(/^No chat on the device "Laptop" is called "Gibt es nicht"/) })
    expect(await call('chat_send', { to: 'lap:weg', text: 'x' })).toMatchObject({ error: true, text: expect.stringContaining('The device "Laptop" has no chat with the id weg') })
    const nowhere = await call('chat_send', { to: 'Nirgends', text: 'x' })
    expect(nowhere.text).toMatch(/^No chat in Nexa is called "Nirgends", neither on this device nor on the user's other devices\./)
    expect(nowhere.text).toContain('The device "Tablet" is not connected right now')
    expect(sent).toEqual([])
  })

  it('passes on what the other device refused', async () => {
    const { call } = tools(undefined, {
      send: async () => {
        throw new Error('The device "Laptop" refused: messages between chats are turned off there (Einstellungen › Chat).')
      },
    })
    expect(await call('chat_send', { to: 'Laptop › Server-Umbau', text: 'x' })).toEqual({
      error: true,
      text: 'The device "Laptop" refused: messages between chats are turned off there (Einstellungen › Chat).',
    })
  })

  it('reads another device’s chat', async () => {
    const { text } = await tools().call('chat_read', { chat: 'Laptop › Server-Umbau' })
    expect(text).toBe('"Laptop › Server-Umbau" (Claude Code, working right now), id: lap:r1\n\nUser: Bau den Server um')
  })

  it('searches all devices and merges what they found, newest first', async () => {
    const { text } = await tools().call('sessions_search', { query: 'plan' })
    expect(text).toMatch(/^2 chats fit "plan", newest first:\n- "Laptop › Alter Plan" .* id: lap:r3\n {2}User: …Plan vom Laptop\n- "Alter Plan" .* id: c5\n/)
    expect(text).toContain('The device "Tablet" is not connected right now')
  })

  it('starts a chat on another device, in the project named there', async () => {
    const { call, created } = tools()
    const result = await call('chat_new', { cli: 'codex', text: 'Review bitte', device: 'laptop', project: 'cm' })
    expect(result.text).toMatch(/^Started the chat "Laptop › Neue Session" on the device "Laptop" \(Codex, project cm, id: lap:n1\)/)
    expect(created).toEqual([{ device: 'lap', from: 'self', provider: 'codex', text: 'Review bitte', title: undefined, project: 'cm' }])
    expect(await call('chat_new', { cli: 'codex', text: 'x', device: 'Handy' })).toMatchObject({ error: true, text: 'The user has no device called "Handy". Their other devices: "Laptop", "Tablet".' })
    // This device by its name: started here, as without a device.
    expect((await call('chat_new', { cli: 'codex', text: 'x', device: 'Desktop' })).text).toMatch(/^Started the chat "Neu" \(Codex, id: new\)/)
  })

  it('counts messages to other devices against the same limit', async () => {
    const { call, sent } = tools()
    for (let i = 0; i < 20; i++) await call('chat_send', { to: i % 2 ? 'lap:r1' : 'c1', text: `#${i}` })
    expect(await call('chat_send', { to: 'lap:r1', text: 'eins zu viel' })).toMatchObject({ error: true, text: expect.stringContaining('Nexa stopped this') })
    expect(sent).toHaveLength(10)
  })

  it('works as without devices when none is paired', async () => {
    const { text } = await tools([]).call('chat_list', {})
    expect(text).toContain('You are in "Hier" (id: self, project nexa).\nChats, newest first:')
    expect(text).not.toContain('device')
  })
})
