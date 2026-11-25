import { describe, expect, it } from 'vitest'
import { codexItem, codexThreadItems, codexTurnsFromOutside } from './codex-items'

describe('codexItem', () => {
  it('names what the web tool does: search, open a page, find in it', () => {
    expect(codexItem({ type: 'webSearch', id: 'w1', query: '', action: { type: 'search', query: null, queries: ['vite 8', 'rolldown'] } }, null, true)).toMatchObject({
      title: 'Im Web suchen',
      detail: 'vite 8 · rolldown',
    })
    expect(codexItem({ type: 'webSearch', id: 'w2', query: '', action: { type: 'openPage', url: 'https://example.com' } }, null, true)).toMatchObject({
      title: 'Seite öffnen',
      detail: 'https://example.com',
    })
    expect(codexItem({ type: 'webSearch', id: 'w3', query: '', action: { type: 'findInPage', url: 'https://example.com', pattern: 'Preis' } }, null, true)).toMatchObject({
      title: 'Auf der Seite suchen',
      detail: 'Preis · https://example.com',
    })
  })

  it('shows a plan as an answer of its own, a pause and a hook’s prompt', () => {
    expect(codexItem({ type: 'plan', id: 'p1', text: '1. Lesen' }, null, false)).toMatchObject({ kind: 'assistant', phase: 'plan', text: '1. Lesen', streaming: true })
    expect(codexItem({ type: 'sleep', id: 's1', durationMs: 30_000 }, null, true)).toMatchObject({ kind: 'tool', title: 'Warten', detail: '30 s', status: 'done' })
    expect(codexItem({ type: 'hookPrompt', id: 'h1', fragments: [{ text: 'Prüfe die Tests', hookRunId: 'r1' }] }, null, true)).toMatchObject({
      kind: 'notice',
      detail: 'Prüfe die Tests',
    })
    expect(codexItem({ type: 'hookPrompt', id: 'h2', fragments: [] }, null, true)).toBeNull()
  })
})

const turn = (id: string, items: object[], more: object = {}) => ({ id, items, itemsView: 'full', status: 'completed', error: null, startedAt: 100, completedAt: 110, durationMs: 10_000, ...more })

describe('codexThreadItems', () => {
  it('reads prompts, thoughts, commands and answers, with the end of every turn', () => {
    const items = codexThreadItems({
      createdAt: 99,
      turns: [
        turn('turn-1', [
          { type: 'userMessage', id: 'u1', clientId: null, content: [{ type: 'text', text: 'Teste den Export', text_elements: [] }, { type: 'localImage', path: 'C:\\bild.png' }], startedAtMs: 100_000 },
          { type: 'reasoning', id: 'r1', summary: ['**Plan**'], content: [], startedAtMs: 100_500 },
          { type: 'reasoning', id: 'r2', summary: [], content: [] },
          {
            type: 'commandExecution',
            id: 'c1',
            command: 'npm test',
            commandActions: [{ type: 'unknown', command: 'npm test' }],
            cwd: 'F:\\app',
            status: 'completed',
            aggregatedOutput: 'ok',
            exitCode: 0,
            startedAtMs: 101_000,
            completedAtMs: 104_000,
          },
          { type: 'agentMessage', id: 'a1', text: 'Alles grün.', phase: 'final_answer', startedAtMs: 105_000 },
        ]),
      ],
    })

    expect(items).toMatchObject([
      { kind: 'user', id: 'u1', ts: 100_000, text: 'Teste den Export', images: ['C:\\bild.png'] },
      { kind: 'thinking', id: 'r1', text: '**Plan**', streaming: false },
      { kind: 'tool', id: 'c1', tool: 'bash', detail: 'npm test', output: 'ok', status: 'done', startedAt: 101_000, endedAt: 104_000 },
      { kind: 'assistant', id: 'a1', text: 'Alles grün.', phase: 'final', streaming: false },
      { kind: 'turn', id: 'turn:turn-1', status: 'done', durationMs: 10_000, ts: 110_000 },
    ])
  })

  it('ends what an interrupted turn left running and leaves a turn at work open', () => {
    const items = codexThreadItems({
      turns: [
        turn('turn-1', [{ type: 'commandExecution', id: 'c1', command: 'sleep 99', status: 'inProgress', exitCode: null }], { status: 'interrupted' }),
        turn('turn-2', [{ type: 'userMessage', id: 'u2', content: [{ type: 'text', text: 'Weiter' }] }], { status: 'inProgress', completedAt: null }),
      ],
    })

    expect(items.map((i) => [i.kind, 'status' in i ? i.status : undefined])).toEqual([
      ['tool', 'denied'],
      ['turn', 'interrupted'],
      ['user', undefined],
    ])
  })

  it('shows a subagent as its call with what it last said', () => {
    const [agent] = codexThreadItems({
      turns: [
        turn('turn-1', [
          {
            type: 'collabAgentToolCall',
            id: 'x1',
            tool: 'spawnAgent',
            status: 'completed',
            prompt: 'Prüfe die Tests',
            receiverThreadIds: ['t2'],
            agentsStates: { t2: { status: 'completed', message: 'Alle bestanden.' } },
          },
        ]),
      ],
    })

    expect(agent).toMatchObject({ kind: 'agent', description: 'Prüfe die Tests', status: 'done', result: 'Alle bestanden.' })
  })

  it('gives an MCP tool with a page its page and result (MCP Apps)', () => {
    const [tool, older, plain] = codexThreadItems({
      turns: [
        turn('turn-1', [
          {
            type: 'mcpToolCall',
            id: 'm1',
            server: 'weather',
            tool: 'show',
            status: 'completed',
            arguments: { city: 'Berlin' },
            mcpAppUi: { resourceUri: 'ui://weather/view', preferredModelDisplayMode: null },
            result: { content: [{ type: 'text', text: '21 °C' }], structuredContent: { temp: 21 }, _meta: null },
            error: null,
          },
          { type: 'mcpToolCall', id: 'm2', server: 'weather', tool: 'show', status: 'inProgress', arguments: {}, mcpAppResourceUri: 'ui://weather/old', result: null, error: null },
          { type: 'mcpToolCall', id: 'm3', server: 'weather', tool: 'plain', status: 'completed', arguments: {}, result: { content: [] }, error: null },
        ]),
      ],
    })
    expect(tool).toMatchObject({
      kind: 'tool',
      app: { server: 'weather', tool: 'show', resourceUri: 'ui://weather/view' },
      appResult: { content: [{ type: 'text', text: '21 °C' }], structuredContent: { temp: 21 } },
    })
    expect(older).toMatchObject({ app: { resourceUri: 'ui://weather/old' } })
    expect(older).not.toHaveProperty('appResult')
    expect(plain).not.toHaveProperty('app')
  })

  it('tells a turn that hit the plan’s limit', () => {
    const items = codexThreadItems({ turns: [turn('turn-1', [], { status: 'failed', error: { message: 'Limit erreicht', codexErrorInfo: 'usageLimitExceeded' } })] })
    expect(items).toMatchObject([{ kind: 'turn', status: 'error', error: 'Limit erreicht', limit: true }])
  })
})

describe('codexTurnsFromOutside', () => {
  const prompt = (id: string, text: string) => ({ type: 'userMessage', id, content: [{ type: 'text', text }] })
  const answer = (id: string, text: string) => ({ type: 'agentMessage', id, text, phase: 'final_answer' })
  const history = codexThreadItems({
    turns: [
      // Copied by a fork from the thread it came from, before the chat's time.
      turn('old', [prompt('u0', 'Früher'), answer('a0', 'Alt')], { startedAt: 50, completedAt: 60 }),
      // Nexa's own: its answer is in the chat by Codex's id, its prompt by Nexa's.
      turn('own', [prompt('u1', 'In Nexa'), answer('a1', 'Hier')], { startedAt: 100, completedAt: 110 }),
      turn('outside', [prompt('u2', 'Im Terminal'), answer('a2', 'Dort')], { startedAt: 200, completedAt: 210 }),
      turn('running', [prompt('u3', 'Noch dran')], { startedAt: 300, status: 'inProgress', completedAt: null }),
    ],
  })

  it('takes the finished turns the chat doesn’t know, from the time it last held the thread', () => {
    const known = new Set(['a1', 'turn:own'])
    const found = codexTurnsFromOutside(history, (id) => known.has(id), 110_500)
    expect(found.map((i) => i.id)).toEqual(['u2', 'a2', 'turn:outside'])
  })

  it('leaves a turn out that the chat knows only partly', () => {
    expect(codexTurnsFromOutside(history, (id) => id === 'a2' || id === 'turn:own' || id === 'a1', 0)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id: 'turn:outside' })]),
    )
    // Nothing known and no time: every finished turn.
    expect(codexTurnsFromOutside(history, () => false, 0).filter((i) => i.kind === 'turn').map((i) => i.id)).toEqual(['turn:old', 'turn:own', 'turn:outside'])
  })
})
