import { execFile } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, extname, join } from 'node:path'
import { withoutAppImageEnv } from '../lib/linux'

/** Variables a parent Claude Code session injects: never passed on to the CLIs Nexa starts. */
const PARENT_SESSION_ENV = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SSE_PORT',
  'CLAUDE_PID',
  'CLAUDE_EFFORT',
]

/** Where a CLI is looked for. */
export interface CliSpec {
  /** File names in a folder, on Windows the best to start first. */
  names: { win32: string[]; posix: string[] }
  /** Install folders besides the PATH, in case the app was started without the user's PATH. */
  installDirs(home: string, isWin: boolean): string[]
  notFound: string
}

export interface ResolvedCommand {
  file: string
  args: string[]
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * What an npm shim (`codex.cmd` of `npm install -g`) starts: the package's script with node, or its
 * own executable. Started directly, without cmd.exe, so arguments arrive as they are.
 */
export function npmShimTarget(shim: string, content: string): ResolvedCommand | null {
  const match = /"%(?:~dp0|dp0%)\\([^"%]+?\.(?:c?js|mjs|exe))"\s*%\*/i.exec(content)
  if (!match) return null
  const target = join(dirname(shim), ...match[1].split('\\'))
  if (!isFile(target)) return null
  if (/\.exe$/i.test(target)) return { file: target, args: [] }
  const local = join(dirname(shim), 'node.exe')
  const node = isFile(local) ? local : findInPath(['node.exe'])
  return node ? { file: node, args: [target] } : null
}

function findInPath(names: string[], extraDirs: string[] = []): string | null {
  const dirs = [...(process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean), ...extraDirs]
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

/** An agent CLI on disk: where it is, its version, and how it is started. */
export class CliBinary {
  private cached: { path: string | null; at: number } | undefined

  constructor(
    private readonly spec: CliSpec,
    private readonly configuredPath: () => string,
  ) {}

  invalidate(): void {
    this.cached = undefined
  }

  resolve(): string | null {
    const configured = this.configuredPath().trim()
    if (configured) return isFile(configured) ? configured : null
    if (this.cached && (this.cached.path ? isFile(this.cached.path) : Date.now() - this.cached.at < 15_000)) return this.cached.path
    const isWin = process.platform === 'win32'
    const home = homedir()
    const extra = this.spec.installDirs(home, isWin)
    if (!isWin) extra.push(join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'), '/usr/local/bin', '/usr/bin', '/opt/homebrew/bin')
    const path = findInPath(isWin ? this.spec.names.win32 : this.spec.names.posix, extra)
    this.cached = { path, at: Date.now() }
    return path
  }

  /** The command that starts the CLI with these arguments. Throws when it isn't installed. */
  command(args: string[]): ResolvedCommand {
    const exe = this.resolve()
    if (!exe) throw new Error(this.spec.notFound)
    const ext = extname(exe).toLowerCase()
    if (process.platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
      let content = ''
      try {
        content = readFileSync(exe, 'utf8')
      } catch {
        // Read below as no shim.
      }
      const shim = npmShimTarget(exe, content)
      if (shim) return { file: shim.file, args: [...shim.args, ...args] }
      throw new Error(`${exe} ist ein Batch-Skript, das Nexa nicht direkt starten kann. Trage den Pfad zur .exe in den Einstellungen ein.`)
    }
    return { file: exe, args }
  }

  /** Runs the CLI and returns its standard output, null when it fails. */
  run(args: string[], timeout = 15_000, env: Record<string, string> = cliEnv()): Promise<string | null> {
    let cmd: ResolvedCommand
    try {
      cmd = this.command(args)
    } catch {
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      execFile(cmd.file, cmd.args, { timeout, windowsHide: true, env }, (error, stdout) => resolve(error ? null : stdout))
    })
  }

  /**
   * Runs the CLI in a folder and returns what it wrote, also when it failed (commands with `--json`
   * tell why on standard output and exit with an error). `input` goes to its standard input.
   */
  output(
    args: string[],
    options: { cwd: string; env: Record<string, string>; timeout?: number; input?: string },
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    let cmd: ResolvedCommand
    try {
      cmd = this.command(args)
    } catch (error) {
      return Promise.resolve({ ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) })
    }
    return new Promise((resolve) => {
      const child = execFile(
        cmd.file,
        cmd.args,
        { cwd: options.cwd, timeout: options.timeout ?? 30_000, windowsHide: true, env: options.env, maxBuffer: 16 * 1024 * 1024 },
        (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }),
      )
      if (options.input === undefined) return
      // A CLI that doesn't read its input mustn't fail the call by closing the pipe early.
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(options.input)
    })
  }

  async version(): Promise<string | null> {
    const out = await this.run(['--version'])
    if (out === null) return null
    const match = /(\d+\.\d+\.\d+[^\s]*)/.exec(out)
    return match ? match[1] : out.trim() || null
  }
}

/**
 * The environment for a CLI: the app's, without what would make it think it runs inside another
 * session, with `extra` added and the variables in `unset` removed (an account's login, see accounts/).
 */
export function cliEnv(extra: Record<string, string> = {}, unset: readonly string[] = []): Record<string, string> {
  const env: Record<string, string> = {}
  const removed = new Set(unset.map((key) => key.toUpperCase()))
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (PARENT_SESSION_ENV.includes(key) || removed.has(key.toUpperCase())) continue
    if (/^(ELECTRON_|VSCODE_)/.test(key)) continue
    env[key] = value
  }
  return { ...withoutAppImageEnv(env), ...QUIET_CLI_ENV, ...extra }
}

/**
 * Set for every CLI Nexa starts, and so for what their agents run as well. Antigravity CLI's own
 * updater (agy 1.5.17, `auto_updater.go`) starts a process of its own with a new console whenever
 * its last check is older than its window: on Windows that console popped up as a terminal window
 * beside Nexa, mostly at Nexa's start, which runs `agy -p /usage`. Only `true` switches it off,
 * `1` doesn't. agy still updates itself when it runs in a terminal, and with `agy update`.
 */
const QUIET_CLI_ENV: Record<string, string> = { AGY_CLI_DISABLE_AUTO_UPDATE: 'true' }
