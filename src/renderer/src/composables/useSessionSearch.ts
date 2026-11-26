import { ref, shallowRef, watch, type Ref } from 'vue'
import type { SessionSearchHit } from '@shared/types'
import { searchTerms } from '@shared/utils'
import { withHits } from '@/lib/device-chats'
import { errorMessage } from '@/lib/errors'
import { apiOf } from '@/stores/device'

/**
 * Searches the prompts and answers of every chat in the main process, and those of the other devices
 * in `devices` on each of them (Remote Control). `query` should be debounced; answers to an older
 * query are dropped.
 */
export function useSessionSearch(query: Ref<string>, devices: Ref<readonly string[]> = ref([])) {
  /** By `chatKey`; always of the current query. */
  const hits = shallowRef(new Map<string, SessionSearchHit>())
  const searching = ref(false)
  /** Why the search in this device's conversations failed: then only what the list knows itself is searched. */
  const error = ref<string | null>(null)
  let latest = 0

  watch(
    // A device that comes or goes while searching is asked, or no longer counted, at once.
    [query, () => devices.value.join('\n')],
    async ([value]) => {
      const id = ++latest
      // The hits of the query before would keep chats in the list that don't match this one.
      hits.value = new Map()
      error.value = null
      if (searchTerms(value).length === 0) {
        searching.value = false
        return
      }
      searching.value = true
      // Each device's hits show as they come: a slow one doesn't hold back this one's.
      const ask = async (device: string | null): Promise<void> => {
        try {
          const found = await apiOf(device).sessions.search(value)
          if (id === latest) hits.value = withHits(hits.value, device, found)
        } catch (failure) {
          // Another device that fails leaves its chats to what the list knows of them.
          if (id === latest && !device) error.value = errorMessage(failure)
          else if (device) console.warn('[search] device', device, failure)
        }
      }
      await Promise.all([null, ...devices.value].map(ask))
      if (id === latest) searching.value = false
    },
    { immediate: true },
  )

  /** Reads the chats ahead, on every device, so the first word typed finds them at once. */
  function prepare(): void {
    for (const device of [null, ...devices.value]) void apiOf(device).sessions.search('').catch(() => undefined)
  }

  return { hits, searching, error, prepare }
}
