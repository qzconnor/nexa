import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { posix, win32 } from 'node:path'
import type { UserShell } from '@shared/types'
import { consoleDecoder, knownConsoleDecoder } from '../lib/console-code-page'
import { decodeText } from '../lib/text-encoding'

/** How a command typed after `!` in the composer runs: which program, with which arguments. */
export interface ShellLaunch {
  /** For the chat: „PowerShell 7“, „Git Bash“, „zsh“ … */
  name: string
  file: string
  args: string[]
  /** Set for the process besides the app's own environment. */
  env?: Record<string, string>
  /** The arguments go to the program as they are (cmd parses its command line itself). */
  verbatim?: boolean
  /** Written to the program's input, which then closes (else it has none). */
  stdin?: string
}

type Exists = (path: string) => boolean

/** A program on the PATH, with its full path; null when none is there. */
export function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: Exists = existsSync): string | null {
  const path = platform === 'win32' ? win32 : posix
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const full = path.join(dir, name)
    if (exists(full)) return full
  }
  return null
}

/** Git for Windows' bash: next to the git on the PATH, else where its installer puts it. */
export function gitBash(env: NodeJS.ProcessEnv, exists: Exists): string | null {
  const git = findOnPath('git.exe', env, 'win32', exists)
  const candidates = [
    // <Git>\cmd\git.exe → <Git>\bin\bash.exe
    git ? win32.join(win32.dirname(win32.dirname(git)), 'bin', 'bash.exe') : null,
    env.ProgramFiles ? win32.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe') : null,
    env['ProgramFiles(x86)'] ? win32.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe') : null,
    env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe') : null,
  ]
  return candidates.find((c): c is string => !!c && exists(c)) ?? null
}

/**
 * How to run `command` in the shell the settings name (Windows) or the user's login shell (elsewhere).
 * Throws when the chosen shell isn't installed.
 */
export function shellLaunch(
  choice: UserShell,
  command: string,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: Exists = existsSync,
): ShellLaunch {
  if (platform !== 'win32') {
    const shell = env.SHELL || '/bin/bash'
    return { name: posix.basename(shell), file: shell, args: ['-c', command] }
  }
  if (choice === 'gitbash') {
    const bash = gitBash(env, exists)
    if (!bash) throw new Error('Git Bash ist nicht installiert (Git for Windows). In den Einstellungen unter Chat lässt sich eine andere Shell wählen.')
    // The command comes through the environment: Windows' quoting of arguments can't break it there.
    return { name: 'Git Bash', file: bash, args: ['-c', 'eval "$NEXA_COMMAND"'], env: { NEXA_COMMAND: command, CHERE_INVOKING: '1' } }
  }
  if (choice === 'cmd') {
    // /s takes the outer quotes off and leaves the command as typed. (No `chcp 65001`: without a
    // console it changes nothing; the output's DOS code page is read as such, see UserShells.)
    return { name: 'cmd', file: env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], verbatim: true }
  }
  const pwsh = findOnPath('pwsh.exe', env, platform, exists)
  // The command with the exit code of a program that failed, or of the command when it did.
  const script = [command, '$nexaOk = $?; if ($LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $nexaOk) { exit 1 }'].join('\n')
  // One line on stdin: -EncodedCommand would be simpler, but with it Windows PowerShell writes its
  // errors as CLIXML. Encoded in it, the command comes through whole (multi-line, umlauts, quotes);
  // around it UTF-8 out (5.1 writes the console's code page otherwise) and no progress bars.
  const line = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
    "$ProgressPreference = 'SilentlyContinue'",
    `. ([scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${Buffer.from(script, 'utf16le').toString('base64')}'))))`,
  ].join('; ')
  return {
    name: pwsh ? 'PowerShell 7' : 'Windows PowerShell',
    file: pwsh ?? 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
    stdin: `${line}\n`,
  }
}

export interface ShellSink {
  /** All output so far, decoded (its start cut off once it grows past what is kept). */
  output(text: string): void
  /** The process ended: with its exit code, `stopped` by the user, or `error` when it couldn't start. */
  exit(result: { code: number | null; stopped: boolean; error?: string }): void
}

/** Raw output kept per command: a server that logs for hours mustn't fill the memory. */
const MAX_BYTES = 1024 * 1024
/** Output reaches the chat at most this often while the command runs. */
const FLUSH_MS = 250

interface Running {
  owner: string
  child: ChildProcess
  stopped: boolean
}

/**
 * The commands the user runs with `!` in the composer, each in its own process in the chat's folder,
 * without input (a command that asks for something fails instead of waiting for good). Nexa runs
 * them, not a CLI: the agent learns of them only through the next prompt, with secrets masked. The
 * start commands of the projects run the same way (start-commands.ts).
 */
export class UserShells {
  private readonly running = new Map<string, Running>()

  /** Starts `launch` for the command `itemId` (a chat's item, a start command) of `owner` (the chat, the project). */
  run(owner: string, itemId: string, launch: ShellLaunch, cwd: string, sink: ShellSink): void {
    // Lines of console programs aren't UTF-8 (see consoleDecoder); asked now, it has answered by their first output.
    void consoleDecoder()
    let child: ChildProcess
    try {
      child = spawn(launch.file, launch.args, {
        cwd,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', TERM: 'dumb', ...launch.env },
        stdio: [launch.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        windowsHide: true,
        windowsVerbatimArguments: launch.verbatim,
        // Its own process group elsewhere, so that stopping it ends what it started too.
        detached: process.platform !== 'win32',
      })
    } catch (error) {
      sink.exit({ code: null, stopped: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    if (launch.stdin !== undefined) {
      // A program that ended before reading it closes the pipe: nothing to report then.
      child.stdin?.on('error', () => {})
      child.stdin?.end(launch.stdin)
    }
    const entry: Running = { owner, child, stopped: false }
    this.running.set(itemId, entry)

    let chunks: Buffer[] = []
    let size = 0
    let timer: NodeJS.Timeout | null = null
    const flush = () => {
      timer = null
      sink.output(decodeText(Buffer.concat(chunks), knownConsoleDecoder()))
    }
    const take = (chunk: Buffer) => {
      chunks.push(chunk)
      size += chunk.length
      if (size > MAX_BYTES) {
        const all = Buffer.concat(chunks).subarray(size - MAX_BYTES)
        chunks = [all]
        size = all.length
      }
      timer ??= setTimeout(flush, FLUSH_MS)
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)

    let ended = false
    const end = (result: { code: number | null; stopped: boolean; error?: string }) => {
      if (ended) return
      ended = true
      this.running.delete(itemId)
      if (timer) clearTimeout(timer)
      if (size) flush()
      sink.exit(result)
    }
    child.once('error', (error) => end({ code: null, stopped: entry.stopped, error: error.message }))
    child.once('close', (code) => end({ code, stopped: entry.stopped }))
  }

  has(itemId: string): boolean {
    return this.running.has(itemId)
  }

  /** Whether a command of `owner` (a chat, a project) still runs. */
  runsFor(owner: string): boolean {
    for (const entry of this.running.values()) if (entry.owner === owner && !entry.stopped) return true
    return false
  }

  /** Ends the command and what it started. */
  stop(itemId: string): void {
    const entry = this.running.get(itemId)
    if (!entry) return
    entry.stopped = true
    kill(entry.child)
  }

  /** Ends the commands of a chat (it goes), or all (Nexa quits). */
  stopAll(owner?: string): void {
    for (const [itemId, entry] of this.running) {
      if (!owner || entry.owner === owner) this.stop(itemId)
    }
  }
}

function kill(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}
