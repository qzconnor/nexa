import { isAbsolute, resolve } from 'node:path'
import type { ProviderId } from '@shared/chat'

/**
 * The `nx` command (src/launcher/nx.cs) starts the app with `--nx=<Base64>`: the caller's working
 * directory and its arguments, separated by NUL characters.
 */
const SWITCH = '--nx='

export interface LaunchRequest {
  cwd: string
  args: string[]
}

export interface LaunchCommand {
  /** Absolute folder of the chat. */
  dir: string
  /** Open the last chat of the folder instead of a new one. */
  continue: boolean
  provider: ProviderId | null
  /** Sent right away. */
  prompt: string | null
}

export function readLaunchRequest(argv: readonly string[]): LaunchRequest | null {
  const encoded = argv.find((arg) => arg.startsWith(SWITCH))?.slice(SWITCH.length)
  if (!encoded) return null
  const [cwd, ...args] = Buffer.from(encoded, 'base64').toString('utf8').split('\0')
  return cwd ? { cwd, args } : null
}

/** Checks data coming from another process (`second-instance`) before trusting its shape. */
export function isLaunchRequest(value: unknown): value is LaunchRequest {
  if (!value || typeof value !== 'object') return false
  const { cwd, args } = value as Record<string, unknown>
  return typeof cwd === 'string' && Array.isArray(args) && args.every((a) => typeof a === 'string')
}

export function parseLaunch(request: LaunchRequest): LaunchCommand {
  const command: LaunchCommand = { dir: request.cwd, continue: false, provider: null, prompt: null }
  let dir: string | null = null
  const args = request.args
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '-c':
      case '--continue':
        command.continue = true
        break
      case '--claude':
        command.provider = 'claude'
        break
      case '--codex':
        command.provider = 'codex'
        break
      case '-m':
      case '--message': {
        const value = args[++i]
        if (!value) throw new Error(`${arg} braucht einen Prompt.`)
        command.prompt = value
        break
      }
      default:
        if (arg.startsWith('-')) throw new Error(`Unbekannte Option „${arg}“. „nx --help“ zeigt, was geht.`)
        if (dir !== null) throw new Error(`Nur ein Ordner geht („${dir}“ und „${arg}“).`)
        dir = arg
    }
  }
  if (dir !== null) command.dir = isAbsolute(dir) ? dir : resolve(request.cwd, dir)
  return command
}
