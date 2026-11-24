import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { posix } from 'node:path'
import type * as Pty from 'node-pty'
import type { TerminalBuffer, TerminalInfo, TerminalSize } from '@shared/terminals'
import type { UserShell } from '@shared/types'
import type { AccountEnv } from '../accounts/account-env'
import { TypedEmitter } from '../lib/typed-emitter'
import { cliEnv } from '../providers/cli-binary'
import { findOnPath, gitBash } from './user-shells'

/** How the user's terminal starts: an interactive shell, not a command. */
export interface TerminalLaunch {
  /** For the tab: „PowerShell 7“, „Git Bash“, „zsh“ … */
  name: string
  file: string
  args: string[]
  env?: Record<string, string>
}

type Exists = (path: string) => boolean

/**
 * The interactive shell of the settings (Windows), the same as for `!` in the composer, or the user's
 * login shell (elsewhere). Throws when the chosen shell isn't installed.
 */
export function terminalLaunch(
  choice: UserShell,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: Exists = existsSync,
): TerminalLaunch {
  if (platform !== 'win32') {
    let shell = env.SHELL
    if (!shell) {
      try {
        shell = userInfo().shell ?? undefined
      } catch {
        // No entry in the user database.
      }
    }
    shell ||= exists('/bin/bash') ? '/bin/bash' : '/bin/sh'
    return { name: posix.basename(shell), file: shell, args: ['-l'] }
  }
  if (choice === 'gitbash') {
    const bash = gitBash(env, exists)
    if (!bash) throw new Error('Git Bash ist nicht installiert (Git for Windows). In den Einstellungen unter Chat lässt sich eine andere Shell wählen.')
    // Without CHERE_INVOKING, Git Bash's profile changes to the home folder.
    return { name: 'Git Bash', file: bash, args: ['--login', '-i'], env: { CHERE_INVOKING: '1' } }
  }
  if (choice === 'cmd') return { name: 'cmd', file: env.ComSpec || 'cmd.exe', args: [] }
  const pwsh = findOnPath('pwsh.exe', env, platform, exists)
  return { name: pwsh ? 'PowerShell 7' : 'Windows PowerShell', file: pwsh ?? 'powershell.exe', args: ['-NoLogo'] }
}

/** Where a chat's terminal starts, and as which account. */
export interface TerminalTarget {
  cwd: string
  /** The environment of the chat's account; null: the app's own. */
  env: AccountEnv | null
  /** The account's name for the tab; null for the standard account. */
  account: string | null
}

/** Output kept per terminal for a view that comes later (a reload, another window), in characters. */
const MAX_BUFFER = 512 * 1024
/** Output goes to the window at most this often: a shell writes in many small pieces. */
const FLUSH_MS = 8

interface Entry {
  info: TerminalInfo
  pty: Pty.IPty | null
  /** The end of all it wrote, for a new view. */
  output: string
  /** Characters of all it wrote; the window drops what it got with the buffer already. */
  total: number
  /** Written since the last flush. */
  pending: string
  timer: NodeJS.Timeout | null
  /** Ended by the user: it goes at once, whatever its exit code. */
  killed: boolean
}

let ptyModule: typeof Pty | undefined

/**
 * node-pty is native and loaded with the first terminal. When it can't be loaded (a Linux with an
 * older glibc than it was built for), only the terminal fails, with the reason; as an import the app
 * wouldn't start at all.
 */
async function loadPty(): Promise<typeof Pty> {
  if (ptyModule) return ptyModule
  try {
    ptyModule = await import('node-pty')
    return ptyModule
  } catch (error) {
    console.error('[terminals] node-pty could not be loaded', error)
    throw new Error(`Das Terminal kann nicht starten, node-pty lässt sich nicht laden: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function clampSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(2, Math.min(1000, Math.floor(value)))
}

/**
 * The user's terminals beside the chats: a shell each in a pseudo console, in the chat's folder and
 * with the environment of its account, so `claude` or `codex` typed there use the chat's login. They
 * run on when the chat is left or the panel closed, and end when their chat goes or Nexa quits. A
 * shell that exits with 0 (`exit`) takes its terminal along; one that fails stays to be read.
 */
export class Terminals extends TypedEmitter<{ data: [id: string, data: string, end: number]; changed: [TerminalInfo[]] }> {
  private readonly entries = new Map<string, Entry>()
  private disposed = false
  private seq = 0

  constructor(
    /** Where a chat's terminal starts; throws for a chat that is gone. */
    private readonly target: (sessionId: string) => TerminalTarget,
    /** The shell of the settings; throws when it isn't installed. */
    private readonly launch: () => TerminalLaunch,
    private readonly pty: () => Promise<Pick<typeof Pty, 'spawn'>> = loadPty,
  ) {
    super()
  }

  list(): TerminalInfo[] {
    return [...this.entries.values()].map((e) => ({ ...e.info }))
  }

  async create(sessionId: string, size: TerminalSize): Promise<TerminalInfo> {
    if (this.disposed) throw new Error('Nexa wird beendet.')
    const target = this.target(sessionId)
    if (!isDirectory(target.cwd)) throw new Error(`Den Ordner des Chats gibt es nicht mehr: ${target.cwd}`)
    const launch = this.launch()
    const pty = await this.pty()
    const env = cliEnv({ ...target.env?.set, ...launch.env, COLORTERM: 'truecolor' }, target.env?.unset ?? [])
    const proc = pty.spawn(launch.file, launch.args, {
      name: 'xterm-256color',
      cols: clampSize(size?.cols, 80),
      rows: clampSize(size?.rows, 24),
      cwd: target.cwd,
      env,
      useConpty: true,
    })
    const info: TerminalInfo = {
      id: `t${Date.now().toString(36)}${(++this.seq).toString(36)}`,
      sessionId,
      shell: launch.name,
      cwd: target.cwd,
      account: target.account,
      status: 'running',
      exitCode: null,
      createdAt: Date.now(),
    }
    const entry: Entry = { info, pty: proc, output: '', total: 0, pending: '', timer: null, killed: false }
    this.entries.set(info.id, entry)

    proc.onData((data) => {
      entry.output += data
      if (entry.output.length > MAX_BUFFER * 1.25) entry.output = trimStart(entry.output, MAX_BUFFER)
      entry.total += data.length
      entry.pending += data
      entry.timer ??= setTimeout(() => this.flush(entry), FLUSH_MS)
    })
    proc.onExit(({ exitCode }) => {
      this.flush(entry)
      entry.pty = null
      if (entry.killed || this.disposed) return
      if (exitCode === 0) {
        this.entries.delete(info.id)
      } else {
        info.status = 'exited'
        info.exitCode = exitCode
      }
      this.changed()
    })
    this.changed()
    return { ...info }
  }

  /** What the terminal wrote so far; what was still to be sent goes out first, so nothing comes twice. */
  buffer(id: string): TerminalBuffer {
    const entry = this.require(id)
    this.flush(entry)
    return { text: entry.output, end: entry.total }
  }

  write(id: string, data: string): void {
    if (typeof data !== 'string' || !data) return
    this.entries.get(id)?.pty?.write(data)
  }

  resize(id: string, size: TerminalSize): void {
    const proc = this.entries.get(id)?.pty
    if (!proc) return
    try {
      proc.resize(clampSize(size?.cols, proc.cols), clampSize(size?.rows, proc.rows))
    } catch {
      // It ended in between.
    }
  }

  /** Ends the shell and what runs in it, and drops the terminal. */
  kill(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.killed = true
    this.entries.delete(id)
    if (entry.timer) clearTimeout(entry.timer)
    end(entry.pty)
    entry.pty = null
    this.changed()
  }

  /** The chats there are now: the terminals of those that went end. */
  keepSessions(ids: ReadonlySet<string>): void {
    for (const entry of [...this.entries.values()]) if (!ids.has(entry.info.sessionId)) this.kill(entry.info.id)
  }

  dispose(): void {
    this.disposed = true
    for (const id of [...this.entries.keys()]) this.kill(id)
  }

  private require(id: string): Entry {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('Das Terminal gibt es nicht mehr.')
    return entry
  }

  private flush(entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    if (!entry.pending) return
    const data = entry.pending
    entry.pending = ''
    this.emit('data', entry.info.id, data, entry.total)
  }

  private changed(): void {
    this.emit('changed', this.list())
  }
}

/** The last `max` characters, from a line's start: a cut in an escape sequence would show as garbage. */
export function trimStart(text: string, max: number): string {
  const from = text.length - max
  if (from <= 0) return text
  const line = text.indexOf('\n', from)
  return text.slice(line >= 0 && line - from < 4096 ? line + 1 : from)
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Ends the shell with what it started: on Windows the tree under it (a dev server outlives its console otherwise). */
function end(proc: Pty.IPty | null): void {
  if (!proc) return
  if (process.platform === 'win32' && proc.pid) {
    spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {})
  }
  try {
    proc.kill()
  } catch {
    // Gone already.
  }
}
