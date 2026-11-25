import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '@shared/chat'
import { McpCallLog } from '../../mcp/call-log'
import type { RunOptions, RunSink } from '../provider'
import { AcpError } from './acp-connection'
import type { Json } from './gemini-items'
import { GeminiRun, type AcpLike } from './gemini-run'

const SESSION = '3583c523-6b2d-42ce-928c-b54443ca6f6d'

/** `session/new` of Gemini CLI 0.71.1, as recorded (shortened to two models). */
const NEW_SESSION = {
  sessionId: SESSION,
  modes: {
    availableModes: [
      { id: 'default', name: 'Default', description: 'Prompts for approval' },
      { id: 'autoEdit', name: 'Auto Edit', description: 'Auto-approves edit tools' },
      { id: 'yolo', name: 'YOLO', description: 'Auto-approves all tools' },
      { id: 'plan', name: 'Plan', description: 'Read-only mode' },
    ],
    currentModeId: 'default',
  },
  models: {
    availableModels: [
      { modelId: 'auto', name: 'Auto', description: 'Let Gemini CLI decide the best model for the task' },
      { modelId: 'gemini-2.5-pro', name: 'gemini-2.5-pro' },
    ],
    currentModelId: 'auto',
  },
}

/** The end of a prompt, as recorded. */
const END_TURN = { stopReason: 'end_turn', usage: { inputTokens: 1200, outputTokens: 40, totalTokens: 1240 } }

type Answer = (params: Json) => Json | Promise<Json>

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
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
      const answer = answers[method] ?? (method === 'session/new' ? () => NEW_SESSION : () => ({}))
      return (await answer(params)) as T
    },
    notify: (method, params) => notified.push({ method, params }),
    respond: (id, result) => responses.push({ id, result }),
    respondError: () => {},
    stop: async () => {},
  }
  const items = new Map<string, ChatItem>()
  const order: ChatItem[] = []
  const taken: string[] = []
  const runtimes: Json[] = []
  const commands: unknown[] = []
  const sink: RunSink = {
    item: (item) => {
      items.set(item.id, item)
      order.push(item)
    },
    delta: (id, _field, text) => {
      const item = items.get(id) as { text: string } | undefined
      if (item) items.set(id, { ...item, text: item.text + text } as ChatItem)
    },
    runtime: (patch) => runtimes.push(patch as Json),
    cliSession: () => {},
    usage: () => {},
    taken: (id) => taken.push(id),
    exited: () => {},
  }
  const run = new GeminiRun(
    conn,
    { sessionId: 'chat', cwd: 'F:\\app', permissionMode: 'ask', account: { accountId: 'g', set: {}, unset: [] }, instructions: '', extraArgs: [], ...options },
    sink,
    { commands: (list) => commands.push(list) },
  )
  const update = (update: Json) => run.notification('session/update', { sessionId: SESSION, update })
  const of = <K extends ChatItem['kind']>(kind: K) => [...items.values()].filter((i): i is Extract<ChatItem, { kind: K }> => i.kind === kind)
  return { run, requests, notified, responses, items, order, taken, runtimes, commands, update, of, methods: () => requests.map((r) => r.method) }
}

describe('GeminiRun.connect', () => {
  it("starts a conversation with Nexa's MCP server and the chat's mode", async () => {
    const t = setup({ permissionMode: 'edits', mcp: { url: 'http://127.0.0.1:7/mcp', token: 'tok', allowed: [], ask: [] } })
    await t.run.connect()
    expect(t.methods()).toEqual(['initialize', 'session/new', 'session/set_mode'])
    expect(t.requests[1]!.params).toEqual({
      cwd: 'F:\\app',
      mcpServers: [{ type: 'http', name: 'nexa', url: 'http://127.0.0.1:7/mcp', headers: [{ name: 'Authorization', value: 'Bearer tok' }] }],
    })
    expect(t.requests[2]!.params).toEqual({ sessionId: SESSION, modeId: 'autoEdit' })
    expect(t.run.sessionId).toBe(SESSION)
    expect(t.runtimes.at(-1)).toMatchObject({ status: 'idle', connected: true, model: 'auto' })
  })

  it('picks the model the chat has, and leaves the mode that is so already', async () => {
    const t = setup({ model: 'gemini-2.5-pro' })
    await t.run.connect()
    expect(t.methods()).toEqual(['initialize', 'session/new', 'session/set_model'])
    expect(t.requests[2]!.params).toEqual({ sessionId: SESSION, modelId: 'gemini-2.5-pro' })
  })

  it('resumes a conversation without showing its replay again', async () => {
    let t: ReturnType<typeof setup>
    t = setup(
      { resumeId: SESSION, account: { accountId: 'k', set: { GEMINI_API_KEY: 'AIzaX' }, unset: [] } },
      {
        // Without a sign-in in its settings Gemini CLI refuses to load, until the key is taken.
        'session/load': (() => {
          let first = true
          return () => {
            if (first) {
              first = false
              throw new AcpError('Authentication required', -32000)
            }
            t.update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Lege hello.txt an' } })
            t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Erledigt.' } })
            return { modes: { currentModeId: 'default' }, models: NEW_SESSION.models }
          }
        })(),
      },
    )
    await t.run.connect()
    expect(t.methods()).toEqual(['initialize', 'session/load', 'authenticate', 'session/load'])
    expect(t.requests[2]!.params).toEqual({ methodId: 'gemini-api-key' })
    expect(t.order).toEqual([])
    expect(t.run.sessionId).toBe(SESSION)
  })

  it('passes on the commands Gemini CLI offers', async () => {
    const t = setup()
    await t.run.connect()
    t.update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'memory show', description: 'Shows the current memory contents.' }] })
    expect(t.commands).toEqual([[{ name: 'memory show', description: 'Shows the current memory contents.' }]])
  })
})

describe('GeminiRun prompts', () => {
  it("sends Nexa's instructions with the first prompt that isn't a command", async () => {
    const t = setup({ instructions: 'Nutze render_chart.' }, { 'session/prompt': () => END_TURN })
    await t.run.connect()
    await t.run.send({ id: 'p1', text: '/about' })
    await flush()
    await t.run.send({ id: 'p2', text: 'Hallo' })
    await flush()
    await t.run.send({ id: 'p3', text: 'Noch was' })
    await flush()
    const prompts = t.requests.filter((r) => r.method === 'session/prompt').map((r) => (r.params.prompt as Json[])[0]!.text)
    expect(prompts).toEqual(['/about', '<nexa-instructions>\nNutze render_chart.\n</nexa-instructions>\n\nHallo', 'Noch was'])
  })

  it('streams the answer and ends the turn with its tokens, without the mode notes', async () => {
    const prompt = deferred<Json>()
    const t = setup({}, { 'session/prompt': () => prompt.promise })
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Hallo' })
    await flush()
    expect(t.taken).toEqual(['p1'])
    t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '[MODE_UPDATE] autoEdit' } })
    t.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '**Datei anlegen**\nIch schreibe hello.txt.' } })
    t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Erle' } })
    t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'digt.' } })
    t.update({ sessionUpdate: 'usage_update', used: 5000, size: 1_048_576 })
    prompt.resolve(END_TURN)
    await flush()
    expect(t.of('thinking').map((i) => [i.text, i.streaming])).toEqual([['**Datei anlegen**\nIch schreibe hello.txt.', false]])
    expect(t.of('assistant').map((i) => [i.text, i.streaming])).toEqual([['Erledigt.', false]])
    expect(t.of('turn')[0]).toMatchObject({ status: 'done', inputTokens: 1200, outputTokens: 40, provider: 'gemini' })
    expect(t.runtimes).toContainEqual({ context: { used: 5000, window: 1_048_576 } })
    expect(t.runtimes.at(-1)).toMatchObject({ status: 'idle' })
  })

  it('starts a new answer when Gemini CLI retries a broken stream', async () => {
    const prompt = deferred<Json>()
    const t = setup({}, { 'session/prompt': () => prompt.promise })
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Hallo' })
    await flush()
    t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Halb' } })
    t.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '_[Stream interrupted. Retrying response...]_' }, _meta: { retry: true } })
    t.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Ganz neu' }, _meta: { retry: true, reset: true } })
    prompt.resolve(END_TURN)
    await flush()
    // The broken half is replaced, not kept above the new answer.
    expect(t.of('assistant').map((i) => i.text)).toEqual(['Ganz neu'])
    expect(t.items.get('gemini:retry')).toMatchObject({ kind: 'notice', detail: 'Antwort abgebrochen, neuer Versuch' })
  })

  it('holds a prompt sent while Gemini CLI works until the turn is through', async () => {
    const first = deferred<Json>()
    let calls = 0
    const t = setup({}, { 'session/prompt': () => (++calls === 1 ? first.promise : END_TURN) })
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'eins' })
    await flush()
    await t.run.send({ id: 'p2', text: 'zwei' })
    await flush()
    expect(t.taken).toEqual(['p1'])
    first.resolve(END_TURN)
    await flush()
    await flush()
    expect(t.taken).toEqual(['p1', 'p2'])
    expect(t.of('turn')).toHaveLength(2)
  })

  it('shows the API error inside the error Gemini CLI wraps it in', async () => {
    // The answer to a prompt with an invalid key, as recorded.
    const message =
      '{"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 400,\\n    \\"message\\": \\"API key not valid. Please pass a valid API key.\\",\\n    \\"status\\": \\"INVALID_ARGUMENT\\"\\n  }\\n}\\n","code":400,"status":"Bad Request"}}'
    const t = setup({}, {
      'session/prompt': () => {
        throw new AcpError(message, 400)
      },
    })
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Hallo' })
    await flush()
    expect(t.of('turn')[0]).toMatchObject({ status: 'error', error: 'API key not valid. Please pass a valid API key.' })
  })

  it('cancels the turn and the open questions', async () => {
    const prompt = deferred<Json>()
    const t = setup({}, { 'session/prompt': () => prompt.promise })
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Hallo' })
    await flush()
    t.update({ sessionUpdate: 'tool_call', toolCallId: 'run_shell_command__1', status: 'in_progress', title: 'npm test', kind: 'execute' })
    await t.run.interrupt()
    expect(t.notified).toEqual([{ method: 'session/cancel', params: { sessionId: SESSION } }])
    prompt.resolve({ stopReason: 'cancelled' })
    await flush()
    expect(t.of('turn')[0]?.status).toBe('interrupted')
    expect(t.of('tool')[0]?.status).toBe('denied')
  })
})

describe('GeminiRun tools', () => {
  const working = async (options: Partial<RunOptions> = {}) => {
    const t = setup(options, { 'session/prompt': () => new Promise<Json>(() => {}) })
    await t.run.connect()
    await t.run.send({ id: 'p1', text: 'Los' })
    await flush()
    return t
  }

  it('shows a written file with its diff', async () => {
    const t = await working()
    // As recorded.
    t.update({ sessionUpdate: 'tool_call', toolCallId: 'write_file__abc', status: 'completed', title: 'WriteFile', content: [{ type: 'diff', path: 'hello.txt', oldText: '', newText: 'hi' }], kind: 'edit', locations: [{ path: 'F:\\app\\hello.txt' }] })
    expect(t.of('tool')[0]).toMatchObject({
      tool: 'write',
      name: 'write_file',
      title: 'Datei schreiben',
      detail: 'F:\\app\\hello.txt',
      status: 'done',
      changes: [{ path: 'hello.txt', type: 'add', oldText: '', newText: 'hi' }],
    })
  })

  it("asks for a tool and answers with Gemini CLI's option", async () => {
    const t = await working()
    t.run.request(7, 'session/request_permission', {
      sessionId: SESSION,
      toolCall: { toolCallId: 'run_shell_command__2', status: 'pending', title: 'rm -rf dist', kind: 'execute', content: [] },
      options: [
        { optionId: 'proceed_always', name: 'Allow for this session', kind: 'allow_always' },
        { optionId: 'proceed_once', name: 'Allow', kind: 'allow_once' },
        { optionId: 'cancel', name: 'Reject', kind: 'reject_once' },
      ],
    })
    await flush()
    const question = t.of('interaction')[0]!
    expect(question.request).toMatchObject({ type: 'permission', toolName: 'run_shell_command', title: 'Befehl ausführen', detail: 'rm -rf dist' })
    expect(question.request.type === 'permission' && question.request.options.map((o) => o.id)).toEqual(['allow', 'allow-session', 'deny'])
    expect(t.runtimes.at(-1)).toEqual({ status: 'waiting' })
    await t.run.respond(question.id, { type: 'permission', decision: 'allow-session' })
    expect(t.responses).toEqual([{ id: 7, result: { outcome: { outcome: 'selected', optionId: 'proceed_always' } } }])
    expect(t.items.get(question.id)).toMatchObject({ state: 'answered' })
  })

  it("runs Nexa's tools that need no asking, and draws them with the arguments its server saw", async () => {
    const calls = new McpCallLog()
    const t = await working({ mcp: { url: 'http://127.0.0.1:7/mcp', token: 'tok', allowed: ['render_callout'], ask: [], calls } })
    t.run.request(8, 'session/request_permission', {
      sessionId: SESSION,
      toolCall: { toolCallId: 'mcp_nexa_render_callout__3', title: 'render_callout (nexa MCP Server)', _meta: { 'gemini-cli': { mcp: { server_name: 'nexa', tool_name: 'render_callout' } } } },
      options: [
        { optionId: 'proceed_once', name: 'Allow', kind: 'allow_once' },
        { optionId: 'cancel', name: 'Reject', kind: 'reject_once' },
      ],
    })
    await flush()
    expect(t.responses).toEqual([{ id: 8, result: { outcome: { outcome: 'selected', optionId: 'proceed_once' } } }])
    expect(t.of('interaction')).toEqual([])
    calls.record('render_callout', { text: 'Achtung', tone: 'warning' })
    t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'mcp_nexa_render_callout__3', status: 'completed', content: [] })
    expect(t.of('tool')[0]).toMatchObject({
      tool: 'render',
      name: 'nexa.render_callout',
      status: 'done',
      input: { text: 'Achtung', tone: 'warning' },
      render: { type: 'callout', tone: 'warning', text: 'Achtung' },
    })
  })

  describe('plans', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nexa-gemini-'))
    const plan = join(dir, 'plan.md')
    writeFileSync(plan, '# Plan\n\n1. hello.txt anlegen\n')
    afterAll(() => rmSync(dir, { recursive: true, force: true }))

    const asked = async () => {
      const t = await working({ permissionMode: 'plan' })
      t.run.request(9, 'session/request_permission', {
        sessionId: SESSION,
        toolCall: { toolCallId: 'exit_plan_mode__4', status: 'pending', title: `Requesting plan approval for: ${plan}`, kind: 'other' },
        options: [
          { optionId: 'proceed_once', name: 'Yes', kind: 'allow_once' },
          { optionId: 'cancel', name: 'No', kind: 'reject_once' },
        ],
      })
      // The plan is read from its file first.
      const question = await vi.waitFor(() => {
        const found = t.of('interaction')[0]
        if (!found) throw new Error('no question yet')
        return found
      })
      return { t, question }
    }

    it('shows the plan from its file and, once approved, switches to the mode chosen', async () => {
      const { t, question } = await asked()
      expect(question.request).toEqual({ type: 'plan', plan: '# Plan\n\n1. hello.txt anlegen' })
      await t.run.respond(question.id, { type: 'plan', approve: true, mode: 'edits' })
      expect(t.responses).toEqual([{ id: 9, result: { outcome: { outcome: 'selected', optionId: 'proceed_once' } } }])
      // Gemini CLI goes to its default mode with the approval; Nexa's follows when the tool is through.
      t.update({ sessionUpdate: 'tool_call_update', toolCallId: 'exit_plan_mode__4', status: 'completed' })
      await flush()
      expect(t.requests.at(-1)).toEqual({ method: 'session/set_mode', params: { sessionId: SESSION, modeId: 'autoEdit' } })
    })

    it('rejects a plan with Gemini CLI’s own option', async () => {
      const { t, question } = await asked()
      await t.run.respond(question.id, { type: 'plan', approve: false, feedback: 'Erst testen' })
      expect(t.responses).toEqual([{ id: 9, result: { outcome: { outcome: 'selected', optionId: 'cancel' } } }])
      expect(t.items.get(question.id)).toMatchObject({ state: 'answered' })
    })
  })
})
