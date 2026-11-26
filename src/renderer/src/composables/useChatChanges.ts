import { inject, provide, type InjectionKey } from 'vue'

/**
 * What each prompt of the chat changed in its files (Nexa's checkpoints): the chat view holds the
 * dialog, its prompts and turns open it, at themselves.
 */
export interface ChatChangesControl {
  /** Whether there is a checkpoint before the prompt: it can be rewound to. */
  has(promptId: string): boolean
  /** The changes of the chat, opened at a prompt or at the turn of one. */
  show(at?: { promptId?: string; turnId?: string }): void
  /** Rewinding the files to before the prompt, with what that would do. */
  rewind(promptId: string): void
}

const KEY: InjectionKey<ChatChangesControl> = Symbol('chat-changes')

export function provideChatChanges(control: ChatChangesControl): void {
  provide(KEY, control)
}

export function useChatChanges(): ChatChangesControl | null {
  return inject(KEY, null)
}
