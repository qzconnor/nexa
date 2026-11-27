import { computed } from 'vue'
import { useDevice } from '@/stores/device'
import { useUiStore } from '@/stores/ui'

export type FoldKind = 'section' | 'project' | 'folder'

/**
 * Whether a separator, project or folder of the sidebar shows open, and folding it. Under „Aktiv“ all
 * of them show open, so the running chats are in sight without a click; one folded there stays so until
 * the filter changes. The folding under „Alle“ (saved with the separator, the project, `ui.openFolders`)
 * stays as the user left it.
 */
export function useSidebarFold() {
  const ui = useUiStore()
  // By device: every device has a separator `default`.
  const device = useDevice()
  const live = computed(() => ui.sidebarFilter === 'live')
  const key = (kind: FoldKind, id: string) => `${device ?? ''}\n${kind}\n${id}`

  /** `saved`: open under „Alle“. */
  function isOpen(kind: FoldKind, id: string, saved: boolean): boolean {
    return live.value ? !ui.liveFolded.has(key(kind, id)) : saved
  }

  /** `saved` folds it under „Alle“, for good. */
  function toggle(kind: FoldKind, id: string, saved: () => void): void {
    if (live.value) ui.toggleLiveFold(key(kind, id))
    else saved()
  }

  return { isOpen, toggle }
}
