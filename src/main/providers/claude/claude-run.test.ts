import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionRuntime } from '@shared/chat'
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
