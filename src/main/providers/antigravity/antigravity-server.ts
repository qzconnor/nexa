import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isPlainObject } from '@shared/utils'
import type { McpServerState } from '../provider'

/**
 * The local server every `agy acp` runs in its own process once it has a session (Antigravity's
 * language server): it knows how the MCP servers are, which ACP doesn't say (docs/PROTOCOLS.md,
 * „Antigravity CLI“, „Zustand der MCP-Server“). Its port is in the process's log; calls need the token
 * Nexa gives the process at its start, as its CSRF header. Not a documented interface: whatever fails
 * here leaves the „+“ menu with what the files say.
 */

/** The variable that sets the token of the local server; without it the process picks one of its own. */
export const AGY_SERVER_TOKEN_ENV = 'ANTIGRAVITY_SERVER_CSRF_TOKEN'
const SERVICE = '/exa.language_server_pb.LanguageServerService/'
const CALL_MS = 3000
/** The port is logged soon after the session began; the log grows with the conversation. */
const LOG_HEAD = 1024 * 1024

/**
 * The log of the process `pid` in the account's log folder: `acp-server-<time>-<pid>.log`, the newest
 * should Windows have given the number to an earlier process too. Null for a process started through
 * a wrapper (`agy.cmd`), whose number isn't agy's.
 */
export async function agyLogOf(logDir: string, pid: number | undefined): Promise<string | null> {
  if (!pid) return null
  const names = (await readdir(logDir).catch(() => [] as string[])).filter((name) => name.startsWith('acp-server-') && name.endsWith(`-${pid}.log`))
  const dated = await Promise.all(names.map(async (name) => ({ file: join(logDir, name), at: (await stat(join(logDir, name)).catch(() => null))?.mtimeMs ?? 0 })))
  return dated.sort((a, b) => b.at - a.at)[0]?.file ?? null
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** The HTTP port in the log (`Language server listening on random port at 50991 for HTTP`), not the one for HTTPS. */
export function agyServerPort(log: string): number | null {
  const match = /listening on random port at (\d{2,5}) for HTTP[ \t]*\r?$/m.exec(log)
  const port = match ? Number(match[1]) : Number.NaN
  return port > 0 && port < 65536 ? port : null
}

export class AgyLocalServer {
  private port: number | null = null

  constructor(
    /** Where the process logs; asked again until the port is in it. */
    private readonly logFile: () => Promise<string | null>,
    private readonly token: string,
    private readonly fetcher: Fetch = fetch,
  ) {}

  /** A method of the language server (Connect over HTTP with JSON). */
  async call(method: string, body: object = {}): Promise<unknown> {
    this.port ??= await this.findPort()
    if (!this.port) throw new Error('Den lokalen Server von Antigravity CLI hat Nexa nicht gefunden.')
    const response = await this.fetcher(`http://127.0.0.1:${this.port}${SERVICE}${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'x-codeium-csrf-token': this.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_MS),
    })
    if (!response.ok) throw new Error(`Antigravity CLI antwortet mit ${response.status}.`)
    return response.json()
  }

  private async findPort(): Promise<number | null> {
    const file = await this.logFile()
    const handle = file ? await open(file, 'r').catch(() => null) : null
    if (!handle) return null
    try {
      const buffer = Buffer.alloc(LOG_HEAD)
      const { bytesRead } = await handle.read(buffer, 0, LOG_HEAD, 0)
      return agyServerPort(buffer.subarray(0, bytesRead).toString('utf8'))
    } finally {
      await handle.close()
    }
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/**
 * The servers of the files with how they are, from `GetMcpServerStates`. A server switched off in its
 * file stays „Aus“ (Antigravity starts it all the same); one without a state (the folder's, which
 * Antigravity starts later if at all) stays „Eingerichtet“.
 */
export function withAgyMcpStates(list: McpServerState[], raw: unknown): McpServerState[] {
  const states = new Map<string, Record<string, unknown>>()
  for (const state of isPlainObject(raw) && Array.isArray(raw.states) ? raw.states.filter(isPlainObject) : []) {
    const name = isPlainObject(state.spec) ? str(state.spec.serverName) : undefined
    if (name) states.set(name, state)
  }
  return list.map((server): McpServerState => {
    const state = states.get(server.name)
    if (!state || server.status === 'disabled') return server
    switch (state.status) {
      case 'MCP_SERVER_STATUS_READY':
        return { ...server, status: 'connected', tools: Array.isArray(state.tools) ? state.tools.length : undefined }
      case 'MCP_SERVER_STATUS_ERROR':
        return { ...server, status: 'failed', error: str(state.error) }
      case 'MCP_SERVER_STATUS_PENDING':
        return { ...server, status: 'pending' }
      case 'MCP_SERVER_STATUS_DISABLED_BY_ADMIN':
        return { ...server, status: 'disabled', error: 'Von deiner Organisation abgeschaltet.' }
      default:
        return server
    }
  })
}
