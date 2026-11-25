import { describe, expect, it } from 'vitest'
import { compactionNotice } from '@shared/chat'
import { ClaudeTasks, changesFromResult, compactionOf, resultText, viewOfClaudeTool } from './claude-tools'

describe('resultText', () => {
  it('joins the text blocks of a result', () => {
    expect(resultText('fertig')).toBe('fertig')
    expect(resultText([{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }])).toBe('a\nb')
    expect(resultText(null)).toBe('')
  })

  it('shows the message inside Claude Code’s <tool_use_error>', () => {
    // As Claude Code 2.1 answers a Write to a file it hasn't read.
    const refused = '<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>'
    expect(resultText(refused)).toBe('File has not been read yet. Read it first before writing to it.')
    expect(resultText([{ type: 'text', text: refused }])).toBe('File has not been read yet. Read it first before writing to it.')
  })

  it('leaves the tag where it is only part of the text', () => {
    const quoted = 'grep fand: <tool_use_error>x</tool_use_error> in log.txt'
    expect(resultText(quoted)).toBe(quoted)
  })
})

describe('compactionOf', () => {
  it('reads the stream’s snake_case metadata', () => {
    // As Claude Code 2.1 sends it after /compact.
    const meta = { trigger: 'manual', pre_tokens: 37774, post_tokens: 10296, cumulative_dropped_tokens: 27478, duration_ms: 5512 }
    expect(compactionOf(meta)).toEqual({ trigger: 'manual', before: 37774, after: 10296, durationMs: 5512 })
  })

  it('leaves out what is missing', () => {
    expect(compactionOf({ trigger: 'auto', preTokens: 150000 })).toEqual({ trigger: 'auto', before: 150000, after: undefined, durationMs: undefined })
    expect(compactionOf({ trigger: 'other' }).trigger).toBeUndefined()
  })
})

describe('compactionNotice', () => {
  const base = { id: 'c', ts: 1, provider: 'claude' as const }

  it('says in words what the numbers say', () => {
    expect(compactionNotice(base, { trigger: 'manual', before: 37774, after: 10296 })).toMatchObject({
      kind: 'notice',
      level: 'info',
      text: 'Kontext wurde zusammengefasst',
      detail: '38k → 10k Tokens',
    })
    expect(compactionNotice(base, { trigger: 'auto', before: 150000 })).toMatchObject({ text: 'Kontext wurde automatisch zusammengefasst', detail: '150k Tokens vorher' })
    expect(compactionNotice(base, {}).detail).toBeUndefined()
  })
})

describe('changesFromResult', () => {
  const edit = viewOfClaudeTool('Edit', { file_path: 'F:\nexa\src\a.ts', old_string: 'steer?: boolean', new_string: 'steer?: boolean\nfrom?: ChatOrigin' }).changes

  it('takes the file’s own line numbers from the result’s patch', () => {
    // As Claude Code 2.1.331 reports an Edit in the stream (`tool_use_result`).
    const result = {
      filePath: 'F:\nexa\src\a.ts',
      structuredPatch: [{ oldStart: 33, oldLines: 2, newStart: 33, newLines: 3, lines: ['   steer?: boolean', '+  from?: ChatOrigin', ' }'] }],
    }
    expect(changesFromResult(edit, result)).toEqual([
      { path: 'F:\nexa\src\a.ts', type: 'update', diff: '@@ -33,2 +33,3 @@\n   steer?: boolean\n+  from?: ChatOrigin\n }' },
    ])
  })

  it('makes one change of several hunks, and keeps a new file as added', () => {
    const hunk = (start: number) => ({ oldStart: start, oldLines: 1, newStart: start, newLines: 1, lines: ['-a', '+b'] })
    const several = changesFromResult(edit, { structuredPatch: [hunk(3), hunk(90)] })
    expect(several).toHaveLength(1)
    expect(several![0]!.diff).toBe('@@ -3,1 +3,1 @@\n-a\n+b\n@@ -90,1 +90,1 @@\n-a\n+b')
    expect(changesFromResult(edit, { type: 'create', structuredPatch: [hunk(1)] })![0]!.type).toBe('add')
  })

  it('leaves the call’s own changes without a patch', () => {
    expect(changesFromResult(edit, { type: 'create', structuredPatch: [] })).toBeNull()
    expect(changesFromResult(edit, 'Error: file changed')).toBeNull()
    expect(changesFromResult(undefined, { structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [] }] })).toBeNull()
  })
})

describe('ClaudeTasks', () => {
  it('builds the list from created tasks and changes them by their id', () => {
    const tasks = new ClaudeTasks()
    expect(tasks.call('t1', 'TaskCreate', { subject: 'Tests schreiben', activeForm: 'Schreibt Tests' })).toEqual([
      { text: 'Tests schreiben', status: 'pending', activeText: 'Schreibt Tests' },
    ])
    expect(tasks.result('t1', 'TaskCreate', 'Task #1 created successfully: Tests schreiben', false, { task: { id: '1', subject: 'Tests schreiben' } })).toBeNull()
    tasks.call('t2', 'TaskCreate', { subject: 'Bauen' })
    // Without Claude Code's own result, the id comes from the text.
    tasks.result('t2', 'TaskCreate', 'Task #2 created successfully: Bauen', false, undefined)
    expect(tasks.call('t3', 'TaskUpdate', { taskId: '1', status: 'in_progress' })).toMatchObject([
      { id: '1', status: 'in_progress', activeText: 'Schreibt Tests' },
      { id: '2', status: 'pending' },
    ])
    expect(tasks.call('t4', 'TaskUpdate', { taskId: '2', status: 'deleted' })).toEqual([expect.objectContaining({ id: '1' })])
    // An id the list doesn't know changes nothing.
    expect(tasks.call('t5', 'TaskUpdate', { taskId: '9', status: 'completed' })).toBeNull()
  })

  it('drops a task whose creation failed', () => {
    const tasks = new ClaudeTasks()
    tasks.call('t1', 'TaskCreate', { subject: 'A' })
    expect(tasks.result('t1', 'TaskCreate', 'Fehler', true, undefined)).toEqual([])
  })

  it('takes the whole list from TaskList, by its result or its text', () => {
    const tasks = new ClaudeTasks()
    tasks.seed([{ id: '1', text: 'Alt', status: 'pending', activeText: 'Macht Altes' }])
    expect(
      tasks.result('t1', 'TaskList', '', false, {
        tasks: [
          { id: '1', subject: 'Alt', status: 'completed' },
          { id: '2', subject: 'Neu', status: 'in_progress' },
        ],
      }),
    ).toEqual([
      { id: '1', text: 'Alt', status: 'completed', activeText: 'Macht Altes' },
      { id: '2', text: 'Neu', status: 'in_progress', activeText: undefined },
    ])
    expect(tasks.result('t2', 'TaskList', ['#1 [completed] Alt', '#3 [pending] Danach [blocked by #2]'].join('\n'), false, undefined)).toMatchObject([
      { id: '1', text: 'Alt', status: 'completed' },
      { id: '3', text: 'Danach', status: 'pending' },
    ])
    expect(tasks.result('t3', 'TaskList', 'No tasks found', false, undefined)).toEqual([])
  })

  it('takes a seed only with ids, and only while it has no list of its own', () => {
    const tasks = new ClaudeTasks()
    tasks.seed([{ text: 'Aus TodoWrite', status: 'pending' }])
    expect(tasks.call('t1', 'TaskUpdate', { taskId: '1', status: 'completed' })).toBeNull()
    tasks.seed([{ id: '1', text: 'A', status: 'pending' }])
    expect(tasks.call('t2', 'TaskUpdate', { taskId: '1', status: 'completed' })).toEqual([{ id: '1', text: 'A', status: 'completed' }])
  })
})

describe('viewOfClaudeTool for agents talking', () => {
  it('names who a message goes to and keeps its text', () => {
    expect(viewOfClaudeTool('SendMessage', { to: 'Prüfer', summary: 'Kurz', message: 'Lang und mehr' })).toMatchObject({
      title: 'Nachricht an Prüfer',
      detail: 'Kurz',
      text: 'Lang und mehr',
    })
    expect(viewOfClaudeTool('ListAgents', {})).toMatchObject({ title: 'Agenten auflisten' })
  })
})
