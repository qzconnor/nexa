import type { Json } from './codex-items'

/** What a config key of Codex looks like (dotted, as `mcp_servers.<name>.enabled`); TOML's quoted keys stay out. */
const KEY = /^[\w-]+(?:\.[\w-]+)*$/

/**
 * Codex's config overrides from a command line (`-c key=value`, `--config key=value`) as a thread's
 * config: one app-server serves all chats of an account, so what `nx -- …` asks of Codex for one chat
 * goes with its thread instead of the process. `rest`: the arguments that are none, as given.
 */
export function codexOverrides(args: readonly string[]): { config: Json; rest: string[] } {
  const config: Json = {}
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const inline = /^--config=(.*)$/s.exec(arg)?.[1]
    const separate = arg === '-c' || arg === '--config'
    const pair = inline ?? (separate ? args[i + 1] : undefined)
    const at = pair?.indexOf('=') ?? -1
    const key = pair && at > 0 ? pair.slice(0, at).trim() : ''
    if (!pair || !KEY.test(key)) {
      rest.push(arg)
      continue
    }
    if (separate) i++
    config[key] = tomlValue(pair.slice(at + 1))
  }
  return { config, rest }
}

/**
 * Codex reads a value as TOML and takes the text as it is where that fails. JSON stands in for TOML
 * here (numbers, true/false, "text", arrays, objects); 'text' is TOML's literal string.
 */
function tomlValue(text: string): unknown {
  const value = text.trim()
  if (/^'[^']*'$/.test(value)) return value.slice(1, -1)
  try {
    const parsed: unknown = JSON.parse(value)
    // TOML has no null: Codex would keep the word.
    return parsed === null ? text : parsed
  } catch {
    return text
  }
}
