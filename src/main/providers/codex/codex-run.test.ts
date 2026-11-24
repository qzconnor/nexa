import { describe, expect, it, vi } from 'vitest'
import type { ChatItem } from '@shared/chat'
import type { RunOptions, RunSink } from '../provider'
import type { CodexClient } from './codex-client'
import { commandView, unwrapShell } from './codex-items'
import { CodexRun, codexMcpConfig, heldElsewhere, skillInputs } from './codex-run'

const sink: RunSink = { item: () => {}, delta: () => {}, runtime: () => {}, cliSession: () => {}, usage: () => {}, taken: () => {}, exited: () => {} }

describe('CodexRun.send', () => {
  const options: RunOptions = { sessionId: 's', cwd: 'F:\\app', permissionMode: 'ask', account: { accountId: 'codex', set: {}, unset: [] }, instructions: '', extraArgs: [] }
  const working = async (answer: (method: string) => Promise<unknown>) => {
    const request = vi.fn(async (method: string) => (method === 'thread/start' ? { thread: { id: 't1' } } : answer(method)))
    const taken: string[] = []
    const run = new CodexRun({ alive: true, request } as unknown as CodexClient, options, { ...sink, taken: (id) => taken.push(id) }, { add: () => {}, remove: () => {} })
    await run.connect()
    run.notification('turn/started', { threadId: 't1', turn: { id: 'turn-1' } })
    return { run, taken, methods: () => request.mock.calls.map(([method]) => method) }
  }

  it('steers a prompt into the running turn, taken up at once', async () => {
    const { run, taken, methods } = await working(async () => ({ turnId: 'turn-1' }))
    await run.send({ id: 'p2', text: 'noch was' })
    expect(methods()).toEqual(['thread/start', 'turn/steer'])
    expect(taken).toEqual(['p2'])
  })

  it('starts the next turn with a steer that came too late', async () => {
    const { run, taken, methods } = await working(async (method) => {
      if (method !== 'turn/steer') return { turn: { id: 'turn-2' } }
      run.notification('turn/completed', { threadId: 't1', turn: { id: 'turn-1', status: 'completed' } })
      throw new Error('no active turn')
    })
    await run.send({ id: 'p2', text: 'noch was' })
    expect(methods()).toEqual(['thread/start', 'turn/steer', 'turn/start'])
    expect(taken).toEqual(['p2'])
  })

  it('knows its prompts again in their userMessage items', async () => {
    const { run, taken } = await working(async () => ({}))
    run.notification('item/started', { threadId: 't1', item: { type: 'userMessage', id: 'i1', clientId: 'p3', content: [] } })
    expect(taken).toEqual(['p3'])
  })
})

describe('CodexRun.connect', () => {
  it("starts the thread with the user's -c overrides, under Nexa's own server", async () => {
    const options: RunOptions = {
      sessionId: 's',
      cwd: 'F:\\app',
      permissionMode: 'ask',
      account: { accountId: 'codex', set: {}, unset: [] },
      instructions: '',
      mcp: { url: 'http://127.0.0.1:1/mcp', token: 't', allowed: [], ask: [] },
      extraArgs: ['-c', 'model_reasoning_effort=high', '-c', 'mcp_servers.nexa.url="elsewhere"', '--search'],
    }
    const request = vi.fn(async (_method: string, _params: Record<string, unknown>) => ({ thread: { id: 't1' } }))
    await new CodexRun({ alive: true, request } as unknown as CodexClient, options, sink, { add: () => {}, remove: () => {} }).connect()
    const config = request.mock.calls[0][1].config as Record<string, unknown>
    expect(config.model_reasoning_effort).toBe('high')
    expect(config['mcp_servers.nexa.url']).toBe('http://127.0.0.1:1/mcp')
  })
})

describe('CodexRun.title', () => {
  const options: RunOptions = { sessionId: 's', cwd: 'F:\\app', permissionMode: 'ask', account: { accountId: 'codex', set: {}, unset: [] }, instructions: '', extraArgs: [] }
  const titled = async (title: string | null) => {
    const request = vi.fn(async (method: string, _params: Record<string, unknown>) => (method === 'thread/start' ? { thread: { id: 't1' } } : {}))
    const run = new CodexRun({ alive: true, request } as unknown as CodexClient, options, sink, { add: () => {}, remove: () => {} }, async () => [], async () => title)
    await run.connect()
    return { run, calls: () => request.mock.calls.slice(1).map(([method, params]) => ({ method, params })) }
  }

  it('names the thread as the chat, so Codex lists it so too', async () => {
    const { run, calls } = await titled('Reise nach Kyoto')
    expect(await run.title('Plane eine Reise nach Kyoto')).toBe('Reise nach Kyoto')
    expect(calls()).toEqual([{ method: 'thread/name/set', params: { threadId: 't1', name: 'Reise nach Kyoto' } }])
  })

  it('leaves the thread without a title', async () => {
    const { run, calls } = await titled(null)
    expect(await run.title('hallo')).toBeNull()
    expect(calls()).toEqual([])
  })
})

describe('CodexRun.connect', () => {
  const options = (more: Partial<RunOptions>): RunOptions => ({ sessionId: 's', cwd: 'F:\\app', permissionMode: 'ask', account: { accountId: 'codex', set: {}, unset: [] }, instructions: '', extraArgs: [], ...more })
  const connect = async (more: Partial<RunOptions>, answer: (method: string, params: Record<string, unknown>) => Promise<unknown>) => {
    const request = vi.fn(answer)
    const run = new CodexRun({ alive: true, request } as unknown as CodexClient, options(more), sink, { add: () => {}, remove: () => {} })
    await run.connect()
    return { run, calls: request.mock.calls.map(([method, params]) => ({ method, params })) }
  }
  const thread = async () => ({ thread: { id: 'neu' } })

  it('resumes the chat’s own thread', async () => {
    const { calls } = await connect({ resumeId: 't1' }, thread)
    expect(calls).toMatchObject([{ method: 'thread/resume', params: { threadId: 't1', excludeTurns: true } }])
  })

  it('forks another chat’s thread through its last turn', async () => {
    const { run, calls } = await connect({ resumeId: 't1', fork: { at: 'turn-3' } }, thread)
    expect(calls).toMatchObject([{ method: 'thread/fork', params: { threadId: 't1', lastTurnId: 'turn-3' } }])
    expect(run.threadId).toBe('neu')
  })

  it('forks all of it when the thread doesn’t know the turn', async () => {
    const { calls } = await connect({ resumeId: 't1', fork: { at: 'fremd' } }, async (_method, params) => {
      if (params.lastTurnId) throw new Error('unknown turn')
      return { thread: { id: 'neu' } }
    })
    expect(calls.map((c) => c.method)).toEqual(['thread/fork', 'thread/fork'])
    expect(calls[1]!.params.lastTurnId).toBeUndefined()
  })

  it('says in words that another Codex has the thread open', async () => {
    const refuse = async () => {
      throw new Error('thread/resume failed: thread t1 already has an active writer')
    }
    await expect(connect({ resumeId: 't1' }, refuse)).rejects.toThrow('in Codex außerhalb von Nexa offen')
    const other = new Error('boom')
    expect(heldElsewhere(other)).toBe(other)
  })
})

describe('CodexRun.request', () => {
  const options: RunOptions = { sessionId: 's', cwd: 'F:\\app', permissionMode: 'ask', account: { accountId: 'codex', set: {}, unset: [] }, instructions: '', extraArgs: [], resumeId: 't1' }
  /** One app-server process with its run on thread t1; the chat's items go to `items`. */
  const server = async (items: ChatItem[]) => {
    const request = vi.fn(async () => ({ thread: { id: 't1' } }))
    const client = { alive: true, request, respond: vi.fn(), respondError: vi.fn() }
    const run = new CodexRun(client as unknown as CodexClient, options, { ...sink, item: (item) => items.push(item) }, { add: () => {}, remove: () => {} })
    await run.connect()
    return { run, client }
  }
  const approval = { id: 0, method: 'item/commandExecution/requestApproval', params: { threadId: 't1', itemId: 'cmd-1', command: 'npm test' } }

  it('asks anew after a restart, though the new app-server counts its request ids from 0 again', async () => {
    const items: ChatItem[] = []
    const before = await server(items)
    before.run.request(approval)
    await before.run.respond(items[0]!.id, { type: 'permission', decision: 'allow' })
    const after = await server(items)
    after.run.request({ ...approval, params: { ...approval.params, itemId: 'cmd-2' } })
    const asked = items.filter((i) => i.kind === 'interaction' && i.state === 'pending')
    expect(asked).toHaveLength(2)
    expect(asked[1]!.id).not.toBe(asked[0]!.id)
    await after.run.respond(asked[1]!.id, { type: 'permission', decision: 'deny' })
    expect(after.client.respond).toHaveBeenCalledWith(0, { decision: 'decline' })
  })
})

describe('unwrapShell', () => {
  it('takes the command out of PowerShell', () => {
    expect(unwrapShell(`"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'Get-Content -LiteralPath hello.txt'`)).toBe(
      'Get-Content -LiteralPath hello.txt',
    )
  })

  it('undoes PowerShell quoting', () => {
    expect(unwrapShell(`powershell.exe -NoProfile -Command 'Write-Output ''hi'''`)).toBe("Write-Output 'hi'")
    expect(unwrapShell(`pwsh -Command "Add-Content x.txt -Value \`"a\`""`)).toBe('Add-Content x.txt -Value "a"')
  })

  it('finds a shell in a folder with spaces', () => {
    expect(unwrapShell(`"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command 'git status'`)).toBe('git status')
  })

  it('takes the command out of bash and cmd', () => {
    expect(unwrapShell(`/bin/bash -lc 'ls -la src'`)).toBe('ls -la src')
    expect(unwrapShell(`bash -c "echo \\"hi\\""`)).toBe('echo "hi"')
    expect(unwrapShell(`cmd.exe /d /c "dir /b"`)).toBe('dir /b')
  })

  it('leaves other commands alone', () => {
    expect(unwrapShell('git status')).toBe('git status')
    expect(unwrapShell('node -c script.js')).toBe('node -c script.js')
  })
})

describe('commandView', () => {
  const ps = (inner: string) => `"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command '${inner}'`

  it('shows a read as reading the file', () => {
    const view = commandView(ps('Get-Content README.md'), [{ type: 'read', command: 'Get-Content README.md', name: 'README.md', path: 'C:/p/README.md' }])
    expect(view).toEqual({ tool: 'read', title: 'Datei lesen', detail: 'C:/p/README.md', command: 'Get-Content README.md' })
  })

  it('shows searches and listings', () => {
    expect(commandView('rg foo src', [{ type: 'search', command: 'rg foo src', query: 'foo', path: 'src' }])).toMatchObject({
      tool: 'search',
      title: 'Suchen',
      detail: 'foo in src',
    })
    expect(commandView('ls', [{ type: 'listFiles', command: 'ls', path: 'src' }])).toMatchObject({ tool: 'search', detail: 'src' })
  })

  it('shows anything else as the plain command', () => {
    expect(commandView(ps('npm test'), [{ type: 'unknown', command: 'npm test' }])).toEqual({
      tool: 'bash',
      title: 'Befehl ausführen',
      detail: 'npm test',
      command: 'npm test',
    })
    expect(commandView(ps('npm test'), undefined).command).toBe('npm test')
  })

  it('joins several actions', () => {
    const view = commandView('x', [
      { type: 'read', command: 'cat a', name: 'a', path: 'a' },
      { type: 'unknown', command: 'npm test' },
    ])
    expect(view).toMatchObject({ tool: 'bash', command: 'cat a && npm test' })
  })
})

describe('codexMcpConfig', () => {
  const mcp = { url: 'http://127.0.0.1:4100/mcp', token: 'abc', allowed: ['render_chart', 'browser_click'], ask: ['browser_evaluate'] }

  it('gives each thread its own token, so the server knows its chat', () => {
    const config = codexMcpConfig(mcp, 'ask') as Record<string, unknown>
    expect(config['mcp_servers.nexa.url']).toBe(mcp.url)
    expect(config['mcp_servers.nexa.http_headers']).toEqual({ Authorization: 'Bearer abc' })
    expect(config['mcp_servers.nexa.tool_timeout_sec']).toBeGreaterThan(60)
  })

  it('runs the allowed tools without asking and asks for the sensitive ones', () => {
    const config = codexMcpConfig(mcp, 'auto') as Record<string, unknown>
    expect(config['mcp_servers.nexa.tools']).toEqual({
      render_chart: { approval_mode: 'approve' },
      browser_click: { approval_mode: 'approve' },
      browser_evaluate: { approval_mode: 'prompt' },
    })
  })

  it('asks for nothing with full permissions', () => {
    const config = codexMcpConfig(mcp, 'full') as Record<string, unknown>
    expect(config['mcp_servers.nexa.tools']).not.toHaveProperty('browser_evaluate')
  })
})

describe('skillInputs', () => {
  const skills = [
    { name: 'pdf', kind: 'skill' as const, insert: '$pdf', path: '/skills/pdf/SKILL.md' },
    { name: 'deploy.prod', kind: 'skill' as const, insert: '$deploy.prod', path: '/skills/deploy/SKILL.md' },
    { name: 'nopath', kind: 'skill' as const, insert: '$nopath' },
  ]

  it('adds the skills named with $ to the input', () => {
    expect(skillInputs('$pdf lies das und dann $deploy.prod', skills)).toEqual([
      { type: 'skill', name: 'pdf', path: '/skills/pdf/SKILL.md' },
      { type: 'skill', name: 'deploy.prod', path: '/skills/deploy/SKILL.md' },
    ])
  })

  it('ignores prices, unknown names and skills without a file', () => {
    expect(skillInputs('kostet 5$pdf, $unbekannt, $nopath', skills)).toEqual([])
  })
})
