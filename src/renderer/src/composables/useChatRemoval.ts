import type { SessionMeta, SessionRemoveResult } from '@shared/types'
import { toast } from 'vue-sonner'
import { attempt, toastError } from '@/lib/errors'
import { removalDescription, removalProblems, removedTitle } from '@/lib/chat-cleanup'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/** How long „Rückgängig“ brings deleted chats back, as in the Claude Manager. */
const UNDO_MS = 8000

/**
 * Deleting chats: they leave every list at once and go for good when the toast does, unless
 * „Rückgängig“ was clicked; only then do their CLIs' conversations go into the recycle bin.
 */
export function useChatRemoval() {
  const sessions = useSessionsStore()
  const settings = useSettingsStore()
  const ui = useUiStore()

  /** Several chats are confirmed first: a slip in a list takes more than one. Whether they went. */
  async function remove(metas: readonly SessionMeta[]): Promise<boolean> {
    const going = metas.filter((m) => !sessions.hidden.has(m.id))
    if (going.length === 0) return false
    const withCli = settings.settings.chat.deleteCliConversations
    if (
      going.length > 1 &&
      !(await ui.confirm({
        title: `${going.length} Chats löschen?`,
        description: `${removalDescription(going.length, withCli)} 8 Sekunden lang lässt sich das rückgängig machen.`,
        confirmText: 'Löschen',
        destructive: true,
      }))
    )
      return false

    const ids = going.map((m) => m.id)
    const shown = sessions.activeId && ids.includes(sessions.activeId) ? sessions.activeId : null
    sessions.hide(ids)
    if (shown && ui.view === 'chat') ui.view = 'home'

    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      sessions.remove(ids).then(report, (error) => toastError(error, 'Löschen fehlgeschlagen'))
    }
    const undo = () => {
      if (settled) return
      settled = true
      sessions.unhide(ids)
      if (shown && !sessions.activeId && ui.view === 'home') {
        ui.view = 'chat'
        void attempt(() => sessions.open(shown), 'Session ließ sich nicht öffnen')
      }
    }
    toast(removedTitle(going), {
      description: withCli ? 'Die Unterhaltungen der CLIs kommen in den Papierkorb.' : undefined,
      duration: UNDO_MS,
      action: { label: 'Rückgängig', onClick: undo },
      // Closed by hand, it is as if the time ran out: the chats go now.
      onAutoClose: finish,
      onDismiss: finish,
    })
    return true
  }

  return { remove }
}

/** Tells what went otherwise than asked: a transcript that stays, files the recycle bin refused. */
export function report(result: SessionRemoveResult): void {
  for (const problem of removalProblems(result)) {
    if (problem.error) toast.error(problem.title, { description: problem.description })
    else toast.warning(problem.title, { description: problem.description })
  }
}
