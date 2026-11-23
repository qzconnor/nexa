import { sectionIdOf } from '@shared/sections'
import type { SessionMeta, SessionMoveInput } from '@shared/types'
import { toast } from 'vue-sonner'
import { attempt, toastError } from '@/lib/errors'
import { foldersOf, projectTree } from '@/lib/session-tree'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'

/** What a chat shows at a glance: its CLI works, waits for the user, finished while elsewhere, or failed. */
export type ChatState = 'running' | 'waiting' | 'unread' | 'error' | null

/** What the sidebar's chats and the quick open do with a chat, in one place. */
export function useChatActions() {
  const sessions = useSessionsStore()
  const projects = useProjectsStore()
  const ui = useUiStore()

  function state(id: string): ChatState {
    const status = sessions.runtime(id).status
    if (status === 'running' || status === 'starting') return 'running'
    if (status === 'waiting') return 'waiting'
    if (status === 'error') return 'error'
    return sessions.unread.has(id) ? 'unread' : null
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

  async function remove(meta: SessionMeta): Promise<void> {
    if (!(await ui.confirm({ title: `„${meta.title}“ löschen?`, description: 'Der Verlauf in Nexa geht verloren.', confirmText: 'Löschen', destructive: true }))) return
    await attempt(() => sessions.remove(meta.id), 'Löschen fehlgeschlagen')
    if (!sessions.activeId && ui.view === 'chat') ui.view = 'home'
  }

  return { state, working, open, newChat, rename, move, moveElsewhere, copyLastAnswer, exportMarkdown, remove }
}
