import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { ResolvedCommand } from './cli-binary'

export interface JsonlProcessOptions {
  cwd: string
  env: Record<string, string>
  onMessage(message: unknown): void
  onExit(code: number | null, stderr: string): void
  /** Lines on stdout that aren't JSON (warnings some CLIs print). */
  onText?(line: string): void
}

/**
 * A CLI that speaks one JSON object per line over stdin and stdout: Claude Code's stream-json and
 * Codex's app-server. Keeps the end of stderr for the error message when the process dies.
 */
export class JsonlProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private stderr = ''
  private exited = false

  constructor(command: ResolvedCommand, private readonly options: JsonlProcessOptions) {
    this.child = spawn(command.file, command.args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.setEncoding('utf8')
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      let message: unknown
      try {
        message = JSON.parse(trimmed)
      } catch {
        options.onText?.(trimmed)
        return
      }
      try {
        options.onMessage(message)
      } catch (error) {
        console.error('[jsonl] handler failed', error)
      }
    })
    this.child.stderr.on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-8000)
    })
    this.child.on('error', (error) => {
      this.stderr += `\n${error.message}`
      this.finish(null)
    })
    this.child.on('exit', (code) => this.finish(code))
    // A write after the process died must not crash the app.
    this.child.stdin.on('error', () => undefined)
  }

  get alive(): boolean {
    return !this.exited
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  write(message: unknown): void {
    if (this.exited) throw new Error('Der Prozess der CLI läuft nicht mehr.')
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  /** Closes stdin, so the CLI ends on its own; killed if it doesn't within `graceMs`. */
  async stop(graceMs = 3000): Promise<void> {
    if (this.exited) return
    const done = new Promise<void>((resolve) => this.child.once('exit', () => resolve()))
    this.child.stdin.end()
    const timer = setTimeout(() => this.kill(), graceMs)
    await done
    clearTimeout(timer)
  }

  kill(): void {
    if (this.exited) return
    if (process.platform === 'win32' && this.child.pid) {
      // The CLI may have started children (shells, MCP servers): the whole tree goes.
      spawn('taskkill', ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    } else {
      this.child.kill('SIGTERM')
    }
  }

  private finish(code: number | null): void {
    if (this.exited) return
    this.exited = true
    this.options.onExit(code, this.stderr.trim())
  }
}
