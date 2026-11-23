import type { SessionMeta } from '@shared/types'
import { attempt } from '@/lib/errors'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'

/** What a chat shows at a glance: its CLI works, waits for the user, finished while elsewhere, or failed. */
export type ChatState = 'running' | 'waiting' | 'unread' | 'error' | null

/** What the sidebar's chats and the quick open do with a chat, in one place. */
export function useChatActions() {
  const sessions = useSessionsStore()
  const ui = useUiStore()

  function state(id: string): ChatState {
    const status = sessions.runtime(id).status
    if (status === 'running' || status === 'starting') return 'running'
    if (status === 'waiting') return 'waiting'
    if (status === 'error') return 'error'
    return sessions.unread.has(id) ? 'unread' : null
  }

  async function open(id: string): Promise<void> {
    ui.view = 'chat'
    await attempt(() => sessions.open(id), 'Session ließ sich nicht öffnen')
  }

  /** The start page, with the project a new chat goes to (null: the last one used there). */
  function newChat(projectId: string | null = null): void {
    ui.homeProjectId = projectId
    sessions.close()
    ui.view = 'home'
  }

  async function rename(meta: SessionMeta): Promise<void> {
    const title = await ui.ask({ title: 'Chat umbenennen', input: { value: meta.title }, confirmText: 'Umbenennen' })
    if (title && title !== meta.title) await attempt(() => sessions.update(meta.id, { title }))
  }

  async function remove(meta: SessionMeta): Promise<void> {
    if (!(await ui.confirm({ title: `„${meta.title}“ löschen?`, description: 'Der Verlauf in Nexa geht verloren.', confirmText: 'Löschen', destructive: true }))) return
    await attempt(() => sessions.remove(meta.id), 'Löschen fehlgeschlagen')
    if (!sessions.activeId && ui.view === 'chat') ui.view = 'home'
  }

  return { state, open, newChat, rename, remove }
}
