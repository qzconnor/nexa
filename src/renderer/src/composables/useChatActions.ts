import { sectionIdOf } from '@shared/sections'
import type { SessionMeta, SessionMoveInput } from '@shared/types'
import { toast } from 'vue-sonner'
import { isChatWindow } from '@/lib/chat-window'
import { groupState, type ChatState, type GroupState } from '@/lib/chat-state'
import { attempt, toastError } from '@/lib/errors'
import { foldersOf, projectTree } from '@/lib/session-tree'
import { useChatWindowsStore } from '@/stores/chat-windows'
import { useDevice, useDeviceApi, useShownDeviceStore } from '@/stores/device'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import { useChatRemoval } from './useChatRemoval'

export type { ChatState } from '@/lib/chat-state'

/**
 * What the sidebar's chats and the quick open do with a chat, in one place: with the chats of the
 * device the component shows (`useDevice`), this one's or another's.
 */
export function useChatActions() {
  const sessions = useSessionsStore()
  const projects = useProjectsStore()
  const ui = useUiStore()
  const removal = useChatRemoval()
  const device = useDevice()
  const api = useDeviceApi()
  const shown = useShownDeviceStore()

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
    // In another window: that one comes to the front, or the main window shows it.
    const windows = useChatWindowsStore()
    if (!device && windows.elsewhere(id)) return windows.show(id)
    ui.view = 'chat'
    await attempt(() => sessions.open(id), 'Session ließ sich nicht öffnen')
  }

  /** The start page of the device, with the project a new chat goes to (null: the last one used there). */
  function newChat(projectId: string | null = null): void {
    // A chat's own window has none: the main window shows it.
    if (isChatWindow) {
      void useChatWindowsStore().toMain({ kind: 'new', projectId })
      return
    }
    ui.homeProjectId = projectId
    sessions.close()
    shown.show(device)
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

  /** Opens what the sidebar folded around the chat: its separator, project and folders. */
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
    const answer = await attempt(() => api.sessions.lastAnswer(id), 'Antwort ließ sich nicht lesen')
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
    // From a chat's own window the main window deletes it, where „Rückgängig“ outlives this window.
    if (isChatWindow && !device) {
      await useChatWindowsStore().toMain({ kind: 'remove', sessionId: meta.id })
      return
    }
    await removal.remove([meta])
  }

  /** While the agent works, ending its CLI cuts off its answer: only when the user says so. */
  async function cutOffOk(id: string, title: string, confirmText: string): Promise<boolean> {
    const status = sessions.runtime(id).status
    if (status !== 'running' && status !== 'waiting' && status !== 'starting') return true
    return ui.confirm({ title, description: 'Der Agent arbeitet gerade. Seine Antwort bricht dabei ab.', confirmText })
  }

  /**
   * Its CLI starts anew on the same conversation and takes up what changed since it started (Nexa's
   * tools, the prompts of the project). The chat says „… startet“ meanwhile: no toast of its own.
   */
  async function restart(meta: SessionMeta): Promise<void> {
    if (!(await cutOffOk(meta.id, 'Chat neu starten?', 'Neu starten'))) return
    await attempt(() => sessions.restart(meta.id), 'Chat ließ sich nicht neu starten')
  }

  /** Its CLI ends and the start page shows, with the chat's project; the chat goes on with its next prompt. */
  async function end(meta: SessionMeta): Promise<void> {
    if (!(await cutOffOk(meta.id, 'Chat beenden?', 'Beenden'))) return
    const done = await attempt(() => sessions.stop(meta.id).then(() => true), 'Chat ließ sich nicht beenden')
    if (!done) return
    if (sessions.activeId !== meta.id) return
    newChat(meta.projectId)
    // Its own window has nothing left to show; what is written goes back with it.
    if (isChatWindow) await useChatWindowsStore().closeOwn()
  }

  /** Into a window of its own, or that window to the front; from a chat's own window, back into the main window. */
  async function popOut(meta: SessionMeta): Promise<void> {
    const windows = useChatWindowsStore()
    if (device) return
    if (isChatWindow) await windows.dock()
    else await windows.popOut(meta.id)
  }

  /**
   * After a change a CLI takes only at its start: the open chat's runs on as it was, so a toast offers
   * to start it anew. Without an open chat, or with its CLI not running, the next prompt takes it anyway.
   */
  function offerRestart(): void {
    const meta = ui.view === 'chat' ? sessions.active : null
    if (!meta || !sessions.runtime(meta.id).connected) return
    toast('Gilt ab dem nächsten Start der CLI', {
      // Several switches in a row: one toast. Long enough to finish with the settings and still find it.
      id: 'restart-offer',
      duration: 15_000,
      description: `Der offene Chat „${meta.title}“ läuft noch mit den bisherigen Einstellungen.`,
      action: { label: 'Chat neu starten', onClick: () => void restart(meta) },
    })
  }

  return {
    state,
    group,
    working,
    open,
    newChat,
    rename,
    move,
    moveElsewhere,
    reveal,
    fork,
    copyLastAnswer,
    exportMarkdown,
    remove,
    restart,
    end,
    popOut,
    offerRestart,
  }
}
