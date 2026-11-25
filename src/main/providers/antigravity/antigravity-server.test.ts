import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServerState } from '../provider'
import { AgyLocalServer, agyLogOf, agyServerPort, withAgyMcpStates } from './antigravity-server'

// Lines as agy 1.5.17 logs them.
const LOG = [
  'I1125 15:24:43.763939      86 server.go:1328] Language server listening on random port at 50990 for HTTPS (gRPC)',
  'I1125 15:24:43.764452      86 server.go:1336] Language server listening on random port at 50991 for HTTP',
  '',
].join('\r\n')

describe('agyServerPort', () => {
  it('takes the HTTP port, not the one for gRPC', () => {
    expect(agyServerPort(LOG)).toBe(50991)
    expect(agyServerPort('Starting ACP server (pid 1)')).toBeNull()
  })
})

describe('agyLogOf and AgyLocalServer', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'nexa-agy-log-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('finds the newest log of the process', async () => {
    await writeFile(join(dir, 'acp-server-20261124_100000-4242.log'), 'old')
    await utimes(join(dir, 'acp-server-20261124_100000-4242.log'), new Date(2026, 10, 24), new Date(2026, 10, 24))
    await writeFile(join(dir, 'acp-server-20261125_154158-4242.log'), LOG)
    await writeFile(join(dir, 'acp-server-20261125_154158-14242.log'), 'other process')
    expect(await agyLogOf(dir, 4242)).toBe(join(dir, 'acp-server-20261125_154158-4242.log'))
    expect(await agyLogOf(dir, 7)).toBeNull()
    expect(await agyLogOf(dir, undefined)).toBeNull()
  })

  it('calls the local server with the token, once its port is logged', async () => {
    const log = join(dir, 'acp-server-1-4242.log')
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ states: [] })))
    const server = new AgyLocalServer(async () => log, 'secret', fetcher)
    await expect(server.call('GetMcpServerStates')).rejects.toThrow(/nicht gefunden/)
    await writeFile(log, LOG)
    await expect(server.call('GetMcpServerStates')).resolves.toEqual({ states: [] })
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:50991/exa.language_server_pb.LanguageServerService/GetMcpServerStates',
      expect.objectContaining({ method: 'POST', body: '{}', headers: expect.objectContaining({ 'x-codeium-csrf-token': 'secret' }) }),
    )
  })

  it('fails on an answer that isn’t ok', async () => {
    const log = join(dir, 'acp-server-1-4242.log')
    await writeFile(log, LOG)
    const server = new AgyLocalServer(async () => log, 'wrong', async () => new Response('{"code":"unauthenticated"}', { status: 401 }))
    await expect(server.call('GetMcpServerStates')).rejects.toThrow(/401/)
  })
})

describe('withAgyMcpStates', () => {
  const list: McpServerState[] = [
    { name: 'ok', status: 'configured', scope: 'user', enabled: true, switchIn: 'cli' },
    { name: 'bad', status: 'configured', scope: 'user', enabled: true, switchIn: 'cli' },
    { name: 'off', status: 'disabled', scope: 'user', enabled: false, switchIn: 'cli' },
    { name: 'local', status: 'configured', scope: 'project', enabled: true, switchIn: 'cli' },
  ]
  // GetMcpServerStates as agy 1.5.17 answered it, shortened.
  const states = {
    states: [
      { spec: { serverName: 'bad', command: 'nexa-does-not-exist-cmd' }, status: 'MCP_SERVER_STATUS_ERROR', error: '"nexa-does-not-exist-cmd" is not installed or not on PATH' },
      { spec: { serverName: 'off', disabled: true }, status: 'MCP_SERVER_STATUS_READY', tools: [{ name: 'off_hello' }] },
      { spec: { serverName: 'ok' }, status: 'MCP_SERVER_STATUS_READY', tools: [{ name: 'a' }, { name: 'b' }] },
    ],
  }

  it('tells how each server of the files is', () => {
    expect(withAgyMcpStates(list, states).map((s) => [s.name, s.status, s.tools ?? s.error ?? null])).toEqual([
      ['ok', 'connected', 2],
      ['bad', 'failed', '"nexa-does-not-exist-cmd" is not installed or not on PATH'],
      ['off', 'disabled', null],
      ['local', 'configured', null],
    ])
  })

  it('leaves the list as it is without states', () => {
    expect(withAgyMcpStates(list, null)).toEqual(list)
  })
})
