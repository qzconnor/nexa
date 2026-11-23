import { describe, expect, it } from 'vitest'
import type { AgentItem, ToolItem, TurnItem } from '@shared/chat'
import { claudeTranscriptItems, forkPoint, promptOf, summarizeClaudeTranscript, transcriptSince } from './claude-transcript'

const at = (s: number) => new Date(Date.UTC(2026, 10, 1, 10, 0, s)).toISOString()
const lines = (...entries: object[]) => entries.map((e) => JSON.stringify(e)).join('\n') + '\n'

const user = (uuid: string, s: number, content: unknown, extra: object = {}) => ({ type: 'user', uuid, timestamp: at(s), cwd: 'F:\\Code\\app', message: { role: 'user', content }, ...extra })
const assistant = (id: string, s: number, content: unknown[], extra: object = {}) => ({
  type: 'assistant',
  uuid: `${id}-${s}`,
  timestamp: at(s),
  message: { id, model: 'claude-sonnet-5-5', role: 'assistant', content, usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } },
  ...extra,
})

describe('promptOf', () => {
  it('keeps what the user typed and leaves out what Claude Code added', () => {
    expect(promptOf('Hallo <system-reminder>intern</system-reminder>')).toBe('Hallo')
    expect(promptOf('<command-name>/review</command-name><command-args>12</command-args>')).toBe('/review 12')
    expect(promptOf([{ type: 'text', text: '<bash-input>git status</bash-input>' }])).toBe('! git status')
    expect(promptOf('Sieh: <pasted_content id="1">\nText\n</pasted_content id="1">')).toBe('Sieh: Text')
    expect(promptOf('[Request interrupted by user]')).toBe('')
    expect(promptOf([{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }])).toBe('')
  })
})

describe('summarizeClaudeTranscript', () => {
  it('reads folder, title, times and how much was said', () => {
    const text = lines(
      { type: 'permission-mode', permissionMode: 'default' },
      user('u1', 1, 'Erste Frage'),
      assistant('m1', 2, [{ type: 'text', text: 'Antwort' }]),
      assistant('m1', 3, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }]),
      { type: 'ai-title', aiTitle: 'Von Claude' },
      user('u2', 4, [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }]),
      user('u3', 5, 'Zweite Frage'),
      { type: 'custom-title', customTitle: 'Eigener Name' },
      { type: 'relocated', relocatedCwd: 'F:\\Code\\app\\sub', timestamp: at(6) },
    )
    expect(summarizeClaudeTranscript(text)).toEqual({
      cwd: 'F:\\Code\\app\\sub',
      title: 'Eigener Name',
      firstPrompt: 'Erste Frage',
      lastPrompt: 'Zweite Frage',
      createdAt: Date.parse(at(1)),
      updatedAt: Date.parse(at(6)),
      messages: 3,
    })
  })

  it('counts nothing for a session that never got going', () => {
    expect(summarizeClaudeTranscript(lines({ type: 'summary', summary: 'x' }, user('u1', 1, '<local-command-caveat>c</local-command-caveat>'))).messages).toBe(0)
  })
})

describe('claudeTranscriptItems', () => {
  it('builds the chat a run would have shown', () => {
    const items = claudeTranscriptItems(
      lines(
        user('u1', 1, 'Lies die Datei'),
        assistant('m1', 2, [{ type: 'thinking', thinking: 'Hmm' }]),
        assistant('m1', 2, [{ type: 'text', text: 'Mache ich.' }]),
        assistant('m1', 3, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }]),
        user('u2', 4, [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'inhalt' }] }]),
        assistant('m2', 5, [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'rm -rf x' } }]),
        user('u3', 6, [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'The user rejected this tool use.' }]),
        assistant('m3', 7, [{ type: 'text', text: 'Fertig.' }]),
        { type: 'system', subtype: 'turn_duration', durationMs: 6000, uuid: 'd1', timestamp: at(7) },
        { type: 'system', subtype: 'compact_boundary', uuid: 'c1', timestamp: at(8), compactMetadata: { trigger: 'auto', preTokens: 150000, postTokens: 12000, durationMs: 44000 } },
        user('u4', 9, 'Kurzfassung', { isCompactSummary: true }),
      ),
    )
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      'user:u1',
      'thinking:m1:0',
      'assistant:m1:1',
      'tool:t1',
      'tool:t2',
      'assistant:m3:0',
      'turn:turn:d1',
      'notice:c1',
    ])
    const [, , , read, bash, , turn] = items as [unknown, unknown, unknown, ToolItem, ToolItem, unknown, TurnItem]
    expect(read).toMatchObject({ tool: 'read', title: 'Datei lesen', detail: 'a.ts', status: 'done', output: 'inhalt', startedAt: Date.parse(at(3)), endedAt: Date.parse(at(4)) })
    expect(bash.status).toBe('denied')
    expect(turn).toMatchObject({ status: 'done', durationMs: 6000, inputTokens: 300, outputTokens: 15, model: 'claude-sonnet-5-5' })
    expect(items.at(-1)).toMatchObject({
      text: 'Kontext wurde automatisch zusammengefasst',
      detail: '150k → 12k Tokens',
      compaction: { trigger: 'auto', before: 150000, after: 12000, durationMs: 44000 },
    })
  })

  it('shows slash commands and the user’s own commands with their output', () => {
    const items = claudeTranscriptItems(
      lines(
        user('u1', 1, '<command-name>/model</command-name>'),
        user('u2', 2, '<local-command-stdout>Set model</local-command-stdout>'),
        user('u3', 3, '<bash-input>ls</bash-input>'),
        user('u4', 4, '<bash-stdout>a.ts\nb.ts</bash-stdout><bash-stderr></bash-stderr>'),
      ),
    )
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ kind: 'user', text: '/model' })
    expect(items[1]).toMatchObject({ kind: 'tool', tool: 'bash', detail: 'ls', output: 'a.ts\nb.ts', status: 'done' })
  })

  it('puts a subagent’s work under it and ends a background agent with its notification', () => {
    const items = claudeTranscriptItems(
      lines(
        user('u1', 1, 'Untersuche das'),
        assistant('m1', 2, [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { description: 'Suche', prompt: 'Finde X', subagent_type: 'Explore' } }]),
        user('u2', 3, [{ type: 'tool_result', tool_use_id: 'a1', content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: abc' }] }]),
        user('u3', 9, '<task-notification>\n<task-id>abc</task-id>\n<tool-use-id>a1</tool-use-id>\n<status>completed</status>\n<summary>Fertig</summary>\n<result>X liegt in a.ts</result>\n</task-notification>'),
      ),
      [
        {
          toolUseId: 'a1',
          text: lines(
            user('s1', 4, 'Finde X', { isSidechain: true }),
            assistant('sm1', 5, [{ type: 'tool_use', id: 'st1', name: 'Grep', input: { pattern: 'X' } }], { isSidechain: true }),
            user('s2', 6, [{ type: 'tool_result', tool_use_id: 'st1', content: 'a.ts:1' }], { isSidechain: true }),
            assistant('sm2', 7, [{ type: 'text', text: 'In a.ts' }], { isSidechain: true }),
          ),
        },
      ],
    )
    const agent = items.find((i) => i.kind === 'agent') as AgentItem
    expect(agent).toMatchObject({ agentType: 'Explore', description: 'Suche', background: true, status: 'done', result: 'X liegt in a.ts', toolCount: 1, endedAt: Date.parse(at(9)) })
    expect(items.filter((i) => i.parentId === 'a1').map((i) => i.kind)).toEqual(['tool', 'assistant'])
    expect(items.some((i) => i.kind === 'user' && i.id === 's1')).toBe(false)
  })

  it('marks an interrupted turn and stops what still ran', () => {
    const items = claudeTranscriptItems(
      lines(
        user('u1', 1, 'Mach'),
        assistant('m1', 2, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sleep 100' } }]),
        user('u2', 3, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
      ),
    )
    expect(items.find((i) => i.kind === 'tool')).toMatchObject({ status: 'denied' })
    expect(items.at(-1)).toMatchObject({ kind: 'turn', status: 'interrupted' })
  })

  it('reads on from where the chat is: a later notification lands on the agent it already has', () => {
    const agent: AgentItem = { kind: 'agent', id: 'a1', ts: Date.parse(at(2)), provider: 'claude', agentType: 'Explore', description: 'Suche', background: true, status: 'running', startedAt: Date.parse(at(2)) }
    const items = claudeTranscriptItems(
      lines(
        user('u5', 20, '<task-notification>\n<tool-use-id>a1</tool-use-id>\n<status>completed</status>\n<result>Gefunden</result>\n</task-notification>'),
        user('u6', 21, 'Und jetzt?'),
        assistant('m6', 22, [{ type: 'text', text: 'Weiter.' }], { message: { id: 'm6', role: 'assistant', content: [{ type: 'text', text: 'Weiter.' }], stop_reason: 'end_turn' } }),
      ),
      [],
      [agent],
    )
    expect(items.find((i) => i.id === 'a1')).toMatchObject({ kind: 'agent', status: 'done', result: 'Gefunden', endedAt: Date.parse(at(20)) })
    expect(items.filter((i) => i.kind === 'user').map((i) => i.id)).toEqual(['u6'])
  })
})

describe('transcriptSince', () => {
  const end = (id: string, s: number, text: string) => ({
    type: 'assistant',
    uuid: `${id}-${s}`,
    timestamp: at(s),
    message: { id, role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' },
  })
  const call = (id: string, s: number, tool: string) => ({
    type: 'assistant',
    uuid: `${id}-${s}`,
    timestamp: at(s),
    message: { id, role: 'assistant', content: [{ type: 'tool_use', id: tool, name: 'Read', input: { file_path: 'a.ts' } }], stop_reason: 'tool_use' },
  })
  const text = lines(
    user('u1', 1, 'In Nexa gefragt'),
    end('m1', 2, 'In Nexa beantwortet'),
    { type: 'ai-title', aiTitle: 'Spät geschrieben' },
    user('u2', 10, 'Im Terminal gefragt'),
    call('m2', 11, 't1'),
    user('u3', 12, [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }]),
    end('m3', 13, 'Im Terminal beantwortet'),
    user('u4', 20, 'Noch in Arbeit'),
    call('m4', 21, 't2'),
  )

  it('takes the turns finished after the mark and leaves out one still at work', () => {
    const since = Date.parse(at(5))
    const added = transcriptSince(text, since)
    expect(added?.last).toBe(Date.parse(at(13)))
    const ids = (added?.text ?? '').split('\n').map((line) => (JSON.parse(line) as { uuid?: string; type: string }))
    // Bookkeeping without a time comes along; the chat leaves it out anyway.
    expect(ids.map((e) => e.uuid ?? e.type)).toEqual(['ai-title', 'u2', 'm2-11', 'u3', 'm3-13'])
    expect(claudeTranscriptItems(added!.text).map((i) => i.kind)).toEqual(['user', 'tool', 'assistant', 'turn'])
  })

  it('has nothing while the only turn since is still at work, and counts an interruption as its end', () => {
    expect(transcriptSince(text, Date.parse(at(13)))).toBeNull()
    const stopped = text + lines(user('u5', 22, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]))
    expect(transcriptSince(stopped, Date.parse(at(13)))?.last).toBe(Date.parse(at(22)))
  })

  it('has nothing when no turn came after the mark', () => {
    expect(transcriptSince(lines(user('u1', 1, 'Frage'), end('m1', 2, 'Antwort')), Date.parse(at(2)))).toBeNull()
  })
})

describe('forkPoint', () => {
  it('ends at the last answer of the main thread, after the bookkeeping behind it', () => {
    const text = lines(
      user('u1', 1, 'Frage'),
      assistant('m1', 2, [{ type: 'text', text: 'Antwort' }]),
      assistant('s1', 3, [{ type: 'text', text: 'Vom Agenten' }], { isSidechain: true }),
      { type: 'system', subtype: 'turn_duration', uuid: 'd1', timestamp: at(4) },
      { type: 'last-prompt', lastPrompt: 'Frage' },
    )
    expect(forkPoint(text)).toBe('m1-2')
  })

  it('leaves out a tool call cut off without its result', () => {
    const text = lines(
      user('u1', 1, 'Frage'),
      assistant('m1', 2, [{ type: 'thinking', thinking: 'Hm' }]),
      assistant('m1', 3, [{ type: 'text', text: 'Ich sehe nach' }]),
      assistant('m1', 4, [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git diff' } }]),
      user('u2', 5, [{ type: 'tool_result', tool_use_id: 't1', content: 'abgebrochen', is_error: true }]),
      user('u3', 6, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
    )
    expect(forkPoint(text)).toBe('m1-3')
  })

  it('has none without an answer', () => {
    expect(forkPoint(lines(user('u1', 1, 'Frage')))).toBeNull()
    expect(forkPoint('')).toBeNull()
  })
})
