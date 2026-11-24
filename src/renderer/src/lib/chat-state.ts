/** What a chat shows at a glance: its CLI works, waits for the user, finished while elsewhere, or failed. */
export type ChatState = 'running' | 'waiting' | 'unread' | 'error' | null

/** What the chats of a folded project, folder or separator show as one. */
export interface GroupState {
  /** One of them works. */
  running: boolean
  /** The most urgent of what the others want: an answer, a look at what failed, at what they finished. */
  signal: 'waiting' | 'error' | 'unread' | null
}

const URGENCY = ['waiting', 'error', 'unread'] as const

/**
 * Both at once when both are there: that one chat still works says nothing about another one having
 * finished meanwhile, which is what one opens the folder for.
 */
export function groupState(states: Iterable<ChatState>): GroupState {
  let running = false
  let signal: GroupState['signal'] = null
  for (const state of states) {
    if (state === 'running') running = true
    else if (state && (signal === null || URGENCY.indexOf(state) < URGENCY.indexOf(signal))) signal = state
  }
  return { running, signal }
}
