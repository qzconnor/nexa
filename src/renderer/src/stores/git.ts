import { reactive, watch } from 'vue'
import type { GitBranch } from '@shared/files'
import { useAppStore } from './app'
import { apiOf, scopedStore } from './device'
import { useDevicesStore } from './devices'

export interface GitRepo {
  /** Null outside a repository or without git. */
  branch: GitBranch | null
  /** Page of the repository on GitHub, GitLab …; null without a remote that has one. */
  webUrl: string | null
  /** Folder of the main checkout when the folder lies in a linked worktree; null otherwise. */
  mainWorktree: string | null
}

/**
 * Branch and web page of the repositories the shown tabs work in, by folder. Components hold the
 * folders they show (`useGitBranch`); main watches their repositories for checkouts while one does.
 * Each device has its own (`scopedStore`): another device's folders are read there, by Remote Control.
 */
export const useGitStore = scopedStore('git', (device) => {
  const app = useAppStore()
  const api = apiOf(device)
  /** Missing while the folder is loaded for the first time. */
  const repos = reactive(new Map<string, GitRepo>())
  /** How many components hold each folder. */
  const holders = new Map<string, number>()
  /** The latest load of each folder; an older answer is dropped. */
  const pending = new Map<string, number>()
  let loads = 0
  let flushQueued = false
  let watching = ''

  async function load(dir: string): Promise<void> {
    const id = ++loads
    pending.set(dir, id)
    const [branch, webUrl, mainWorktree] = await Promise.all([
      api.git.branch(dir).catch(() => null),
      api.git.webUrl(dir).catch(() => null),
      api.git.mainWorktree(dir).catch(() => null),
    ])
    if (pending.get(dir) !== id) return
    pending.delete(dir)
    if (holders.has(dir)) repos.set(dir, { branch, webUrl, mainWorktree })
  }

  /**
   * Once per tick: a tab moved to another group lets go of its folder and takes it again, which
   * neither drops the branch nor loads it anew.
   */
  function queueFlush(): void {
    if (flushQueued) return
    flushQueued = true
    queueMicrotask(() => {
      flushQueued = false
      for (const dir of repos.keys()) {
        if (!holders.has(dir)) repos.delete(dir)
      }
      sendWatch()
    })
  }

  function sendWatch(force = false): void {
    const dirs = [...holders.keys()]
    const key = JSON.stringify(dirs)
    if (!force && key === watching) return
    watching = key
    // Not taken (another device not reachable): sent again once it is.
    void api.git.watch(dirs).catch(() => {
      if (watching === key) watching = ''
    })
  }

  function hold(dir: string): void {
    holders.set(dir, (holders.get(dir) ?? 0) + 1)
    if (!repos.has(dir) && !pending.has(dir)) void load(dir)
    queueFlush()
  }

  function release(dir: string): void {
    const count = (holders.get(dir) ?? 0) - 1
    if (count > 0) holders.set(dir, count)
    else holders.delete(dir)
    queueFlush()
  }

  // Main watches the repositories for checkouts; this also catches a folder that became one or got a remote.
  watch(
    () => app.windowState.focused,
    (focused) => {
      if (!focused) return
      for (const dir of holders.keys()) void load(dir)
      sendWatch(true)
    },
  )

  api.git.onBranchChanged((dir, branch) => {
    const repo = repos.get(dir)
    if (repo) repo.branch = branch
  })

  // Another device watches its repositories for this one only while this one watches it: once that
  // ended (offline, run out, let in again), the branches are read anew and the watch is sent again.
  if (device) {
    const again = () => {
      for (const dir of holders.keys()) void load(dir)
      sendWatch(true)
    }
    window.api.remote.onResync((id) => {
      if (id === device) again()
    })
    const devices = useDevicesStore()
    watch(
      () => devices.devices.find((d) => d.id === device)?.state === 'ready',
      (ready, before) => {
        if (ready && before === false) again()
      },
    )
  }

  return { repos, hold, release }
})
