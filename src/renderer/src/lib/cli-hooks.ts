import type { HookGroup, HookHandler } from '@shared/cli-config'

/**
 * Edits of one event's hooks, on the groups as the CLI's file has them. Each group and hook keeps its
 * `origin`, so main can lay the edit over what the file had and keep the keys Nexa doesn't edit.
 * Nothing here changes what it gets: the page saves the result and reads the file again.
 */

/** Where a hook is: its group and its place in the group. */
export interface HookAt {
  group: number
  index: number
}

/** What the hook dialog edits: a hook of an event (absent: a new one) under its matcher. */
export interface HookDraft {
  event: string
  matcher: string | null
  handler?: HookHandler
}

/** A matcher as the file keeps it: none for an empty one. */
export function normalMatcher(matcher: string | null | undefined): string | null {
  return matcher?.trim() || null
}

/** Without `trust`, which is what main read, not what it writes. */
function bare(handler: HookHandler): HookHandler {
  const { trust: _trust, ...rest } = handler
  return rest
}

function copy(groups: readonly HookGroup[]): HookGroup[] {
  return groups.map((g) => ({ ...g, hooks: g.hooks.map(bare) }))
}

/** A hook goes to the last group with its matcher, or to a new group at the end. */
export function addHook(groups: readonly HookGroup[], matcher: string | null, handler: HookHandler): HookGroup[] {
  const next = copy(groups)
  const wanted = normalMatcher(matcher)
  const group = next.findLast((g) => normalMatcher(g.matcher) === wanted)
  if (group) group.hooks.push(bare(handler))
  else next.push({ matcher: wanted, hooks: [bare(handler)] })
  return next
}

/** Without the hook at `at`; a group left without hooks goes. */
export function removeHook(groups: readonly HookGroup[], at: HookAt): HookGroup[] {
  const next = copy(groups)
  next[at.group]?.hooks.splice(at.index, 1)
  return next.filter((g) => g.hooks.length)
}

/**
 * The hook at `at` changed: in its place while the matcher stays, else in the group of the new matcher
 * (the last one, or a new one). It keeps its origin either way.
 */
export function updateHook(groups: readonly HookGroup[], at: HookAt, matcher: string | null, handler: HookHandler): HookGroup[] {
  const old = groups[at.group]
  const current = old?.hooks[at.index]
  if (!old || !current) return addHook(groups, matcher, handler)
  const changed: HookHandler = { ...bare(handler), origin: current.origin }
  if (normalMatcher(old.matcher) === normalMatcher(matcher)) {
    const next = copy(groups)
    next[at.group]!.hooks[at.index] = changed
    return next
  }
  return addHook(removeHook(groups, at), matcher, changed)
}
