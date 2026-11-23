import type { ChatItem } from '@shared/chat'

/**
 * The prompts sent into a running answer that the agent hasn't come to yet: those after the main
 * chat's last turn end, while the chat still works. Once the turn they cut into is through, they
 * read as any other prompt.
 */
export function pendingSteers(items: readonly ChatItem[], busy: boolean): Set<string> {
  const pending = new Set<string>()
  if (!busy) return pending
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item.kind === 'turn' && !item.parentId) break
    if (item.kind === 'user' && item.steer) pending.add(item.id)
  }
  return pending
}
