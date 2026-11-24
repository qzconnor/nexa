/**
 * The filters (`filter.<name>.clean`/`process`) the repository's own config defines, from
 * `git config --show-scope --name-only --get-regexp ^filter\.`, switched off by environment
 * (`GIT_CONFIG_COUNT`, after the `existing` ones; a `-c` would break on a name with `=`): git runs
 * them on every changed file it compares. Those of the user's own config (global, system) stay.
 * `checkout`: also `smudge`, which a checkout runs on every file it writes (a new worktree).
 */
export function filterGuard(out: string | null, existing?: string, checkout = false): Record<string, string> {
  const names = new Set<string>()
  for (const line of (out ?? '').split('\n')) {
    const [scope, key] = line.replace(/\r$/, '').split('\t')
    if ((scope !== 'local' && scope !== 'worktree') || !key) continue
    const match = /^filter\.(.+)\.[^.]+$/s.exec(key)
    if (match) names.add(match[1]!)
  }
  const keys = [['clean', ''], ...(checkout ? [['smudge', '']] : []), ['process', ''], ['required', 'false']]
  const env: Record<string, string> = {}
  const first = Number(existing) || 0
  let count = first
  for (const name of names) {
    for (const [key, value] of keys) {
      env[`GIT_CONFIG_KEY_${count}`] = `filter.${name}.${key}`
      env[`GIT_CONFIG_VALUE_${count}`] = value!
      count++
    }
  }
  if (count > first) env.GIT_CONFIG_COUNT = String(count)
  return env
}
