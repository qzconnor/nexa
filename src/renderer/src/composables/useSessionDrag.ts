import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'
import { folderKey } from '@shared/folders'

/** Where a chat dragged in the sidebar would go: a project, and a folder in it (undefined: its own). */
export interface SessionDropTarget {
  projectId: string
  cwd?: string
}

export interface SessionDrag {
  /** The chat being dragged. */
  dragging: Ref<string | null>
  /** Where it would go when dropped now; null where it can't. */
  target: Ref<SessionDropTarget | null>
  /** Whether the target is this project's own folder, or the folder `cwd` in it. */
  isTarget: (projectId: string, cwd?: string) => boolean
}

const KEY: InjectionKey<SessionDrag> = Symbol('session-drag')

/**
 * The sidebar holds the drag of a chat; its projects, folders and chats, nested at any depth, read it
 * to show where the chat would go.
 */
export function provideSessionDrag(): SessionDrag {
  const dragging = ref<string | null>(null)
  const target = ref<SessionDropTarget | null>(null)
  const isTarget = (projectId: string, cwd?: string) =>
    target.value?.projectId === projectId && folderKey(target.value.cwd ?? '') === folderKey(cwd ?? '')
  const drag: SessionDrag = { dragging, target, isTarget }
  provide(KEY, drag)
  return drag
}

export function useSessionDrag(): SessionDrag | null {
  return inject(KEY, null)
}
