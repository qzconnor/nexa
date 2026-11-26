import { defineStore } from 'pinia'
import { nextTick, ref } from 'vue'
import type { SessionMeta } from '@shared/types'
import { reviewPrompt, type ReviewComment } from '@/lib/review-comments'
import { useComposerStore } from './composer'
import { useProjectsStore } from './projects'
import { useSessionsStore } from './sessions'
import { useUiStore } from './ui'

/** The most chats offered to send the comments to. */
const MAX_TARGETS = 10

/** Folders compare without regard to case and separators on Windows. */
const samePath = (a: string, b: string) => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  return window.api.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

/**
 * Comments on lines of changes (a file's or all of a folder's), gathered like a review of a pull
 * request until they go to the agent in one go. They are kept by folder while the app runs, also while
 * the changes are closed.
 */
export const useReviewStore = defineStore('review', () => {
  const sessions = useSessionsStore(null)
  const projects = useProjectsStore(null)
  const composer = useComposerStore()
  const ui = useUiStore()
  const comments = ref<ReviewComment[]>([])
  let count = 0

  const of = (root: string) => comments.value.filter((c) => c.root === root)
  const ofFile = (root: string, path: string) => comments.value.filter((c) => c.root === root && c.path === path)
  const get = (id: string | null | undefined) => (id ? comments.value.find((c) => c.id === id) : undefined)

  function add(comment: Omit<ReviewComment, 'id'>): ReviewComment {
    const added = { ...comment, id: `review-${++count}` }
    comments.value = [...comments.value, added]
    return added
  }

  function update(id: string, patch: Partial<Pick<ReviewComment, 'from' | 'to' | 'ref' | 'text'>>): void {
    comments.value = comments.value.map((c) => (c.id === id ? { ...c, ...patch } : c))
  }

  function remove(id: string): void {
    comments.value = comments.value.filter((c) => c.id !== id)
  }

  /** Takes the comments of a folder away, e.g. once they went to the agent; `restore` brings them back. */
  function take(root: string): ReviewComment[] {
    const taken = of(root)
    comments.value = comments.value.filter((c) => c.root !== root)
    return taken
  }

  function restore(list: readonly ReviewComment[]): void {
    const ids = new Set(comments.value.map((c) => c.id))
    comments.value = [...comments.value, ...list.filter((c) => !ids.has(c.id))]
  }

  /** The chats that work in this folder, the one on screen first, then the latest. */
  function targets(root: string): SessionMeta[] {
    const shown = (m: SessionMeta) => (m.id === sessions.activeId ? 1 : 0)
    return sessions.metas
      .filter((m) => !m.archived && projects.get(m.projectId) && samePath(sessions.cwdOf(m) ?? '', root))
      .sort((a, b) => shown(b) - shown(a) || b.updatedAt - a.updatedAt)
      .slice(0, MAX_TARGETS)
  }

  /**
   * The comments of a folder into the composer of a chat (`sessionId`), which is shown: not sent yet,
   * Enter sends them, after more words if wanted. Without a chat they go to the clipboard. Either way
   * they are taken away (`restore` brings them back).
   */
  async function send(root: string, sessionId: string | null): Promise<{ pasted: boolean; taken: ReviewComment[] } | null> {
    const list = of(root)
    if (list.length === 0) return null
    const text = reviewPrompt(list)
    let pasted = false
    if (sessionId && sessions.get(sessionId)) {
      if (sessions.activeId !== sessionId || ui.view !== 'chat') {
        ui.view = 'chat'
        await sessions.open(sessionId)
        await nextTick()
      }
      composer.insert(sessionId, text)
      pasted = true
    }
    if (!pasted) await navigator.clipboard.writeText(text)
    return { pasted, taken: take(root) }
  }

  return { comments, of, ofFile, get, add, update, remove, take, restore, targets, send }
})
