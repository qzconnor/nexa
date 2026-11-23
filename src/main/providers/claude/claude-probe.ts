import { randomUUID } from 'node:crypto'
import type { CommandOption } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import type { AccountEnv } from '../../accounts/account-env'
import { cliEnv, type CliBinary } from '../cli-binary'
import { JsonlProcess } from '../jsonl-process'

type Json = Record<string, unknown>

const PROBE_TIMEOUT_MS = 20_000

export interface ProbeOptions {
  cwd: string
  /** More arguments, e.g. `--model`. */
  args?: string[]
  /** Control requests asked after `initialize`, one after the other. */
  requests?: Json[]
  /** How long to wait after `initialize` before the other requests (MCP servers connect meanwhile). */
  delayMs?: number
  /**
   * How long the process stays after the answers: Claude Code connects the MCP servers after
   * `initialize` and reports the commands again with their prompts (`system/commands_changed`).
   */
  watchMs?: number
  onCommands?: (raw: unknown) => void
}

/**
 * A short Claude Code process that gets no prompt, so it costs no tokens: it answers `initialize` and
 * the control requests asked after it, then ends. The answers in order (`initialize` first); null when
 * it failed or took too long.
 */
export function probeClaude(binary: CliBinary, account: AccountEnv, options: ProbeOptions): Promise<Json[] | null> {
  return new Promise((resolve) => {
    const requests: Json[] = [{ subtype: 'initialize' }, ...(options.requests ?? [])]
    const answers: Json[] = []
    let proc: JsonlProcess | null = null
    let id = ''
    let settled = false
    let watchTimer: ReturnType<typeof setTimeout> | undefined
    const end = () => {
      clearTimeout(watchTimer)
      if (proc?.alive) void proc.stop(1000)
    }
    const settle = (result: Json[] | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
      if (result && options.watchMs) watchTimer = setTimeout(end, options.watchMs)
      else end()
    }
    const ask = () => {
      id = randomUUID()
      proc?.write({ type: 'control_request', request_id: id, request: requests[answers.length] })
    }
    const timer = setTimeout(() => settle(null), PROBE_TIMEOUT_MS)
    try {
      proc = new JsonlProcess(
        binary.command(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', ...(options.args ?? [])]),
        {
          cwd: options.cwd,
          env: cliEnv(account.set, account.unset),
          onMessage: (m) => {
            if (!isPlainObject(m)) return
            if (m.type === 'system' && m.subtype === 'commands_changed') {
              options.onCommands?.(m.commands)
              return
            }
            if (settled || m.type !== 'control_response' || !isPlainObject(m.response) || m.response.request_id !== id) return
            answers.push(isPlainObject(m.response.response) ? m.response.response : {})
            if (answers.length === requests.length) settle(answers)
            else if (answers.length === 1 && options.delayMs) setTimeout(ask, options.delayMs)
            else ask()
          },
          onExit: () => {
            clearTimeout(watchTimer)
            settle(null)
          },
        },
      )
      ask()
    } catch {
      settle(null)
    }
  })
}

/**
 * Commands of Claude Code that only make sense in its terminal, or that Nexa does itself (model,
 * effort, title, a new chat): left out of the composer's list.
 */
const LEFT_OUT = new Set(['clear', 'color', 'focus', 'heapdump', 'model', 'effort', 'rename', 'extra-usage', 'agents', 'workflow-launch-exec'])

/** Claude Code's commands (`initialize`, `commands_changed`) as the composer offers them. */
export function claudeCommands(raw: unknown): CommandOption[] | null {
  if (!Array.isArray(raw)) return null
  const commands: CommandOption[] = []
  for (const c of raw) {
    if (!isPlainObject(c) || typeof c.name !== 'string' || !c.name || c.name.startsWith('__') || LEFT_OUT.has(c.name)) continue
    // An MCP server's prompt is called by its name with `(MCP)`, as the CLI lists it.
    const mcp = c.name.endsWith(' (MCP)')
    commands.push({
      name: mcp ? c.name.slice(0, -' (MCP)'.length) : c.name,
      description: typeof c.description === 'string' && c.description ? c.description : undefined,
      argumentHint: typeof c.argumentHint === 'string' && c.argumentHint ? c.argumentHint : undefined,
      aliases: Array.isArray(c.aliases) ? c.aliases.filter((a): a is string => typeof a === 'string') : undefined,
      kind: mcp ? 'mcp' : 'command',
      insert: `/${c.name}`,
    })
  }
  return commands
}
