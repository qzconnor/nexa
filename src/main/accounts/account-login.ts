import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AccountLoginState } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import { TypedEmitter } from '../lib/typed-emitter'
import { cliEnv, type ResolvedCommand } from '../providers/cli-binary'
import type { AccountEnv } from './account-env'

/** A login nobody finishes ends after this long (the CLI's local callback server would keep a port). */
const LOGIN_TIMEOUT_MS = 10 * 60_000

/** Removes colors and terminal links (OSC 8): Claude Code prints its link as one. */
export function plainOutput(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
}

/** The login page in a CLI's output: the first https address (Codex names its local server with http first). */
export function loginUrlOf(output: string): string | null {
  const match = /https:\/\/[^\s"'<>]+/.exec(plainOutput(output))
  return match ? match[0].replace(/[.,;)]+$/, '') : null
}

/** The last lines of the output, for a failed login. */
function failureOf(output: string, code: number | null): string {
  const lines = plainOutput(output)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^https?:\/\//.test(l) && !/Paste code here/i.test(l))
  return lines.slice(-3).join('\n') || `Die Anmeldung wurde beendet (Code ${code ?? '?'}).`
}

interface Running {
  provider: ProviderId
  child: ChildProcessWithoutNullStreams
  state: AccountLoginState
  output: string
  timer: NodeJS.Timeout
}

type Events = {
  state: [state: AccountLoginState]
}

/**
 * Browser logins of accounts: `claude auth login` and `codex login`, started with the account's
 * config folder and without a terminal. The CLI opens the browser and waits for its callback; Nexa
 * shows the link from its output and, for Claude Code, passes on a code pasted from the browser.
 */
export class AccountLogins extends TypedEmitter<Events> {
  private readonly running = new Map<string, Running>()

  /** The state of every login that runs. */
  list(): AccountLoginState[] {
    return [...this.running.values()].map((r) => ({ ...r.state }))
  }

  start(provider: ProviderId, command: ResolvedCommand, env: AccountEnv): AccountLoginState {
    const accountId = env.accountId
    this.cancel(accountId)
    // Codex's callback server has a fixed port: one Codex login at a time.
    if (provider === 'codex') for (const [id, r] of this.running) if (r.provider === 'codex') this.cancel(id)

    const child = spawn(command.file, command.args, {
      env: cliEnv(env.set, env.unset),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const state: AccountLoginState = { accountId, status: 'starting', url: null, message: null, acceptsCode: false }
    const entry: Running = {
      provider,
      child,
      state,
      output: '',
      timer: setTimeout(() => this.finish(accountId, child, 'failed', 'Die Anmeldung hat zu lange gedauert. Bitte erneut starten.'), LOGIN_TIMEOUT_MS),
    }
    this.running.set(accountId, entry)

    const onData = (chunk: Buffer) => {
      if (this.running.get(accountId)?.child !== child) return
      entry.output = (entry.output + chunk.toString('utf8')).slice(-16_000)
      const url = state.url ?? loginUrlOf(entry.output)
      const acceptsCode = state.acceptsCode || /Paste code here/i.test(entry.output)
      if (url !== state.url || acceptsCode !== state.acceptsCode) {
        state.url = url
        state.acceptsCode = acceptsCode
        if (url) state.status = 'waiting'
        this.emit('state', { ...state })
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.stdin.on('error', () => undefined)
    child.on('error', (error) => this.finish(accountId, child, 'failed', error.message))
    child.on('exit', (code) => {
      if (code === 0) this.finish(accountId, child, 'success', null)
      else this.finish(accountId, child, 'failed', failureOf(entry.output, code))
    })
    this.emit('state', { ...state })
    return { ...state }
  }

  /** A code the browser showed (when its redirect couldn't reach Claude Code). */
  sendCode(accountId: string, code: string): void {
    const entry = this.running.get(accountId)
    const value = code.trim()
    if (!entry || !value || entry.state.status === 'success' || entry.state.status === 'failed') {
      throw new Error('Die Anmeldung läuft nicht mehr. Bitte erneut starten.')
    }
    entry.child.stdin.write(`${value}\n`)
  }

  cancel(accountId: string): void {
    const entry = this.running.get(accountId)
    if (entry) this.finish(accountId, entry.child, 'cancelled', null)
  }

  dispose(): void {
    for (const id of [...this.running.keys()]) this.cancel(id)
  }

  private finish(accountId: string, child: ChildProcessWithoutNullStreams, status: AccountLoginState['status'], message: string | null): void {
    const entry = this.running.get(accountId)
    if (!entry || entry.child !== child) return
    clearTimeout(entry.timer)
    this.running.delete(accountId)
    if (child.exitCode === null) child.kill()
    this.emit('state', { ...entry.state, status, message })
  }
}
