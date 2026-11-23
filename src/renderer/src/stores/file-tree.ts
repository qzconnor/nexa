import { defineStore } from 'pinia'
import { reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import type { FileListing, FileSearchList, FileTouch, FileTouchKind, FileTreeWatch, GitFileStatus, GitTreeStatus } from '@shared/files'
import { sameData } from '@shared/utils'
import { errorMessage } from '@/lib/errors'
import { absolutePath, ancestors, GIT_STATUSES, recordTouch, TOUCH_KINDS, treePathOf, type TouchRecord } from '@/lib/file-tree'
import { useAppStore } from './app'
import { useProjectsStore } from './projects'
import { useSessionsStore } from './sessions'

/** Width of the tree (px) before it is dragged, and the bounds it is dragged within. */
export const DEFAULT_TREE_WIDTH = 280
export const MIN_TREE_WIDTH = 180
export const MAX_TREE_WIDTH = 640
/** The tree takes at most this share of the chat's area; the chat keeps the rest. */
export const MAX_TREE_SHARE = 0.5

const STORAGE_KEY = 'nexa.file-tree'
/** Folders whose open subfolders are remembered, the most recently shown ones. */
const MAX_REMEMBERED_ROOTS = 40
/** Trees kept in memory while no chat shows them, so they come back at once. */
const MAX_IDLE_MODELS = 12
/** Git's status is asked again at most this often while files keep changing (ms). */
const STATUS_DELAY_MS = 400
/** How long a file the agent touched stays lit after the touch (ms). */
const TOUCH_MS = 5000
/** A folder opened to show what the agent touches closes again this long after its last touch (ms). */
const AGENT_FOLDER_MS = 10_000
/**
 * Of the files one report brings, the first so many open their folders, by kind: a commit, a search or
 * a shell command can bring many, and would unfold the whole tree.
 */
const REVEAL_LIMIT: Record<FileTouchKind, number> = { read: 30, write: 30, commit: 30, search: 10 }
/** The most files a session's activity keeps; the ones the agent left alone the longest go first. */
const MAX_ACTIVITY = 2000

export const SEPARATOR = window.api.platform === 'win32' ? '\\' : '/'

/** A file of a tree whose changes are shown; `path` '' is all changes of the folder. */
export interface DiffFile {
  root: string
  path: string
}

/** Which files the trees show: with neither, all of them; with both, the files of either. */
export interface TreeFilters {
  /** The files git sees changed. */
  changes: boolean
  /** The files the agent touched in the chat. */
  activity: boolean
}

interface Saved {
  width: number
  /** The panel is open beside the chats. */
  open: boolean
  /** Open folders by the tree's folder, the least recently used first. */
  expanded: Record<string, string[]>
  showIgnored: boolean
  filters: TreeFilters
  /** The filters' settings are unfolded. */
  filtersOpen: boolean
  /** Git's states the changes filter leaves out. */
  hiddenStatuses: GitFileStatus[]
  /** Kinds of touch the activity filter leaves out. */
  hiddenKinds: FileTouchKind[]
  /** Long lines of the review of all changes wrap. */
  diffWrap: boolean
  /** A file's changes show side by side. */
  diffSplit: boolean
}

/** The values of a saved list that are among `known`. */
function knownValues<T extends string>(list: unknown, known: readonly T[]): T[] {
  return Array.isArray(list) ? list.filter((value): value is T => known.includes(value as T)) : []
}

/** A tree of a folder, shared by every chat that works in it. */
export interface TreeModel {
  root: string
  /** The entries of the folders loaded so far, by path ('' is the folder itself). */
  listings: Map<string, FileListing>
  /** Folders that could not be read, with the reason. */
  errors: Map<string, string>
  expanded: Set<string>
  /** Git's view of the folder; null outside a repository (and until it is known). */
  git: GitTreeStatus | null
  /** The files for the search; null until it was searched once. */
  search: FileSearchList | null
  searchLoading: boolean
  /** Files changed since the search list was made. */
  searchStale: boolean
  /** What is typed into the tree's search. */
  query: string
  /** The search looks into the files, not at their names. */
  searchContent: boolean
  /** Folders closed while the tree is filtered (open is the default there). */
  collapsedFiltered: Set<string>
  /** The selected entry, also the one the keyboard moves from. */
  selected: string | null
  scrollTop: number
}

/** What a tree is about: the chat (its activity, where mentions go) and the folder it works in. */
export interface TreeTarget {
  /** The session's id. */
  id: string
  root: string
}

function readSaved(): Partial<Saved> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown
    return value && typeof value === 'object' ? (value as Partial<Saved>) : {}
  } catch {
    return {}
  }
}

const clampWidth = (width: number) => Math.round(Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, width)))

/** A file the agent touched lately, and until when it stays lit. */
export interface Touch {
  kind: FileTouchKind
  until: number
}

/**
 * The file panel beside the chats, as in the Claude Manager. Whether it is open holds for every chat;
 * the tree belongs to the folder: chats of the same project share its open folders, which are also
 * remembered for the next time. Folders on screen are watched, so the tree follows what the agent
 * changes, and the files it touches light up (main reports them from the chat's tool calls).
 */
export const useFileTreeStore = defineStore('file-tree', () => {
  const app = useAppStore()
  const sessions = useSessionsStore()
  const projects = useProjectsStore()
  const saved = readSaved()

  const width = ref(clampWidth(typeof saved.width === 'number' ? saved.width : DEFAULT_TREE_WIDTH))
  const open = ref(saved.open === true)
  const showIgnored = ref(saved.showIgnored !== false)
  /** The filters hold for every tree, like a view setting of VS Code's Explorer. */
  const filters = reactive<TreeFilters>({ changes: saved.filters?.changes === true, activity: saved.filters?.activity === true })
  const filtersOpen = ref(saved.filtersOpen === true)
  /** Long lines of the review of all changes wrap (the default), or scroll sideways. */
  const diffWrap = ref(saved.diffWrap !== false)
  /** A file's changes show side by side, the old file left and the new one right; or one below the other (the default). */
  const diffSplit = ref(saved.diffSplit === true)
  const hiddenStatuses = reactive(new Set(knownValues(saved.hiddenStatuses, GIT_STATUSES)))
  const hiddenKinds = reactive(new Set(knownValues(saved.hiddenKinds, TOUCH_KINDS)))
  /**
   * Every file the agent touched in a session, by session and absolute path, the most recently touched
   * last: what the activity filter shows. From the chat's history once the tree shows it, then live.
   */
  const activity = shallowRef(new Map<string, ReadonlyMap<string, TouchRecord>>())
  /** The file whose changes a chat shows over its timeline, by session. */
  const diffs = reactive(new Map<string, DiffFile>())
  const remembered: Record<string, string[]> = saved.expanded && typeof saved.expanded === 'object' ? { ...saved.expanded } : {}

  // A deleted chat's tree state goes with it.
  watch(
    () => sessions.metas,
    (list) => {
      const ids = new Set(list.map((m) => m.id))
      for (const id of diffs.keys()) if (!ids.has(id)) diffs.delete(id)
      if ([...activity.value.keys()].some((id) => !ids.has(id))) {
        activity.value = new Map([...activity.value].filter(([id]) => ids.has(id)))
      }
    },
  )

  function save(): void {
    try {
      const data: Saved = {
        width: width.value,
        open: open.value,
        expanded: remembered,
        showIgnored: showIgnored.value,
        filters: { ...filters },
        filtersOpen: filtersOpen.value,
        hiddenStatuses: [...hiddenStatuses],
        hiddenKinds: [...hiddenKinds],
        diffWrap: diffWrap.value,
        diffSplit: diffSplit.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      // Storage full or blocked: the trees are just not remembered.
    }
  }
  watch([width, open, showIgnored, filtersOpen, diffWrap, diffSplit, filters, hiddenStatuses, hiddenKinds], save)

  /** The tree of a chat: the folder of its project. Null without one. */
  function targetOf(sessionId: string | null | undefined): TreeTarget | null {
    const meta = sessions.get(sessionId)
    const root = projects.get(meta?.projectId)?.path
    return meta && root ? { id: meta.id, root } : null
  }

  function toggle(): void {
    open.value = !open.value
  }

  function setWidth(next: number): void {
    width.value = clampWidth(next)
  }

  // ── A file's changes ──

  /** Shows the changes of a file of a chat's tree over its timeline; `line`: that line of the whole file. */
  function showDiff(target: TreeTarget, path: string, options: { line?: number } = {}): void {
    const file = { root: target.root, path }
    lineRequest.value = options.line ? { root: target.root, path, line: options.line } : null
    if (!sameData(diffs.get(target.id), file)) diffs.set(target.id, file)
  }

  /**
   * A line to show of the file whose changes `showDiff` shows (a hit of the content search): the view
   * of that file takes it, shows the whole file there and marks the line.
   */
  const lineRequest = shallowRef<{ root: string; path: string; line: number } | null>(null)

  const diffOf = (id: string | null | undefined) => (id ? (diffs.get(id) ?? null) : null)

  function closeDiff(id: string): void {
    diffs.delete(id)
  }

  // ── Trees by folder ──

  /** The trees by folder, the least recently shown first. */
  const models = new Map<string, TreeModel>()
  /** How many trees on screen show each folder; the folders with none are idle and not watched. */
  const holders = new Map<string, number>()
  /** The latest load of each folder of each tree; an older answer is dropped. */
  const loads = new Map<string, number>()
  let loadCount = 0
  const statusTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Folders whose status is being asked for, and those to ask again once the answer is there. */
  const statusBusy = new Set<string>()
  const statusAgain = new Set<string>()
  /** Folders watched besides the open ones, e.g. the folder of a file whose changes are shown (Linux needs them). */
  const pinned = new Map<string, Map<string, number>>()

  function createModel(root: string): TreeModel {
    return shallowReactive({
      root,
      listings: shallowReactive(new Map()),
      errors: shallowReactive(new Map()),
      expanded: reactive(new Set(remembered[root] ?? [])),
      git: null,
      search: null,
      searchLoading: false,
      searchStale: false,
      query: '',
      searchContent: false,
      collapsedFiltered: reactive(new Set()),
      selected: null,
      scrollTop: 0,
    }) as TreeModel
  }

  /** A tree on screen holds its folder: it is loaded (again) and watched until it lets go. */
  function hold(root: string): TreeModel {
    let model = models.get(root)
    if (!model) {
      model = createModel(root)
      void loadDir(model, '')
      for (const dir of model.expanded) if (isShownDir(model, dir)) void loadDir(model, dir)
    } else if (!holders.has(root)) {
      // Shown again: what it shows may have changed meanwhile.
      reloadAll(model)
    }
    models.delete(root)
    models.set(root, model)
    holders.set(root, (holders.get(root) ?? 0) + 1)
    void loadStatus(model)
    queueWatch()
    return model
  }

  /** Watches a folder of a held tree besides its open ones, until the returned function is called. */
  function pinDir(root: string, dir: string): () => void {
    const dirs = pinned.get(root) ?? new Map<string, number>()
    pinned.set(root, dirs)
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1)
    queueWatch()
    return () => {
      const count = (dirs.get(dir) ?? 0) - 1
      if (count > 0) dirs.set(dir, count)
      else dirs.delete(dir)
      if (dirs.size === 0 && pinned.get(root) === dirs) pinned.delete(root)
      queueWatch()
    }
  }

  function release(root: string): void {
    const count = (holders.get(root) ?? 0) - 1
    if (count > 0) holders.set(root, count)
    else holders.delete(root)
    queueWatch()
    // Idle trees beyond the limit go, the longest unused first (a Map keeps the order of insertion).
    const idle = [...models.keys()].filter((r) => !holders.has(r))
    for (const r of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_MODELS))) models.delete(r)
  }

  function key(model: TreeModel, dir: string): string {
    return `${model.root}\n${dir}`
  }

  async function loadDir(model: TreeModel, dir: string): Promise<void> {
    const id = ++loadCount
    loads.set(key(model, dir), id)
    try {
      const listing = await window.api.files.list(absolutePath(model.root, dir, SEPARATOR))
      if (loads.get(key(model, dir)) !== id) return
      const old = model.listings.get(dir)
      // Unchanged: the rows aren't computed again.
      if (!old || !sameData(old, listing)) model.listings.set(dir, Object.freeze(listing))
      model.errors.delete(dir)
    } catch (error) {
      if (loads.get(key(model, dir)) !== id) return
      model.listings.delete(dir)
      model.errors.set(dir, readError(error))
    } finally {
      if (loads.get(key(model, dir)) === id) loads.delete(key(model, dir))
    }
  }

  /** The reason a folder can't be shown, in words. */
  function readError(error: unknown): string {
    const message = errorMessage(error)
    if (/ENOENT/.test(message)) return 'Ordner nicht gefunden'
    if (/EACCES|EPERM/.test(message)) return 'Zugriff verweigert'
    if (/ENOTDIR/.test(message)) return 'Kein Ordner'
    return message
  }

  function reloadAll(model: TreeModel): void {
    for (const dir of new Set(['', ...model.listings.keys(), ...model.errors.keys()])) {
      if (dir === '' || isShownDir(model, dir)) void loadDir(model, dir)
      else {
        // A folder closed meanwhile is loaded again when it is opened.
        model.listings.delete(dir)
        model.errors.delete(dir)
      }
    }
    model.searchStale = true
  }

  /** Open, and every folder it lies in too. */
  function isShownDir(model: TreeModel, dir: string): boolean {
    return model.expanded.has(dir) && ancestors(dir).every((a) => model.expanded.has(a))
  }

  async function loadStatus(model: TreeModel): Promise<void> {
    const root = model.root
    if (statusBusy.has(root)) {
      statusAgain.add(root)
      return
    }
    statusBusy.add(root)
    try {
      const status = await window.api.files.status(root).catch(() => null)
      if (models.get(root) === model && !sameData(model.git, status)) {
        model.git = status ? Object.freeze(status) : null
        // Files came or went, maybe in a folder that isn't watched (e.g. in a new one).
        model.searchStale = true
      }
    } finally {
      statusBusy.delete(root)
      if (statusAgain.delete(root)) scheduleStatus(model)
    }
  }

  function scheduleStatus(model: TreeModel): void {
    if (statusTimers.has(model.root)) return
    statusTimers.set(
      model.root,
      setTimeout(() => {
        statusTimers.delete(model.root)
        if (models.get(model.root) === model) void loadStatus(model)
      }, STATUS_DELAY_MS),
    )
  }

  // The folders on screen are watched; main reports their changes together.
  let watchQueued = false
  let watching = ''
  function queueWatch(): void {
    if (watchQueued) return
    watchQueued = true
    queueMicrotask(() => {
      watchQueued = false
      const trees: FileTreeWatch[] = [...holders.keys()].flatMap((root) => {
        const model = models.get(root)
        if (!model) return []
        const dirs = new Set([...model.expanded].filter((dir) => model.listings.has(dir)))
        for (const dir of pinned.get(root)?.keys() ?? []) dirs.add(dir)
        return [{ root, dirs: [...dirs] }]
      })
      const next = JSON.stringify(trees)
      if (next === watching) return
      watching = next
      void window.api.files.watch(trees).catch(() => {})
    })
  }

  window.api.files.onChanged((root, dirs, git) => {
    const model = models.get(root)
    if (!model) return
    for (const dir of dirs) {
      if (model.listings.has(dir) || model.errors.has(dir)) void loadDir(model, dir)
    }
    if (dirs.length > 0) model.searchStale = true
    // Main tells whether git may see it: not for what changes in node_modules or dist.
    if (git) scheduleStatus(model)
  })

  // Back in the window: git may have run elsewhere, a folder outside the watched ones changed.
  watch(
    () => app.windowState.focused,
    (focused) => {
      if (!focused) return
      for (const root of holders.keys()) {
        const model = models.get(root)
        if (model) scheduleStatus(model)
      }
    },
  )

  function remember(model: TreeModel): void {
    delete remembered[model.root]
    // Folders opened only to show what the agent touches aren't the user's to remember.
    const agent = agentFolders.get(model.root)
    const dirs = [...model.expanded].filter((dir) => !agent?.has(dir))
    if (dirs.length > 0) remembered[model.root] = dirs
    const roots = Object.keys(remembered)
    for (const root of roots.slice(0, Math.max(0, roots.length - MAX_REMEMBERED_ROOTS))) delete remembered[root]
    save()
  }

  function setExpanded(model: TreeModel, dir: string, value: boolean): void {
    // Opened or closed by hand: no longer the agent's to close.
    agentFolders.get(model.root)?.delete(dir)
    if (value === model.expanded.has(dir)) return
    if (value) {
      model.expanded.add(dir)
      if (!model.listings.has(dir)) void loadDir(model, dir)
    } else {
      model.expanded.delete(dir)
    }
    remember(model)
    queueWatch()
  }

  /** Opens the folders a path lies in, so it shows in the tree. */
  function reveal(model: TreeModel, path: string): void {
    for (const dir of ancestors(path)) setExpanded(model, dir, true)
  }

  function collapseAll(model: TreeModel): void {
    agentFolders.delete(model.root)
    model.expanded.clear()
    remember(model)
    queueWatch()
  }

  function refresh(model: TreeModel): void {
    reloadAll(model)
    void loadStatus(model)
    if (model.query) void loadSearch(model, true)
  }

  /** The files for the search, made again once files changed. */
  async function loadSearch(model: TreeModel, force = false): Promise<void> {
    if (model.searchLoading || (model.search && !model.searchStale && !force)) return
    model.searchLoading = true
    model.searchStale = false
    try {
      const list = await window.api.files.searchList(model.root)
      model.search = Object.freeze({ paths: Object.freeze(list.paths) as string[], truncated: list.truncated })
    } catch {
      model.search = { paths: [], truncated: false }
    } finally {
      model.searchLoading = false
    }
  }

  // ── What the agent touches ──

  /** Files the agent touched lately, by session and absolute path. */
  const touches = shallowRef(new Map<string, ReadonlyMap<string, Touch>>())
  let touchTimer: ReturnType<typeof setTimeout> | null = null
  /** Folders opened to show what the agent touched, by tree and folder, with the time of the last touch in them. */
  const agentFolders = new Map<string, Map<string, number>>()
  let folderTimer: ReturnType<typeof setTimeout> | null = null

  window.api.files.onTouched((sessionId, list) => {
    const now = Date.now()
    const next = new Map(touches.value)
    const mine = new Map(next.get(sessionId))
    for (const touch of list) mine.set(touch.path, { kind: touch.kind, until: now + TOUCH_MS })
    next.set(sessionId, mine)
    touches.value = next
    scheduleTouchExpiry()
    record(sessionId, list, now)
    // Only the trees of the chat on screen open folders for it: another chat's agent may work there too.
    if (sessionId !== sessions.activeId) return
    // A commit opens folders too: its files were mostly written a while ago, their folders closed since.
    const revealed: Partial<Record<FileTouchKind, number>> = {}
    for (const touch of list) {
      const count = (revealed[touch.kind] ?? 0) + 1
      revealed[touch.kind] = count
      if (count <= REVEAL_LIMIT[touch.kind]) revealForAgent(touch, now)
    }
  })

  /** The touches that ran out go, all at once at the next one to run out. */
  function scheduleTouchExpiry(): void {
    if (touchTimer) clearTimeout(touchTimer)
    let next = Infinity
    for (const map of touches.value.values()) for (const touch of map.values()) next = Math.min(next, touch.until)
    if (next === Infinity) return
    touchTimer = setTimeout(
      () => {
        touchTimer = null
        const now = Date.now()
        const kept = new Map<string, ReadonlyMap<string, Touch>>()
        for (const [id, map] of touches.value) {
          const live = new Map([...map].filter(([, touch]) => touch.until > now))
          if (live.size > 0) kept.set(id, live)
        }
        touches.value = kept
        scheduleTouchExpiry()
      },
      Math.max(0, next - Date.now()) + 20,
    )
  }

  const touchesOf = (id: string | null | undefined): ReadonlyMap<string, Touch> | null => (id ? (touches.value.get(id) ?? null) : null)

  /** Adds touches to the session's activity, as its most recent. */
  function record(sessionId: string, list: readonly FileTouch[], now: number): void {
    const mine = new Map(activity.value.get(sessionId))
    for (const touch of list) {
      const before = mine.get(touch.path)
      mine.delete(touch.path)
      mine.set(touch.path, recordTouch(before, touch.kind, now))
    }
    trim(mine)
    const next = new Map(activity.value)
    next.set(sessionId, mine)
    activity.value = next
  }

  function trim(map: Map<string, TouchRecord>): void {
    if (map.size > MAX_ACTIVITY) for (const path of [...map.keys()].slice(0, map.size - MAX_ACTIVITY)) map.delete(path)
  }

  const activityOf = (id: string | null | undefined): ReadonlyMap<string, TouchRecord> | null =>
    id ? (activity.value.get(id) ?? null) : null

  /** Sessions whose history was asked for: their activity starts with it, also after "Vergessen". */
  const histories = new Map<string, Promise<void>>()

  /**
   * Fills a session's activity with what its chat did before (once per session while the app runs);
   * what was seen live meanwhile stays the most recent.
   */
  function loadHistory(sessionId: string): Promise<void> {
    let loading = histories.get(sessionId)
    if (!loading) {
      loading = window.api.files.history(sessionId).then(
        (list) => {
          const mine = new Map<string, TouchRecord>()
          for (const touch of list) {
            const before = mine.get(touch.path)
            mine.delete(touch.path)
            mine.set(touch.path, recordTouch(before, touch.kind, touch.at))
          }
          for (const [path, live] of activity.value.get(sessionId) ?? []) {
            const before = mine.get(path)
            mine.delete(path)
            mine.set(path, Object.freeze({ ...before, ...live }))
          }
          trim(mine)
          const next = new Map(activity.value)
          next.set(sessionId, mine)
          activity.value = next
        },
        () => {
          histories.delete(sessionId)
        },
      )
      histories.set(sessionId, loading)
    }
    return loading
  }

  /** Forgets what the agent did in a chat, e.g. once the work is done; the chat records anew. */
  function clearActivity(sessionId: string): void {
    if (!activity.value.has(sessionId)) return
    const next = new Map(activity.value)
    next.delete(sessionId)
    activity.value = next
  }

  // ── Reviewing the changes ──

  /**
   * Files marked as seen while reviewing a folder's changes, by folder and file, with the fingerprint
   * of their diff then: a file that changes after is to be looked at again. Kept while the app runs.
   */
  const seen = reactive(new Map<string, Map<string, string>>())

  const seenOf = (root: string, path: string): string | undefined => seen.get(root)?.get(path)

  /** Marks a file as seen with its diff's fingerprint, or (null) as not seen. */
  function setSeen(root: string, path: string, hash: string | null): void {
    if (hash === null) {
      seen.get(root)?.delete(path)
      return
    }
    if (!seen.has(root)) seen.set(root, new Map())
    seen.get(root)!.set(path, hash)
  }

  /** The trees on screen open the folders a file the agent touches lies in, as the plugin does. */
  function revealForAgent(touch: FileTouch, now: number): void {
    for (const root of holders.keys()) {
      const model = models.get(root)
      const path = model ? treePathOf(root, touch.path, window.api.platform === 'win32') : null
      if (!model || !path) continue
      // A new file in a folder that isn't watched (Linux watches only the open ones) joins the list of files.
      if (touch.kind === 'write') model.searchStale = true
      const marks = agentFolders.get(root) ?? new Map<string, number>()
      for (const dir of ancestors(path)) {
        if (!model.expanded.has(dir)) {
          model.expanded.add(dir)
          if (!model.listings.has(dir)) void loadDir(model, dir)
          marks.set(dir, now)
        } else if (marks.has(dir)) {
          marks.set(dir, now)
        }
      }
      if (marks.size > 0) agentFolders.set(root, marks)
      queueWatch()
    }
    scheduleFolderClose()
  }

  /** Folders opened for the agent close once it left them alone for a while; one with the selection stays. */
  function scheduleFolderClose(): void {
    if (folderTimer) return
    folderTimer = setTimeout(() => {
      folderTimer = null
      const now = Date.now()
      let more = false
      for (const [root, marks] of agentFolders) {
        const model = models.get(root)
        for (const [dir, at] of marks) {
          if (now - at < AGENT_FOLDER_MS) {
            more = true
            continue
          }
          marks.delete(dir)
          if (model && !model.selected?.startsWith(`${dir}/`)) model.expanded.delete(dir)
        }
        if (marks.size === 0) agentFolders.delete(root)
        if (model) queueWatch()
      }
      if (more) scheduleFolderClose()
    }, 1000)
  }

  return {
    width,
    open,
    showIgnored,
    filters,
    filtersOpen,
    diffWrap,
    diffSplit,
    hiddenStatuses,
    hiddenKinds,
    targetOf,
    toggle,
    setWidth,
    showDiff,
    lineRequest,
    diffOf,
    closeDiff,
    touchesOf,
    activityOf,
    loadHistory,
    clearActivity,
    seenOf,
    setSeen,
    hold,
    pinDir,
    release,
    setExpanded,
    reveal,
    collapseAll,
    refresh,
    loadSearch,
  }
})
