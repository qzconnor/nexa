import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ArtifactList } from '@shared/artifacts'

const key = (...parts: (string | boolean)[]) => parts.join('\n')

/**
 * Claude's artifacts for the page „Artefakte“: the list of each account, the thumbnails and the chat
 * each artifact came from. Kept while the app runs, so the page shows them at once when it opens again.
 */
export const useArtifactsStore = defineStore('artifacts', () => {
  const lists = ref<Record<string, ArtifactList>>({})
  const loading = ref<Record<string, boolean>>({})
  /** Thumbnails as `data:` URLs by account, artifact and brightness; null without one. */
  const thumbnails = ref<Record<string, string | null>>({})
  const pendingThumbnails = new Set<string>()
  /** The chat each artifact came from, by artifact id; one missing came from no chat of Nexa's. */
  const chats = ref<Record<string, string>>({})
  /** While the chats are looked through. */
  const searching = ref(false)
  let chatsRun: Promise<void> | null = null

  async function load(accountId: string): Promise<void> {
    if (loading.value[accountId]) return
    loading.value[accountId] = true
    try {
      const list = await window.api.artifacts.list(accountId)
      // The thumbnails' links change with every list.
      for (const k of Object.keys(thumbnails.value)) if (k.startsWith(key(accountId, ''))) delete thumbnails.value[k]
      lists.value[accountId] = list
      if (list.artifacts.length) void loadChats()
    } finally {
      loading.value[accountId] = false
    }
  }

  /** Looks through the chats for the artifacts' links; one search at a time. */
  function loadChats(): Promise<void> {
    if (chatsRun) return chatsRun
    searching.value = true
    const run = window.api.artifacts
      .chats()
      .then(
        (found) => {
          chats.value = found
        },
        (error) => console.warn('[artifacts] chats could not be searched', error),
      )
      .finally(() => {
        chatsRun = null
        searching.value = false
      })
    chatsRun = run
    return run
  }

  /** Asks for a thumbnail once; `thumbnailOf` has it when it arrives. */
  function requestThumbnail(accountId: string, id: string, dark: boolean): void {
    const k = key(accountId, id, dark)
    if (k in thumbnails.value || pendingThumbnails.has(k)) return
    pendingThumbnails.add(k)
    window.api.artifacts
      .thumbnail(accountId, id, dark)
      .then(
        (url) => (thumbnails.value[k] = url),
        () => (thumbnails.value[k] = null),
      )
      .finally(() => pendingThumbnails.delete(k))
  }

  /** The thumbnail; undefined while it hasn't arrived (yet), null without one. */
  function thumbnailOf(accountId: string, id: string, dark: boolean): string | null | undefined {
    return thumbnails.value[key(accountId, id, dark)]
  }

  return { lists, loading, chats, searching, load, loadChats, requestThumbnail, thumbnailOf }
})
