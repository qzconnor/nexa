import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatItem, SessionRuntime } from '@shared/chat'
import type { CliBinary } from '../cli-binary'
import type { JsonlProcessOptions } from '../jsonl-process'
import type { RunOptions, RunSink } from '../provider'
import { ClaudeRun } from './claude-run'

/** Claude Code's process, without one: what Nexa writes to it, and its stream to answer with. */
const fake = vi.hoisted(() => ({ written: [] as unknown[], options: null as JsonlProcessOptions | null }))
vi.mock('../jsonl-process', () => ({
  JsonlProcess: class {
    alive = true
    constructor(_command: unknown, options: JsonlProcessOptions) {
      fake.options = options
    }
    write(message: unknown) {
      fake.written.push(message)
    }
  },
}))

const options: RunOptions = { sessionId: 's', cwd: 'F:\\app', permissionMode: 'ask', account: { accountId: 'claude', set: {}, unset: [] }, instructions: '', extraArgs: [] }
const binary = { command: (args: string[]) => ({ command: 'claude', args }) } as unknown as CliBinary

describe('ClaudeRun prompts', () => {
  let taken: string[]
  let runtime: Partial<SessionRuntime>
  let run: ClaudeRun
  const stream = (message: unknown) => fake.options!.onMessage(message)

  beforeEach(() => {
    fake.written = []
    taken = []
    runtime = {}
    const sink: RunSink = {
      item: () => {},
      delta: () => {},
      runtime: (patch) => Object.assign(runtime, patch),
      cliSession: () => {},
      usage: () => {},
      taken: (id) => taken.push(id),
      exited: () => {},
    }
    run = new ClaudeRun(binary, options, sink)
  })

  /** Claude Code answers the `initialize` the run sent at its start. */
  const initialized = async () => {
    const request = fake.written.find((m) => (m as { request?: { subtype?: string } }).request?.subtype === 'initialize') as { request_id: string }
    stream({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: {} } })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('is ready without a prompt once Claude Code answers initialize (a restart)', async () => {
    expect(runtime.status).toBe('starting')
    await initialized()
    expect(runtime).toMatchObject({ status: 'idle', connected: true })
  })

  it('stays at work when the prompt came before the answer to initialize', async () => {
    await run.send({ id: 'p1', text: 'hallo' })
    await initialized()
    expect(runtime.status).toBe('running')
  })

  it('names each prompt, so Claude Code can say when it takes it up', async () => {
    await run.send({ id: 'p1', text: 'hallo' })
    expect(fake.written.at(-1)).toMatchObject({ type: 'user', uuid: 'p1' })

    stream({ type: 'command_lifecycle', command_uuid: 'p2', state: 'queued' })
    expect(taken).toEqual([])
    stream({ type: 'command_lifecycle', command_uuid: 'p2', state: 'started' })
    expect(taken).toEqual(['p2'])
  })

  it('asks Claude Code for the session’s title and keeps it as its own', async () => {
    const title = run.title('Plane eine Reise nach Kyoto')
    const request = fake.written.at(-1) as { request_id: string; request: unknown }
    expect(request).toMatchObject({ type: 'control_request', request: { subtype: 'generate_session_title', description: 'Plane eine Reise nach Kyoto', persist: true } })
    stream({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: { title: '„Reise nach Kyoto“' } } })
    expect(await title).toBe('Reise nach Kyoto')
  })

  it('works on when Claude Code takes a permission request back (auto mode allowed it)', async () => {
    await run.send({ id: 'p1', text: 'ändere die Datei' })
    stream({ type: 'command_lifecycle', command_uuid: 'p1', state: 'started' })
    const ask = (id: string) =>
      stream({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Edit', input: { file_path: 'F:\\app\\a.ts' }, tool_use_id: `t-${id}` } })
    ask('r1')
    ask('r2')
    expect(runtime.status).toBe('waiting')
    // One of two taken back: the other still waits for the user.
    stream({ type: 'control_cancel_request', request_id: 'r1' })
    expect(runtime.status).toBe('waiting')
    stream({ type: 'control_cancel_request', request_id: 'r2' })
    expect(runtime.status).toBe('running')
    // A cancel for nothing open changes nothing.
    runtime.status = 'idle'
    stream({ type: 'control_cancel_request', request_id: 'r9' })
    expect(runtime.status).toBe('idle')
  })

  const ask = (id: string) =>
    stream({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'git push' }, tool_use_id: `t-${id}` } })
  const answerStart = (parent: string | null) =>
    stream({ type: 'stream_event', parent_tool_use_id: parent, event: { type: 'message_start', message: { id: `m-${parent}` } } })

  it('works in a turn Claude Code starts itself once a task in the background ended', async () => {
    await initialized()
    expect(runtime.status).toBe('idle')
    // The order of Claude Code 2.1.331: no command_lifecycle, an init, then the answer.
    stream({ type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'completed' })
    stream({ type: 'system', subtype: 'init', session_id: 'cli-1' })
    expect(runtime.status).toBe('idle')
    answerStart(null)
    expect(runtime.status).toBe('running')
    expect(runtime.turnStartedAt).toEqual(expect.any(Number))

    // A question in that turn: answered, the chat is at work again, not waiting.
    ask('r1')
    expect(runtime.status).toBe('waiting')
    await run.respond('interaction:r1', { type: 'permission', decision: 'allow' })
    expect(runtime.status).toBe('running')
    stream({ type: 'result', subtype: 'success', duration_ms: 10 })
    expect(runtime.status).toBe('idle')
  })

  it('is at rest again once an agent in the background asked after the turn and got its answer', async () => {
    await initialized()
    // The agent's own answers start no turn of the chat.
    answerStart('agent-1')
    expect(runtime.status).toBe('idle')
    ask('r1')
    expect(runtime.status).toBe('waiting')
    await run.respond('interaction:r1', { type: 'permission', decision: 'allow' })
    expect(runtime.status).toBe('idle')

    // Taken back instead of answered: the same.
    ask('r2')
    stream({ type: 'control_cancel_request', request_id: 'r2' })
    expect(runtime.status).toBe('idle')

    // The chat goes on meanwhile: it still waits for the agent's question, and then works.
    ask('r3')
    answerStart(null)
    expect(runtime.status).toBe('waiting')
    await run.respond('interaction:r3', { type: 'permission', decision: 'deny' })
    expect(runtime.status).toBe('running')
  })

  it('works on after an interrupt when a prompt waited', async () => {
    await run.send({ id: 'p1', text: 'lange Aufgabe' })
    // The order Claude Code reports it in: the interrupted turn ends, the waiting prompt starts one.
    stream({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 10 })
    stream({ type: 'command_lifecycle', command_uuid: 'p1', state: 'cancelled' })
    stream({ type: 'command_lifecycle', command_uuid: 'p2', state: 'started' })
    expect(taken).toEqual(['p2'])
    expect(runtime.status).toBe('running')
  })
})

describe('ClaudeRun prompt suggestions', () => {
  let runtime: Partial<SessionRuntime>
  const stream = (message: unknown) => fake.options!.onMessage(message)
  const requests = (subtype: string) =>
    fake.written
      .map((m) => (m as { request?: Record<string, unknown> }).request)
      .filter((request): request is Record<string, unknown> => request?.subtype === subtype)
  const start = (promptSuggestions: boolean) => {
    fake.written = []
    runtime = {}
    const sink: RunSink = {
      item: () => {},
      delta: () => {},
      runtime: (patch) => Object.assign(runtime, patch),
      cliSession: () => {},
      usage: () => {},
      taken: () => {},
      exited: () => {},
    }
    return new ClaudeRun(binary, { ...options, promptSuggestions }, sink)
  }
  const guess = (suggestion: string) => stream({ type: 'prompt_suggestion', suggestion, uuid: 'u', session_id: 'c' })

  it('asks Claude Code for them and shows its guess after the turn, until the next one starts', async () => {
    const run = start(true)
    expect(requests('initialize')).toEqual([expect.objectContaining({ promptSuggestions: true })])
    expect(requests('set_prompt_suggestions_paused')).toEqual([])
    await run.send({ id: 'p1', text: 'fix the bug' })
    // A guess about the turn before comes too late once this one runs.
    guess('run the tests')
    expect(runtime.suggestion).toBeUndefined()
    stream({ type: 'result', subtype: 'success', duration_ms: 10 })
    guess('  run the tests ')
    expect(runtime.suggestion).toBe('run the tests')
    await run.send({ id: 'p2', text: 'run the tests' })
    expect(runtime.suggestion).toBeUndefined()
  })

  it('pauses them while the setting is off, and takes the pause back', async () => {
    const run = start(false)
    // Asked for all the same: only `initialize` turns them on, a pause can be undone.
    expect(requests('initialize')).toEqual([expect.objectContaining({ promptSuggestions: true })])
    expect(requests('set_prompt_suggestions_paused')).toEqual([expect.objectContaining({ paused: true })])
    guess('yes')
    expect(runtime.suggestion).toBeUndefined()

    await run.setPromptSuggestions(true)
    expect(requests('set_prompt_suggestions_paused').at(-1)).toMatchObject({ paused: false })
    guess('yes')
    expect(runtime.suggestion).toBe('yes')

    await run.setPromptSuggestions(false)
    expect(runtime.suggestion).toBeUndefined()
    expect(requests('set_prompt_suggestions_paused').at(-1)).toMatchObject({ paused: true })
  })
})

describe('ClaudeRun MCP Apps', () => {
  let items: Map<string, ChatItem>
  let run: ClaudeRun
  const stream = (message: unknown) => fake.options!.onMessage(message)
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const lastRequest = (subtype: string) =>
    fake.written.findLast((m) => (m as { request?: { subtype?: string } }).request?.subtype === subtype) as { request_id: string; request: Record<string, unknown> }
  const answer = (subtype: string, response: unknown) =>
    stream({ type: 'control_response', response: { subtype: 'success', request_id: lastRequest(subtype).request_id, response } })
  const STATUS = {
    mcpServers: [
      {
        name: 'my.weather',
        status: 'connected',
        tools: [
          { name: 'show', _meta: { ui: { resourceUri: 'ui://weather/view' } } },
          { name: 'refresh', _meta: { ui: { resourceUri: 'ui://weather/view', visibility: ['app'] } } },
        ],
      },
    ],
  }

  beforeEach(() => {
    fake.written = []
    items = new Map()
    const sink: RunSink = {
      item: (item) => void items.set(item.id, item),
      delta: () => {},
      runtime: () => {},
      cliSession: () => {},
      usage: () => {},
      taken: () => {},
      exited: () => {},
    }
    run = new ClaudeRun(binary, options, sink)
  })

  it('gives an MCP tool its page from mcp_status, with the result as the server gave it', async () => {
    stream({ type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'mcp__my_weather__show', input: { city: 'Berlin' } }] } })
    // The result may come before mcp_status answers: it waits for the page.
    stream({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '21 °C' }] }] },
      tool_use_result: { content: [{ type: 'text', text: '21 °C' }], structuredContent: { temp: 21 } },
    })
    answer('mcp_status', STATUS)
    await tick()
    expect(items.get('t1')).toMatchObject({
      app: { server: 'my.weather', tool: 'show', resourceUri: 'ui://weather/view' },
      appResult: { content: [{ type: 'text', text: '21 °C' }], structuredContent: { temp: 21 } },
      status: 'done',
    })
  })

  it('reads pages and calls tools by the server’s names', async () => {
    const read = run.readMcpResource('my.weather', 'ui://weather/view')
    expect(lastRequest('mcp_read_resource').request).toMatchObject({ serverName: 'my.weather', uri: 'ui://weather/view' })
    answer('mcp_read_resource', { contents: [{ uri: 'ui://weather/view', text: '<p>hi</p>' }] })
    await expect(read).resolves.toEqual({ contents: [{ uri: 'ui://weather/view', text: '<p>hi</p>' }] })

    const call = run.callMcpTool('my.weather', 'refresh', { city: 'Köln' })
    expect(lastRequest('mcp_call').request).toMatchObject({ tool: 'mcp__my_weather__refresh', arguments: { city: 'Köln' }, soft_error_result: true })
    answer('mcp_call', { content: 'Aktualisiert', structuredContent: { temp: 18 } })
    await expect(call).resolves.toEqual({ content: [{ type: 'text', text: 'Aktualisiert' }], structuredContent: { temp: 18 } })

    const ui = run.mcpToolUi('my.weather', 'refresh')
    answer('mcp_status', STATUS)
    await expect(ui).resolves.toEqual({ resourceUri: 'ui://weather/view', visibility: ['app'] })
  })
})
