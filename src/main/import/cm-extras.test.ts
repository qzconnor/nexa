import { describe, expect, it } from 'vitest'
import { planExtras, type ExtrasInput } from './cm-extras'

const input = (over: Partial<ExtrasInput> = {}): ExtrasInput => ({ prompts: [], themes: [], nexaThemes: [], names: {}, pinned: new Set(), chats: [], ...over })

const chat = (id: string, session: string, over: Partial<{ title: string; titleSource: 'auto' | 'user'; pinned: boolean }> = {}) => ({
  id,
  title: 'Wie geht das?',
  titleSource: 'auto' as const,
  cli: { claude: { sessionId: session, seenItems: 0 } },
  ...over,
})

describe('planExtras', () => {
  it('offers a workspace prompt where Nexa has none, and shows one it has another of', () => {
    const planned = planExtras(
      input({
        prompts: [
          { path: 'F:\\Projekte\\Flowtech\\amsreverse', text: 'Antworte auf Deutsch.\nKurz.', current: '' },
          { path: 'F:\\Projekte\\Apps', text: 'Tests zuerst.', current: 'Eigener Prompt' },
          { path: 'F:\\Projekte', text: 'Gleich', current: 'Gleich\n' },
        ],
      }),
    )
    expect(planned).toHaveLength(2)
    expect(planned[0]).toMatchObject({
      extra: { kind: 'prompt', label: 'Prompt von „amsreverse“', detail: 'Antworte auf Deutsch.' },
      task: { kind: 'prompt', path: 'F:\\Projekte\\Flowtech\\amsreverse', text: 'Antworte auf Deutsch.\nKurz.' },
    })
    expect(planned[1]!.extra.blocked).toBeTruthy()
    expect(planned[1]!.task).toBeUndefined()
  })

  it('offers themes Nexa has no theme of that name of, each name once', () => {
    const planned = planExtras(
      input({
        themes: [
          { file: 'a.json', name: 'Aizpun Dunkel' },
          { file: 'b.json', name: 'Aizpun Hell' },
          { file: 'c.json', name: 'aizpun hell' },
        ],
        nexaThemes: [' aizpun dunkel'],
      }),
    )
    expect(planned.map((p) => p.task)).toEqual([{ kind: 'theme', file: 'b.json' }])
  })

  it('names chats as in the Claude Manager unless they got a name of their own', () => {
    const planned = planExtras(
      input({
        names: { 'aaa-1': 'Login reparieren', 'bbb-2': 'Release', 'ccc-3': 'Schon so' },
        chats: [chat('n1', 'AAA-1'), chat('n2', 'bbb-2', { title: 'In Nexa umbenannt', titleSource: 'user' }), chat('n3', 'ccc-3', { title: 'Schon so' })],
      }),
    )
    expect(planned).toEqual([
      { extra: { id: 'names', kind: 'names', label: '1 Name einer Session', detail: '„Login reparieren“' }, task: { kind: 'names', renames: [{ id: 'n1', title: 'Login reparieren' }] } },
    ])
  })

  it('pins chats pinned in the Claude Manager that aren’t in Nexa', () => {
    const planned = planExtras(
      input({
        pinned: new Set(['aaa-1', 'bbb-2', 'zzz-9']),
        names: { 'aaa-1': 'Login reparieren' },
        chats: [chat('n1', 'aaa-1'), chat('n2', 'bbb-2', { pinned: true }), chat('n3', 'ccc-3')],
      }),
    )
    const pins = planned.find((p) => p.extra.kind === 'pins')
    expect(pins).toEqual({
      extra: { id: 'pins', kind: 'pins', label: '1 angeheftete Session', detail: '„Login reparieren“' },
      task: { kind: 'pins', ids: ['n1'] },
    })
  })

  it('has nothing to offer once Nexa has it all', () => {
    const planned = planExtras(
      input({
        prompts: [{ path: 'F:\\Projekte', text: 'Gleich', current: 'Gleich' }],
        themes: [{ file: 'a.json', name: 'Aizpun Dunkel' }],
        nexaThemes: ['Aizpun Dunkel'],
        names: { 'aaa-1': 'Login reparieren' },
        pinned: new Set(['aaa-1']),
        chats: [chat('n1', 'aaa-1', { title: 'Login reparieren', titleSource: 'user', pinned: true })],
      }),
    )
    expect(planned).toEqual([])
  })
})
