import { describe, expect, it } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { McpCallLog } from '../../mcp/call-log'
import type { RunOptions, RunSink } from '../provider'
import type { Json } from './antigravity-items'
import { AntigravityRun, type AcpLike } from './antigravity-run'

const SESSION = 'f406d638-75d2-4a6f-a697-8dadf426332f'

/** `initialize` of Antigravity CLI 1.5.16, as recorded. */
const INIT = {
  protocolVersion: 1,
  agentCapabilities: {
    loadSession: true,
    promptCapabilities: { image: true, audio: false, embeddedContext: true },
    sessionCapabilities: { resume: {}, close: {}, load: {}, list: {}, additionalDirectories: {} },
    auth: { logout: {} },
    _meta: { antigravity: { tier: true, systemPrompt: { append: true } } },
  },
  agentInfo: { name: 'Antigravity ACP Server', version: '1.5.16' },
}

/** `session/new`, as recorded (the models shortened). */
const NEW_SESSION = {
  sessionId: SESSION,
  models: {
    availableModels: [
      { modelId: 'gemini-4-hydrogen-high', name: 'Gemini 4 Hydrogen (High)' },
      { modelId: 'gemini-4-hydrogen-low', name: 'Gemini 4 Hydrogen (Low)' },
      { modelId: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)' },
      { modelId: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)' },
    ],
    currentModelId: 'gemini-4-hydrogen-high',
  },
  modes: { currentModeId: 'default', availableModes: [{ id: 'default' }, { id: 'accept-edits' }, { id: 'auto' }, { id: 'plan' }] },
  configOptions: [
    {
      id: 'model',
      type: 'select',
      currentValue: 'gemini-4-hydrogen',
      options: [
        { value: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
        { value: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
      ],
    },
    { id: 'thought_level', type: 'select', currentValue: 'high', options: [{ value: 'low' }, { value: 'high' }] },
  ],
  _meta: { antigravity: { tier: { name: 'Antigravity Starter Quota', id: 'free-tier' } } },
}

const END_TURN = { stopReason: 'end_turn', usage: { inputTokens: 14114, outputTokens: 235, cachedReadTokens: 15215, thoughtTokens: 0, totalTokens: 29564 } }

type Answer = (params: Json) => Json | Promise<Json>

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(options: Partial<RunOptions> = {}, answers: Record<string, Answer> = {}) {
  const requests: { method: string; params: Json }[] = []
  const notified: { method: string; params: Json }[] = []
  const responses: { id: number | string; result: Json }[] = []
  const conn: AcpLike = {
    alive: true,
    async request<T extends Json>(method: string, params: Json): Promise<T> {
      requests.push({ method, params })
      const fallback: Answer = method === 'initialize' ? () => INIT : method === 'session/new' ? () => NEW_SESSION : () => ({})
      return (await (answers[method] ?? fallback)(params)) as T
    },
    notify: (method, params) => notified.push({ method, params }),
    respond: (id, result) => responses.push({ id, result }),
    respondError: () => {},
    stop: async () => {},
  }
  const items = new Map<string, ChatItem>()
  const runtimes: Json[] = []
  const models: unknown[] = []
  const sink: RunSink = {
    item: (item) => items.set(item.id, item),
    delta: (id, _field, text) => {
      const item = items.get(id) as { text: string } | undefined
      if (item) items.set(id, { ...item, text: item.text + text } as ChatItem)
    },
    runtime: (patch) => runtimes.push(patch as Json),
    cliSession: () => {},
    usage: () => {},
    taken: () => {},
    exited: () => {},
  }
  const run = new AntigravityRun(
    conn,
    { sessionId: 'chat', cwd: 'F:\\scratch\\proj', permissionMode: 'ask', account: { accountId: 'system-antigravity', set: {}, unset: [] }, instructions: '', extraArgs: [], ...options },
    sink,
    { models: (list) => models.push(list) },
  )
  const update = (update: Json) => run.notification('session/update', { sessionId: SESSION, update })
  const of = <K extends ChatItem['kind']>(kind: K) => [...items.values()].filter((i): i is Extract<ChatItem, { kind: K }> => i.kind === kind)
  return { run, requests, notified, responses, items, runtimes, models, update, of, methods: () => requests.map((r) => r.method) }
}

/** A prompt that waits until the test ends it. */
function prompting(answers: Record<string, Answer> = {}) {
  const turn = deferred<Json>()
  return { turn, answers: { 'session/prompt': () => turn.promise, ...answers } }
}

describe('AntigravityRun.connect', () => {
  it("starts a conversation with Nexa's MCP server, its instructions in the system prompt and the chat's mode", async () => {
    const t = setup({ permissionMode: 'edits', instructions: 'Nexa sagt hallo.', mcp: { url: 'http://127.0.0.1:7/mcp', token: 'tok', allowed: [], ask: [] } })
    await t.run.connect()
    expect(t.methods()).toEqual(['initialize', 'session/new', 'session/set_mode'])
    expect(t.requests[1]!.params).toEqual({
      cwd: 'F:\\scratch\\proj',
      mcpServers: [{ type: 'http', name: 'nexa', url: 'http://127.0.0.1:7/mcp', headers: [{ name: 'Authorization', value: 'Bearer tok' }] }],
      _meta: { antigravity: { systemPrompt: { append: 'Nexa sagt hallo.' } } },
    })
    expect(t.requests[2]!.params).toEqual({ sessionId: SESSION, modeId: 'accept-edits' })
    expect(t.run.tier).toBe('Antigravity Starter Quota')
    expect(t.models[0]).toEqual([
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', isDefault: true, efforts: ['low', 'high'], defaultEffort: 'high' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', isDefault: false, efforts: ['low', 'high'] },
    ])
    expect(t.runtimes.at(-1)).toMatchObject({ status: 'idle', connected: true, model: 'gemini-4-hydrogen' })
  })

  it('picks the chat’s model and level of thought as config options', async () => {
    const t = setup({ model: 'gemini-3.8-flash', effort: 'low' })
    await t.run.connect()
    expect(t.methods()).toEqual(['initialize', 'session/new', 'session/set_config_option', 'session/set_config_option'])
    expect(t.requests[2]!.params).toEqual({ sessionId: SESSION, configId: 'model', value: 'gemini-3.8-flash' })
    expect(t.requests[3]!.params).toEqual({ sessionId: SESSION, configId: 'thought_level', value: 'low' })
  })

  it('resumes a conversation with session/resume, which streams nothing again', async () => {
    const t = setup({ resumeId: SESSION }, { 'session/resume': () => ({ modes: { currentModeId: 'default' } }) })
    await t.run.connect()
    expect(t.methods()).toEqual(['initialize', 'session/resume'])
    expect(t.run.sessionId).toBe(SESSION)
  })

  it('gives the instructions with the first prompt to a version that has no system prompt to add to', async () => {
    const t = setup({ instructions: 'Regeln' }, { initialize: () => ({ agentCapabilities: { loadSession: true } }), 'session/prompt': () => END_TURN })
    await t.run.connect()
    expect(t.requests[1]!.params._meta).toBeUndefined()
    await t.run.send({ id: 'p1', text: 'Hallo' })
    await flush()
    expect((t.requests.find((r) => r.method === 'session/prompt')!.params.prompt as Json[])[0]).toEqual({ type: 'text', text: '<nexa-instructions>\nRegeln\n</nexa-instructions>\n\nHallo' })
  })
})

describe('AntigravityRun turns', () => {
  it('streams text and thoughts, and ends the turn with its tokens', async () => {
    const p = prompting()
    const t = setup({}, p.answers)
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Plane kurz' })
    await flush()
    t.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '**Planning**\nIch lese zuerst.\n\n\n' } })
    t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Er' } })
    t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ledigt.' } })
    t.update({ sessionUpdate: 'usage_update', used: 10120, size: 1048576 })
    p.turn.resolve(END_TURN)
    await flush()
    expect(t.of('thinking')[0]).toMatchObject({ text: '**Planning**\nIch lese zuerst.', streaming: false })
    expect(t.of('assistant')[0]).toMatchObject({ text: 'Erledigt.', streaming: false })
    expect(t.of('turn')[0]).toMatchObject({ status: 'done', inputTokens: 14114, outputTokens: 235, provider: 'antigravity' })
    expect(t.runtimes).toContainEqual({ context: { used: 10120, window: 1048576 } })
  })

  it('ends a turn whose request failed with the error Antigravity sends as text', async () => {
    const p = prompting()
    const t = setup({}, p.answers)
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Hi' })
    await flush()
    t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '\n⚠ agent executor error: generating and executing: Error 400, Message: API key not valid.' } })
    p.turn.resolve({ stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } })
    await flush()
    expect(t.of('assistant')).toEqual([])
    expect(t.of('turn')[0]).toMatchObject({ status: 'error', error: 'generating and executing: Error 400, Message: API key not valid.' })
  })

  it('shows tool calls with their arguments, a diff, and a command with its output', async () => {
    const p = prompting()
    const t = setup({}, p.answers)
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Los' })
    await flush()
    // As recorded: `edit_file`, then `run_command`.
    const edit = { toolCallId: 'call_17973546938234500290', name: 'edit_file', args: { Path: 'F:\\scratch\\proj\\notiz.txt', Replacement: 'neu', Target: 'alt' }, kind: 'edit', title: 'File notiz.txt' }
    t.update({ sessionUpdate: 'tool_call', ...edit, status: 'in_progress', locations: [{ path: 'F:\\scratch\\proj\\notiz.txt' }] })
    t.update({ sessionUpdate: 'tool_call_update', ...edit, status: 'completed', title: 'File /F:/scratch/proj/notiz.txt', content: [{ type: 'diff', path: '/F:/scratch/proj/notiz.txt', newText: 'neu\r\n', oldText: 'alt\r\n' }] })
    const command = { toolCallId: 'call_17973546938234501917', name: 'run_command', args: { CommandLine: 'echo fertig', WaitMsBeforeAsync: 5000, toolSummary: 'Echo fertig' }, kind: 'execute', title: 'echo fertig' }
    t.update({ sessionUpdate: 'tool_call', ...command, status: 'in_progress' })
    t.update({
      sessionUpdate: 'tool_call_update',
      ...command,
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'Created At: x\nCompleted At: x\nCommand exited with code 0.\n\nCommand output:\nfertig\r\n' } }],
    })
    p.turn.resolve(END_TURN)
    await flush()
    const [file, bash] = t.of('tool')
    expect(file).toMatchObject({ tool: 'edit', title: 'Datei bearbeiten', detail: 'F:\\scratch\\proj\\notiz.txt', status: 'done', changes: [{ path: 'F:/scratch/proj/notiz.txt', type: 'update', oldText: 'alt\r\n', newText: 'neu\r\n' }] })
    expect(bash).toMatchObject({ tool: 'bash', detail: 'echo fertig', status: 'done', output: 'fertig', exitCode: 0 })
  })

  it('makes update_steps the todo list instead of a row', async () => {
    const p = prompting()
    const t = setup({}, p.answers)
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Los' })
    await flush()
    t.update({ sessionUpdate: 'tool_call', toolCallId: 'call_1', name: 'update_steps', args: { steps: [{ status: 'in_progress', title: 'Lesen' }] }, kind: 'other', status: 'in_progress' })
    p.turn.resolve(END_TURN)
    await flush()
    expect(t.of('tool')).toEqual([])
    expect(t.of('todo')[0]).toMatchObject({ id: 'todo:antigravity', entries: [{ text: 'Lesen', status: 'in_progress' }] })
  })

  it('cancels a turn with session/cancel', async () => {
    const p = prompting()
    const t = setup({}, p.answers)
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Zähle' })
    await flush()
    await t.run.interrupt()
    expect(t.notified).toEqual([{ method: 'session/cancel', params: { sessionId: SESSION } }])
    p.turn.resolve({ stopReason: 'cancelled' })
    await flush()
    expect(t.of('turn')[0]).toMatchObject({ status: 'interrupted' })
  })
})

describe('AntigravityRun permissions', () => {
  const WRITE = {
    sessionUpdate: 'tool_call',
    toolCallId: 'call_15753588179517087002',
    name: 'write_file',
    args: { Content: 'hi', Overwrite: true, Path: 'F:\\scratch\\proj\\hallo.txt' },
    status: 'pending',
    kind: 'edit',
    title: 'File hallo.txt',
    content: [{ type: 'diff', path: 'F:\\scratch\\proj\\hallo.txt', newText: 'hi' }],
  }
  const OPTIONS = [
    { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
    { optionId: 'deny', name: 'Deny', kind: 'reject_once' },
  ]

  it('asks the user and answers with the option they chose', async () => {
    const p = prompting()
    const t = setup({}, p.answers)
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Lege hallo.txt an' })
    await flush()
    t.run.request('1', 'session/request_permission', { sessionId: SESSION, toolCall: WRITE, options: OPTIONS })
    const [ask] = t.of('interaction')
    expect(ask).toMatchObject({ state: 'pending', request: { type: 'permission', title: 'Datei schreiben', changes: [{ path: 'F:\\scratch\\proj\\hallo.txt', type: 'add', newText: 'hi' }] } })
    expect(ask!.request.type === 'permission' && ask!.request.options.map((o) => o.id)).toEqual(['allow', 'deny'])
    await t.run.respond(ask!.id, { type: 'permission', decision: 'allow' })
    expect(t.responses).toEqual([{ id: '1', result: { outcome: { outcome: 'selected', optionId: 'allow' } } }])
  })

  it('allows everything in „Volle Rechte“, and Nexa’s own tools that need no asking', async () => {
    const p = prompting()
    const t = setup({ permissionMode: 'full', mcp: { url: 'u', token: 't', allowed: ['render_callout'], ask: [], calls: new McpCallLog() } }, p.answers)
    await t.run.connect()
    expect(t.requests[2]!.params).toEqual({ sessionId: SESSION, modeId: 'auto' })
    await t.run.send({ id: 'p1', text: 'Los' })
    await flush()
    t.run.request('1', 'session/request_permission', { sessionId: SESSION, toolCall: WRITE, options: OPTIONS })
    expect(t.of('interaction')).toEqual([])
    await t.run.setPermissionMode('ask')
    t.run.request('2', 'session/request_permission', { sessionId: SESSION, toolCall: { ...WRITE, toolCallId: 'call_2', name: 'nexa_render_callout', args: { text: 'x' } }, options: OPTIONS })
    expect(t.responses.map((r) => r.id)).toEqual(['1', '2'])
    expect(t.of('interaction')).toEqual([])
  })

  it('offers the plan Antigravity wrote at the end of the turn, and carries it out once approved', async () => {
    let prompts = 0
    const t = setup({ permissionMode: 'plan' }, { 'session/prompt': () => (++prompts === 1 ? first.promise : END_TURN) })
    const first = deferred<Json>()
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Plane hallo.txt' })
    await flush()
    const plan = { toolCallId: 'call_1', name: 'write_file', kind: 'edit', args: { Content: '# Plan\n1. hallo.txt anlegen', Path: 'C:\\x\\implementation_plan.md', ArtifactMetadata: { RequestFeedback: true } } }
    t.update({ sessionUpdate: 'tool_call', ...plan, status: 'in_progress' })
    t.update({ sessionUpdate: 'tool_call_update', ...plan, status: 'completed' })
    first.resolve(END_TURN)
    await flush()
    const [ask] = t.of('interaction')
    expect(ask).toMatchObject({ state: 'pending', request: { type: 'plan', plan: '# Plan\n1. hallo.txt anlegen' } })
    await t.run.respond(ask!.id, { type: 'plan', approve: true, mode: 'edits' })
    await flush()
    expect(t.requests.filter((r) => r.method === 'session/set_mode').at(-1)!.params).toEqual({ sessionId: SESSION, modeId: 'accept-edits' })
    expect((t.requests.filter((r) => r.method === 'session/prompt')[1]!.params.prompt as Json[])[0]).toEqual({ type: 'text', text: 'Der Plan ist freigegeben. Setze ihn jetzt um.' })
  })
})
