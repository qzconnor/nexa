import { sectionIdOf } from '@shared/sections'
import type { SessionMeta, SessionMoveInput } from '@shared/types'
import { toast } from 'vue-sonner'
import { groupState, type ChatState, type GroupState } from '@/lib/chat-state'
import { attempt, toastError } from '@/lib/errors'
import { foldersOf, projectTree } from '@/lib/session-tree'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { useChatRemoval } from './useChatRemoval'

export type { ChatState } from '@/lib/chat-state'

/** What the sidebar's chats and the quick open do with a chat, in one place. */
export function useChatActions() {
  const sessions = useSessionsStore()
  const projects = useProjectsStore()
  const ui = useUiStore()
  const removal = useChatRemoval()

  function state(id: string): ChatState {
    const status = sessions.runtime(id).status
    if (status === 'running' || status === 'starting') return 'running'
    if (status === 'waiting') return 'waiting'
    if (status === 'error') return 'error'
    return sessions.unread.has(id) ? 'unread' : null
  }

  /** What the chats of a folded project, folder or separator show as one. */
  function group(chats: readonly SessionMeta[]): GroupState {
    return groupState(chats.map((meta) => state(meta.id)))
  }

  /** Its CLI works on it or waits for an answer: it can't move now (see SessionService.move). */
  function working(id: string): boolean {
    const now = state(id)
    return now === 'running' || now === 'waiting'
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

  /** Into another project or a folder in it; the sidebar then shows it there, whatever was folded. */
  async function move(meta: SessionMeta, target: SessionMoveInput): Promise<void> {
    const moved = await attempt(() => sessions.move(meta.id, target), 'Chat nicht verschoben')
    if (moved) reveal(moved)
  }

  /** Into a folder the user picks, starting at the one it works in. */
  async function moveElsewhere(meta: SessionMeta): Promise<void> {
    const folder = await window.api.app.pickDirectory(sessions.cwdOf(meta) ?? undefined)
    if (folder) await move(meta, { folder })
  }

  function reveal(meta: SessionMeta): void {
    const project = projects.get(meta.projectId)
    if (!project) return
    const section = projects.sections.find((s) => s.id === sectionIdOf(project, projects.sections))
    if (section?.collapsed) void attempt(() => projects.updateSection(section.id, { collapsed: false }))
    if (project.collapsed) void attempt(() => projects.update(project.id, { collapsed: false }))
    for (const id of foldersOf(projectTree(project.id, project.path, sessions.byProject(project.id)), meta.id)) ui.toggleFolder(id, true)
  }

  /** A new chat that goes on from where this one is now, this one staying as it is; the new one opens. */
  async function fork(id: string): Promise<SessionMeta | undefined> {
    const meta = await attempt(() => sessions.fork(id), 'Abzweigen ging nicht')
    if (!meta) return
    ui.view = 'chat'
    reveal(meta)
    return meta
  }

  /** What the agent said last goes to the clipboard, as Markdown. */
  async function copyLastAnswer(id: string): Promise<void> {
    const answer = await attempt(() => window.api.sessions.lastAnswer(id), 'Antwort ließ sich nicht lesen')
    if (answer === undefined) return
    if (answer === null) {
      toast('Noch keine Antwort', { description: 'In diesem Chat hat der Agent noch nichts gesagt.' })
      return
    }
    try {
      await navigator.clipboard.writeText(answer)
      toast('Letzte Antwort kopiert')
    } catch (error) {
      toastError(error, 'Konnte nicht kopiert werden')
    }
  }

  /** The chat as a Markdown file where the user picks. */
  async function exportMarkdown(id: string): Promise<void> {
    const path = await attempt(() => window.api.sessions.exportMarkdown(id), 'Export fehlgeschlagen')
    if (path) toast('Chat gespeichert', { description: path, action: { label: 'Zeigen', onClick: () => void window.api.app.showItem(path) } })
  }

  /** Gone at once, for 8 s to be brought back (useChatRemoval). */
  async function remove(meta: SessionMeta): Promise<void> {
    await removal.remove([meta])
  }

  return { state, group, working, open, newChat, rename, move, moveElsewhere, fork, copyLastAnswer, exportMarkdown, remove }
}
