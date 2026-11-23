import { ref, shallowRef, watch, type Ref } from 'vue'
import type { SessionSearchHit } from '@shared/types'
import { searchTerms } from '@shared/utils'
import { errorMessage } from '@/lib/errors'

/**
 * Searches the prompts and answers of every chat in the main process. `query` should be debounced;
 * answers to an older query are dropped.
 */
export function useSessionSearch(query: Ref<string>) {
  /** By session id; always of the current query. */
  const hits = shallowRef(new Map<string, SessionSearchHit>())
  const searching = ref(false)
  /** Why the search in the conversations failed: then only what the list knows itself is searched. */
  const error = ref<string | null>(null)
  let latest = 0

  watch(
    query,
    async (value) => {
      const id = ++latest
      // The hits of the query before would keep chats in the list that don't match this one.
      hits.value = new Map()
      error.value = null
      if (searchTerms(value).length === 0) {
        searching.value = false
        return
      }
      searching.value = true
      try {
        const result = await window.api.sessions.search(value)
        if (id === latest) hits.value = new Map(result.map((hit) => [hit.sessionId, hit]))
      } catch (failure) {
        if (id === latest) error.value = errorMessage(failure)
      } finally {
        if (id === latest) searching.value = false
      }
    },
    { immediate: true },
  )

  /** Reads the chats ahead, so the first word typed finds them at once. */
  function prepare(): void {
    void window.api.sessions.search('').catch(() => undefined)
  }

  return { hits, searching, error, prepare }
}
