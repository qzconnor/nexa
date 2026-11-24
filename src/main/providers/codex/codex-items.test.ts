import { describe, expect, it } from 'vitest'
import { codexThreadItems } from './codex-items'

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

  it('tells a turn that hit the plan’s limit', () => {
    const items = codexThreadItems({ turns: [turn('turn-1', [], { status: 'failed', error: { message: 'Limit erreicht', codexErrorInfo: 'usageLimitExceeded' } })] })
    expect(items).toMatchObject([{ kind: 'turn', status: 'error', error: 'Limit erreicht', limit: true }])
  })
})
