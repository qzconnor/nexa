import { useDocumentVisibility, useIntervalFn } from '@vueuse/core'
import { computed, shallowRef, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { PullRequestInfo, PullRequestList } from '@shared/pull-requests'
import { sortForBranch } from '@/lib/pull-requests'
import { useAppStore } from '@/stores/app'
import { apiOf, useDevice } from '@/stores/device'
import { useGitBranch } from './useGitBranch'

/** Read again this often while shown: checks finish and reviews come without anything here changing. */
const REFRESH_MS = 3 * 60_000

/**
 * The open pull requests of the repository `dir` lies in (GitHub, through the GitHub CLI of the device
 * the chat runs on), with the one of the checked-out branch first. Read when the folder or the branch
 * changes, when the window comes to the front and every few minutes while it shows; `fresh` after a
 * turn of the chat, in which the agent may have opened one.
 */
export function usePullRequests(dir: MaybeRefOrGetter<string | null | undefined>) {
  const api = apiOf(useDevice())
  const app = useAppStore()
  const repo = useGitBranch(dir)
  const visible = useDocumentVisibility()
  const list = shallowRef<PullRequestList | null>(null)
  let loads = 0

  /** The checked-out branch; null for a detached HEAD, outside a repository and while loading. */
  const branch = computed(() => (repo.value?.branch && !repo.value.branch.detached ? repo.value.branch.name : null))

  async function refresh(fresh = false): Promise<void> {
    const current = toValue(dir)
    const id = ++loads
    if (!current) {
      list.value = null
      return
    }
    const next = await api.git.pullRequests(current, fresh).catch((error: unknown) => ({
      ok: false as const,
      missing: 'error' as const,
      message: error instanceof Error ? error.message : String(error),
    }))
    // An answer for a folder shown before comes too late.
    if (id === loads) list.value = next
  }

  watch(
    [() => toValue(dir), branch],
    ([next], old) => {
      // Another folder: its list, not the last one's, once it comes.
      if (next !== old?.[0]) list.value = null
      void refresh()
    },
    { immediate: true },
  )
  watch(
    () => app.windowState.focused,
    (focused) => {
      if (focused) void refresh()
    },
  )
  useIntervalFn(() => {
    if (visible.value === 'visible') void refresh()
  }, REFRESH_MS)

  const pullRequests = computed<PullRequestInfo[]>(() => (list.value?.ok ? sortForBranch(list.value.pullRequests, branch.value) : []))
  /** The pull request of the checked-out branch, if it has an open one. */
  const own = computed(() => (branch.value ? (pullRequests.value.find((pr) => pr.branch === branch.value) ?? null) : null))
  const webUrl = computed(() => (list.value?.ok ? list.value.webUrl : null))

  return { list, pullRequests, own, branch, webUrl, refresh }
}
