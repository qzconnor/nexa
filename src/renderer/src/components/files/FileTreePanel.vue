<script setup lang="ts">
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  AtSignIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FileDiffIcon,
  FilePlusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FolderXIcon,
  GitCompareIcon,
  GitBranchIcon,
  GitCommitHorizontalIcon,
  ListFilterIcon,
  ListTreeIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  TextSearchIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { FileTouchKind, FileTreeSide, GitFileState, GitFileStatus } from '@shared/files'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MIN_CONTENT_QUERY, useContentSearch } from '@/composables/useContentSearch'
import { useFileTreeModel } from '@/composables/useFileTreeModel'
import { useGitActions } from '@/composables/useGitActions'
import { useOpenFile } from '@/composables/useOpenFile'
import { attempt } from '@/lib/errors'
import { fileIcon, type FileIconInfo } from '@/lib/file-icons'
import {
  absolutePath,
  ancestors,
  changedFiles,
  FILE_TREE_DRAG_TYPE,
  filesTree,
  flattenTree,
  folderName,
  foldersOf,
  GIT_STATUSES,
  gitDecorations,
  mentionOf,
  parentPath,
  recordKind,
  searchTree,
  STATUS_CLASS,
  STATUS_LABEL,
  STATUS_LETTER,
  TOUCH_KINDS,
  TOUCH_RANK,
  treePathOf,
  untrackedFolders,
  type TouchRecord,
  type TreeRow,
} from '@/lib/file-tree'
import { TOUCH_DONE, TOUCH_ICON } from '@/lib/file-touch'
import { fileManagerLabel, isWindows } from '@/lib/platform'
import { childPath, type NameKind, type NameRequest } from '@/lib/tree-names'
import { separatorValue } from '@/lib/separator-keys'
import { isMenuKey, openMenuBelow } from '@/lib/tab-keys'
import { cn } from '@/lib/utils'
import { useComposerStore } from '@/stores/composer'
import { useDevice, useDeviceApi } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { DEFAULT_TREE_WIDTH, MAX_TREE_WIDTH, MIN_TREE_WIDTH, useFileTreeStore, type TreeTarget } from '@/stores/file-tree'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import FileContentResults from './FileContentResults.vue'
import FileNameDialog from './FileNameDialog.vue'
import FileTreeFilters from './FileTreeFilters.vue'

/**
 * The file tree of a chat, beside it (not over it), taken over from the Claude Manager: the folder with
 * its branch and changes on top, a search across all files, then the tree with git's marks and the
 * names of the files the agent reads, writes and commits lit up. A click on a file shows its changes
 * over the timeline. Entries go to the agent by the context menu (`@` mention into the composer) or by
 * dragging them into it.
 */
const props = defineProps<{
  target: TreeTarget
  side: FileTreeSide
  /** The widest the tree may be dragged in its area (px). */
  maxWidth: number
  /** The file whose changes are shown beside the tree, selected in it. */
  current?: string | null
}>()

const fileTree = useFileTreeStore()
const settings = useSettingsStore()
const ui = useUiStore()
const composer = useComposerStore()
const openPath = useOpenFile()
const model = useFileTreeModel(() => props.target.root)
/**
 * The tree is of the folder on the device of the chat (`useDevice`): its calls go there. Changing its
 * files takes that device's full level, a mention its prompt level; what opens in this computer's
 * programs (Explorer, the default program, dragging out) is only for this device's own trees.
 */
const device = useDevice()
const api = useDeviceApi()
const devices = useDevicesStore()
const local = device === null
const canWrite = computed(() => devices.can(device, 'full'))
const canPrompt = computed(() => devices.can(device, 'prompt'))

/** Paths of the folder's system: another device may run another one. */
const windows = computed(() => (local ? isWindows : fileTree.separatorOf(props.target.root) === '\\'))
const explorer = fileManagerLabel
const rootName = computed(() => folderName(props.target.root))

/** Rows follow the size of the interface's font (`text-sm`, like the session list). */
const rowHeight = computed(() => Math.round(settings.settings.appearance.uiFontSize * 1.86))
/**
 * A row is a rounded pill set in from the edges like the tabs in the sidebar (px): `INSET` from the
 * panel, `PAD` inside it, then `INDENT` per level and the chevron's `CHEVRON` wide slot.
 */
const INSET = 6
const PAD = 6
const INDENT = 14
const CHEVRON = 16
/** Where the guide down from a folder of `level` runs: below the middle of its chevron. */
const guideLeft = (level: number) => `${INSET + PAD + (level - 1) * INDENT + CHEVRON / 2 - 1}px`
/** Rows drawn beyond the visible ones, so scrolling doesn't show gaps. */
const OVERSCAN = 10

// ── Git ──

const git = computed(() => model.value.git)
const decorations = computed(() => gitDecorations(git.value))
const summary = computed(() =>
  GIT_STATUSES.flatMap((status) => {
    const count = decorations.value.counts[status] ?? 0
    return count ? [{ status, count }] : []
  }),
)
const branchLabel = computed(() => git.value?.branch ?? git.value?.commit ?? 'Noch kein Commit')
const branchTooltip = computed(() => {
  const g = git.value
  if (!g) return ''
  const lines = [g.branch ? `Branch ${g.branch}` : g.commit ? `Kein Branch ausgecheckt (Commit ${g.commit})` : 'Noch kein Commit']
  if (g.upstream) lines.push(`folgt ${g.upstream}`)
  if (g.ahead) lines.push(`${g.ahead} ${g.ahead === 1 ? 'Commit' : 'Commits'} noch nicht gepusht`)
  if (g.behind) lines.push(`${g.behind} ${g.behind === 1 ? 'Commit' : 'Commits'} noch nicht geholt`)
  return lines.join('\n')
})

// ── Filters ──

/** Which files the trees show: the changed ones, those the agent is at in the session, or both. */
const filters = fileTree.filters
/** A filter is switched on; whether the tree is filtered depends on there being something to show (`filtered`). */
const filterOn = computed(() => filters.changes || filters.activity)
/** Files git ignores, while they are hidden. */
const hidden = computed(() => (fileTree.showIgnored ? undefined : (path: string) => decorations.value.ignored(path)))
/** Folders git reports as new as a whole (`dir/`); their files come from the search's list. */
const untrackedDirs = computed(() => untrackedFolders(git.value))
/** The files git sees changed, deleted ones too, and those in new folders once the list of files is there. */
const changedPaths = computed(() => changedFiles(git.value, model.value.search?.paths))
const changesTooltip = computed(() => summary.value.map((item) => `${STATUS_LABEL[item.status]}: ${item.count}`).join(' · '))

/** What the agent is doing in the tab's session with the files of the tree, by their path in the tree. */
const recorded = computed(() => {
  const files = new Map<string, TouchRecord>()
  for (const [absolute, record] of fileTree.activityOf(props.target.id) ?? []) {
    const path = treePathOf(props.target.root, absolute, windows.value)
    if (path) files.set(path, record)
  }
  return files
})
/** How many files of the tree Claude touched in each way; the ignored ones while they show. */
const kindCounts = computed(() => {
  const counts: Record<FileTouchKind, number> = { read: 0, search: 0, write: 0, commit: 0 }
  for (const [path, record] of recorded.value) {
    if (hidden.value?.(path)) continue
    for (const kind of TOUCH_KINDS) if (record[kind] !== undefined) counts[kind]++
  }
  return counts
})

/** The strongest kind (of those shown) the agent is at each file of the tree with, while the activity filter is on. */
const activityKinds = computed(() => {
  const kinds = new Map<string, FileTouchKind>()
  if (!filters.activity) return kinds
  for (const [path, record] of recorded.value) {
    const kind = hidden.value?.(path) ? null : recordKind(record, fileTree.hiddenKinds)
    if (kind) kinds.set(path, kind)
  }
  return kinds
})

/** The files the filters let through: the changes in the states shown, the files the agent is at in the kinds shown. */
const filteredPaths = computed(() => {
  const paths = new Set<string>()
  if (filters.changes) {
    const marks = decorations.value
    for (const path of changedPaths.value) {
      const status = marks.file(path)?.status
      if (!status || !fileTree.hiddenStatuses.has(status)) paths.add(path)
    }
  }
  for (const path of activityKinds.value.keys()) paths.add(path)
  return [...paths]
})

// ── Coming and going ──
// Filtered, the tree shows what goes on: a file that comes in slides in, one the agent left alone (or
// that was committed) fades out before the rows below it move up. A change of the filters themselves
// just shows the other files, as does another chat.

const ENTER_MS = 450
const LEAVE_MS = 500

/** Files that just left the filtered tree, until they are gone, with the kind they showed. */
const leaving = shallowRef(new Map<string, { until: number; kind: FileTouchKind | null }>())
/** Files and folders that just came in, until their entrance is over. */
const entering = shallowRef(new Map<string, number>())
let motionTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(motionTimer))

/** What decides which files the filters let through, besides what happens to the files. */
const filterKey = computed(() =>
  JSON.stringify([
    props.target.id,
    props.target.root,
    filters.changes,
    filters.activity,
    fileTree.showIgnored,
    [...fileTree.hiddenStatuses].sort(),
    [...fileTree.hiddenKinds].sort(),
  ]),
)

/** The files and the folders they lie in. */
const withFolders = (paths: readonly string[]) => new Set([...paths, ...foldersOf(paths)])

watch([filteredPaths, filterKey, activityKinds] as const, ([next, key], [before, keyBefore, kindsBefore]) => {
  if (key !== keyBefore || !filterOn.value) {
    clearTimeout(motionTimer)
    if (leaving.value.size) leaving.value = new Map()
    if (entering.value.size) entering.value = new Map()
    return
  }
  const now = Date.now()
  const shown = new Set(next)
  const items = withFolders(next)
  const was = withFolders(before)
  // One that comes back while it fades out comes in anew.
  const gone = new Map([...leaving.value].filter(([path]) => !shown.has(path)))
  for (const path of before) if (!shown.has(path) && !gone.has(path)) gone.set(path, { until: now + LEAVE_MS, kind: kindsBefore.get(path) ?? null })
  const come = new Map([...entering.value].filter(([path]) => items.has(path)))
  for (const path of items) if (!was.has(path)) come.set(path, now + ENTER_MS)
  leaving.value = gone
  entering.value = come
  scheduleMotion()
})

/** Drops what has come in or gone once its motion is over. */
function scheduleMotion(): void {
  clearTimeout(motionTimer)
  const ends = [...[...leaving.value.values()].map((l) => l.until), ...entering.value.values()]
  if (ends.length === 0) return
  motionTimer = setTimeout(
    () => {
      const now = Date.now()
      leaving.value = new Map([...leaving.value].filter(([, l]) => l.until > now))
      entering.value = new Map([...entering.value].filter(([, until]) => until > now))
      scheduleMotion()
    },
    Math.max(0, Math.min(...ends) - Date.now()) + 20,
  )
}

/** What the filtered tree shows: the files the filters let through, and those still fading out. */
const shownPaths = computed(() => {
  if (leaving.value.size === 0) return filteredPaths.value
  const paths = new Set(filteredPaths.value)
  for (const path of leaving.value.keys()) paths.add(path)
  return [...paths]
})
/** Folders with a file the filters let through: a folder without one fades out with its files. */
const liveFolders = computed(() => new Set(foldersOf(filteredPaths.value)))

/**
 * The tree is filtered while a filter is on and there is something to show; with nothing, it shows
 * all files and turns to what comes up as soon as it does.
 */
const filtered = computed(() => filterOn.value && shownPaths.value.length > 0)

const filterLabel = computed(() =>
  filters.changes && filters.activity ? 'Änderungen und Aktivität' : filters.changes ? 'Änderungen' : 'Gerade aktiv',
)
/** Why a filter shows nothing, so the tree shows all files. */
const idleText = computed(() => {
  const changes = filters.changes && changedPaths.value.length > 0
  const touched = filters.activity && TOUCH_KINDS.some((kind) => kindCounts.value[kind] > 0)
  if (changes || touched) return 'Nichts in den gewählten Arten'
  if (filters.changes && filters.activity) return git.value ? 'Keine Änderungen, gerade keine Aktivität' : 'Gerade keine Aktivität'
  if (filters.changes) return git.value ? 'Keine Änderungen seit dem letzten Commit' : 'Kein Git-Repository'
  return 'Gerade keine Aktivität'
})

function showAll() {
  filters.changes = false
  filters.activity = false
}

// The filtered list starts at its top, at the selected entry if it has it; back to all files, the tree
// is where it was before something came up.
let treeScroll = 0
watch(
  () => [filters.changes, filters.activity, filtered.value] as const,
  ([, , isFiltered], [, , wasFiltered]) => {
    const el = scroller.value
    if (!el || (!isFiltered && !wasFiltered)) return
    if (!isFiltered) {
      void nextTick(() => (el.scrollTop = treeScroll))
      return
    }
    if (!wasFiltered) treeScroll = el.scrollTop
    el.scrollTop = 0
    void nextTick(() => {
      if (selected.value) revealRow(selected.value, true)
    })
  },
)

// ── Search ──

const query = computed({
  get: () => model.value.query,
  set: (value: string) => (model.value.query = value),
})
/** The tree is searched by name; a search of the files' content shows its hits instead of the tree. */
const searching = computed(() => query.value.trim().length > 0 && !model.value.searchContent)

// ── Searching the files' content ──

const content = useContentSearch(() => model.value)
/** Something is typed while the search looks into the files: its hits show, not the tree. */
const contentShown = computed(() => model.value.searchContent && query.value.trim().length > 0)
const contentResults = ref<InstanceType<typeof FileContentResults> | null>(null)
const searchPlaceholder = computed(() =>
  model.value.searchContent ? 'Im Inhalt suchen' : filtered.value ? 'Gefilterte Dateien suchen' : 'Dateien suchen',
)
const contentStatus = computed(() => {
  if (content.error.value) return content.error.value
  if (query.value.trim().length < MIN_CONTENT_QUERY) return 'Mindestens zwei Zeichen'
  const result = content.result.value
  if (!result) return null
  if (result.matches === 0) return 'Keine Treffer.'
  const files = result.files.length
  return `${result.matches} Treffer in ${files} ${files === 1 ? 'Datei' : 'Dateien'}${result.truncated ? ', nur die ersten' : ''}`
})

function toggleContent() {
  model.value.searchContent = !model.value.searchContent
  searchInput.value?.focus()
}

function openHit(path: string, line: number) {
  fileTree.showDiff(props.target, path, { line })
}

/** A letter typed in the hits goes on in the search. */
function typeInSearch(key: string) {
  query.value += key
  searchInput.value?.focus()
}

function refresh() {
  fileTree.refresh(model.value)
  content.refresh()
}
const searchInput = ref<HTMLInputElement | null>(null)

/** The list of all files is needed to search them, and for the files in new folders when the changes show. */
const listNeeded = computed(() => (filters.changes && untrackedDirs.value.length > 0) || (searching.value && !filtered.value))
watch(
  () => listNeeded.value && !model.value.searchLoading && (!model.value.search || model.value.searchStale),
  (load) => {
    if (load) void fileTree.loadSearch(model.value)
  },
  { immediate: true },
)

/** Files git deleted are still known to it, but gone from the disk; a filtered tree searches the files it shows. */
const searchPaths = computed(() => {
  if (filtered.value) return filteredPaths.value
  const paths = model.value.search?.paths ?? []
  const deleted = Object.entries(git.value?.files ?? {}).filter(([, s]) => s.status === 'deleted')
  if (deleted.length === 0) return paths
  const gone = new Set(deleted.map(([path]) => path))
  return paths.filter((path) => !gone.has(path))
})
const searchResult = computed(() =>
  searching.value && (filtered.value || model.value.search) ? searchTree(searchPaths.value, query.value) : null,
)

// ── Rows ──

const rows = computed<TreeRow[]>(() => {
  if (searching.value) return searchResult.value?.rows ?? []
  const m = model.value
  if (filtered.value) return filesTree(shownPaths.value, m.collapsedFiltered)
  return flattenTree({ listings: m.listings, errors: m.errors, expanded: m.expanded, hidden: hidden.value })
})
const entries = computed(() => rows.value.filter((row): row is Extract<TreeRow, { kind: 'entry' }> => row.kind === 'entry'))

const rootError = computed(() => model.value.errors.get('') ?? null)
const rootLoading = computed(() => !model.value.listings.has('') && !rootError.value)

// ── What the agent does ──

const TOUCH_INSIDE: Record<FileTouchKind, string> = {
  read: 'Der Agent liest eine Datei in diesem Ordner',
  search: 'Der Agent durchsucht Dateien in diesem Ordner',
  write: 'Der Agent schreibt eine Datei in diesem Ordner',
  commit: 'Der Agent hat Dateien in diesem Ordner committet',
}
const TOUCH_LABEL: Record<FileTouchKind, string> = {
  read: 'Der Agent liest die Datei',
  search: 'Der Agent durchsucht die Datei',
  write: 'Der Agent schreibt die Datei',
  commit: 'Der Agent hat die Datei committet',
}
/**
 * The files of the tree the tab's session touched lately (by their path in the tree), and the
 * folders they lie in with the strongest touch inside.
 */
const touched = computed(() => {
  const list = fileTree.touchesOf(props.target.id)
  if (!list) return null
  const files = new Map<string, FileTouchKind>()
  const folders = new Map<string, FileTouchKind>()
  for (const [absolute, touch] of list) {
    const path = treePathOf(props.target.root, absolute, windows.value)
    if (!path) continue
    files.set(path, touch.kind)
    for (const dir of ancestors(path)) {
      const before = folders.get(dir)
      if (!before || TOUCH_RANK[touch.kind] > TOUCH_RANK[before]) folders.set(dir, touch.kind)
    }
  }
  return files.size > 0 ? { files, folders } : null
})

// ── Drawing only the visible rows ──

const scroller = ref<HTMLElement | null>(null)
const { height: viewHeight } = useElementSize(scroller)
const scrollTop = ref(0)

onMounted(() => {
  if (scroller.value) scroller.value.scrollTop = model.value.scrollTop
  scrollTop.value = scroller.value?.scrollTop ?? 0
})

function onScroll() {
  scrollTop.value = scroller.value?.scrollTop ?? 0
  model.value.scrollTop = scrollTop.value
}

interface RowView {
  row: TreeRow
  index: number
  icon: FileIconInfo | null
  /** A file's own state in git. */
  state: GitFileState | null
  /** The strongest state of the files in a folder. */
  folderState: GitFileStatus | null
  ignored: boolean
  /** Claude read, wrote or committed this file a moment ago. */
  touch: FileTouchKind | null
  /** Claude touched a file inside this closed folder. */
  touchInside: FileTouchKind | null
  /** Filtered by activity: what the agent is at with the file lately, after its touch has stopped glowing. */
  activity: FileTouchKind | null
  /** Filtered: the row just came in, or fades out. */
  motion: 'enter' | 'leave' | null
}

/** Rows glide to their new place and come and go with an animation while the tree is filtered, not searched. */
const animated = computed(() => filtered.value && !searching.value)

const visibleRows = computed<RowView[]>(() => {
  const height = rowHeight.value
  const first = Math.max(0, Math.floor(scrollTop.value / height) - OVERSCAN)
  const last = Math.min(rows.value.length, Math.ceil((scrollTop.value + viewHeight.value) / height) + OVERSCAN)
  const marks = decorations.value
  const now = touched.value
  const motion = animated.value
  const kinds = filtered.value ? activityKinds.value : null
  return rows.value.slice(first, last).map((row, i) => {
    if (row.kind !== 'entry') {
      return {
        row,
        index: first + i,
        icon: null,
        state: null,
        folderState: null,
        ignored: false,
        touch: null,
        touchInside: null,
        activity: null,
        motion: null,
      }
    }
    const dir = row.entry.dir
    const gone = motion && (dir ? !liveFolders.value.has(row.path) : leaving.value.has(row.path))
    return {
      row,
      index: first + i,
      icon: fileIcon(row.path, row.entry, row.expanded),
      state: dir ? null : marks.file(row.path),
      folderState: dir ? marks.folder(row.path) : null,
      ignored: marks.ignored(row.path),
      touch: (!dir && now?.files.get(row.path)) || null,
      touchInside: (dir && !row.expanded && now?.folders.get(row.path)) || null,
      activity: (!dir && kinds && (kinds.get(row.path) ?? leaving.value.get(row.path)?.kind)) || null,
      motion: gone ? 'leave' : motion && entering.value.has(row.path) ? 'enter' : null,
    }
  })
})

/** Scrolls the row of `path` into view; `ahead`: out of view it comes to the upper third, not the edge. */
function revealRow(path: string, ahead = false) {
  const el = scroller.value
  const index = rows.value.findIndex((row) => row.path === path)
  if (!el || index === -1) return
  const top = index * rowHeight.value
  const outside = top < el.scrollTop || top + rowHeight.value > el.scrollTop + el.clientHeight
  if (ahead && outside) el.scrollTop = top - Math.round(el.clientHeight / 3)
  else if (top < el.scrollTop) el.scrollTop = top
  else if (top + rowHeight.value > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight.value - el.clientHeight
}

// ── Selecting and opening ──

const listFocused = ref(false)
const selected = computed(() => model.value.selected)

function select(path: string | null, scroll = true) {
  model.value.selected = path
  if (path && scroll) void nextTick(() => revealRow(path))
}

const abs = (path: string) => absolutePath(props.target.root, path, fileTree.separatorOf(props.target.root))

function toggleDir(path: string, open?: boolean) {
  const m = model.value
  if (filtered.value) {
    // Its folders are open unless closed here; the tree's own stay as they are.
    if ((open ?? m.collapsedFiltered.has(path)) === true) m.collapsedFiltered.delete(path)
    else m.collapsedFiltered.add(path)
  } else {
    fileTree.setExpanded(m, path, open ?? !m.expanded.has(path))
  }
}

const canCollapse = computed(() => {
  if (searching.value) return false
  if (filtered.value) return rows.value.some((row) => row.kind === 'entry' && row.expanded)
  return model.value.expanded.size > 0
})

function collapseAll() {
  const m = model.value
  if (filtered.value) for (const dir of foldersOf(filteredPaths.value)) m.collapsedFiltered.add(dir)
  else fileTree.collapseAll(m)
}

function openFile(path: string) {
  void openPath(abs(path))
}

/** Shows the file's changes over the chat's timeline. */
function showDiff(path: string) {
  fileTree.showDiff(props.target, path)
}

// The file whose changes are shown is the selected one. Closed, it isn't any more, unless the keyboard
// moved on from it; a selection left behind would look as if it were still open.
watch(
  () => [props.target.root, props.current] as const,
  ([root, path], before) => {
    if (path && path !== selected.value) select(path)
    else if (!path && before?.[0] === root && before[1] && before[1] === selected.value) select(null)
  },
  { immediate: true },
)

// A file Claude turns to scrolls into view, unless the tree is in use (focused or searched). Its folder
// may still be loading, so it waits for its row a moment.
let pendingReveal: string | null = null
let pendingTimer: ReturnType<typeof setTimeout> | undefined
function revealPending() {
  if (!pendingReveal || !rows.value.some((row) => row.path === pendingReveal)) return
  revealRow(pendingReveal, true)
  pendingReveal = null
}
watch(
  () => touched.value?.files,
  (files, before) => {
    if (!files || searching.value || listFocused.value) return
    const fresh = [...files].filter(([path, kind]) => before?.get(path) !== kind).map(([path]) => path)
    if (fresh.length === 0) return
    pendingReveal = fresh.at(-1)!
    clearTimeout(pendingTimer)
    pendingTimer = setTimeout(() => (pendingReveal = null), 3000)
    void nextTick(revealPending)
  },
)
watch(rows, () => {
  if (pendingReveal) void nextTick(revealPending)
})
onBeforeUnmount(() => clearTimeout(pendingTimer))

/** Leaves the search and shows the entry in the tree, its folders opened. */
function showInTree(path: string, dir: boolean) {
  query.value = ''
  const m = model.value
  if (filtered.value) for (const folder of ancestors(path)) m.collapsedFiltered.delete(folder)
  else fileTree.reveal(m, path)
  if (dir) toggleDir(path, true)
  select(path)
  scroller.value?.focus()
}

function onRowClick(row: TreeRow) {
  if (row.kind !== 'entry') return
  if (searching.value && row.entry.dir && !row.expanded) return showInTree(row.path, true)
  select(row.path, false)
  if (row.entry.dir && !searching.value) toggleDir(row.path)
  else if (!row.entry.dir) showDiff(row.path)
}

function onRowDoubleClick(row: TreeRow) {
  if (local && row.kind === 'entry' && !row.entry.dir) openFile(row.path)
}

function onDragStart(event: DragEvent, row: TreeRow) {
  if (!local || row.kind !== 'entry' || !event.dataTransfer) return
  const path = abs(row.path)
  event.dataTransfer.setData(FILE_TREE_DRAG_TYPE, path)
  event.dataTransfer.setData('text/plain', path)
  event.dataTransfer.effectAllowed = 'copy'
}

function onListKeydown(event: KeyboardEvent) {
  // The menu key and Shift+F10: the menu of the selected entry, below it. The key's own event goes to the
  // tree, and its menu would be the one of the folder.
  if (isMenuKey(event) && scroller.value) {
    event.preventDefault()
    const row = selected.value ? scroller.value.querySelector<HTMLElement>(`[data-path="${CSS.escape(selected.value)}"]`) : null
    openMenuBelow(row ?? scroller.value)
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const list = entries.value
  const index = list.findIndex((row) => row.path === selected.value)
  const current = index === -1 ? null : list[index]!
  const page = Math.max(1, Math.floor((scroller.value?.clientHeight ?? 0) / rowHeight.value) - 1)
  const moveTo = (i: number) => {
    const row = list[Math.max(0, Math.min(list.length - 1, i))]
    if (row) select(row.path)
  }
  switch (event.key) {
    case 'ArrowDown':
      moveTo(index + 1)
      break
    case 'ArrowUp':
      moveTo(index === -1 ? list.length - 1 : index - 1)
      break
    case 'PageDown':
      moveTo(index + page)
      break
    case 'PageUp':
      moveTo(index - page)
      break
    case 'Home':
      moveTo(0)
      break
    case 'End':
      moveTo(list.length - 1)
      break
    case 'ArrowRight':
      if (current?.entry.dir) {
        if (!current.expanded) {
          if (searching.value) showInTree(current.path, true)
          else toggleDir(current.path, true)
        } else moveTo(index + 1)
      }
      break
    case 'ArrowLeft':
      if (current?.entry.dir && current.expanded && !searching.value) toggleDir(current.path, false)
      else if (current && parentPath(current.path)) select(parentPath(current.path))
      break
    case 'Enter':
      if (!current) return
      if (current.entry.dir) {
        if (searching.value) showInTree(current.path, true)
        else toggleDir(current.path)
      } else showDiff(current.path)
      break
    case 'F2':
      if (!current || isGone(current.path) || !canWrite.value) return
      rename(current.path, current.entry.dir)
      break
    case 'Delete':
      if (!current || isGone(current.path) || !canWrite.value) return
      void trash(current.path, current.entry.dir)
      break
    case 'Escape':
      if (!searching.value) return
      query.value = ''
      break
    default:
      // Typing in the tree searches.
      if (event.key.length === 1 && event.key !== ' ') {
        query.value += event.key
        searchInput.value?.focus()
        break
      }
      return
  }
  event.preventDefault()
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && query.value) {
    query.value = ''
    event.preventDefault()
  } else if ((event.key === 'ArrowDown' || event.key === 'Enter') && contentShown.value) {
    event.preventDefault()
    contentResults.value?.focusFirst()
  } else if ((event.key === 'ArrowDown' || event.key === 'Enter') && entries.value.length) {
    event.preventDefault()
    // The first file that matched, else the first row.
    const first = entries.value.find((row) => row.match && !row.entry.dir) ?? entries.value[0]!
    select(first.path)
    scroller.value?.focus()
  }
}

// ── The context menu ──

/** The entry the context menu is for; the tree's folder itself on an empty spot. */
const menuTarget = ref<{ path: string; dir: boolean }>({ path: '', dir: true })
/** How git sees the file the context menu is for; null for a folder and an unchanged file. */
const menuState = computed(() => (menuTarget.value.dir ? null : decorations.value.file(menuTarget.value.path)))
const gitActions = useGitActions()

async function onGit(action: 'stage' | 'unstage' | 'discard', path: string) {
  const state = decorations.value.file(path)
  if (!state) return
  const root = props.target.root
  const done =
    action === 'stage'
      ? await gitActions.stage(root, path)
      : action === 'unstage'
        ? await gitActions.unstage(root, path)
        : await gitActions.discard(root, path, state.status)
  if (done) fileTree.refresh(model.value)
}

/** The folder new entries of the context menu go in: the entry's own, or the one a file lies in. */
const menuFolder = computed(() => (menuTarget.value.dir ? menuTarget.value.path : parentPath(menuTarget.value.path)))

function onContextMenu(event: MouseEvent) {
  const path = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-path]')?.dataset.path
  const row = path === undefined ? undefined : entries.value.find((r) => r.path === path)
  menuTarget.value = row ? { path: row.path, dir: row.entry.dir } : { path: '', dir: true }
  if (row) select(row.path, false)
}

/**
 * A mention from the context menu, put in once the menu has closed: while it is open it holds the
 * keyboard, and on closing it would give it back to the tree instead of the composer.
 */
let pendingMention: string | null = null
let mentionTimer: ReturnType<typeof setTimeout> | undefined

/** Hands the entry to the agent: an `@` mention (relative to the project) at the composer's cursor. */
function mention(path: string, dir: boolean) {
  pendingMention = mentionOf(path, dir)
  // Should the menu not report its closing, the mention still arrives.
  clearTimeout(mentionTimer)
  mentionTimer = setTimeout(insertMention, 500)
}

function insertMention() {
  clearTimeout(mentionTimer)
  if (pendingMention) composer.insert(props.target.id, pendingMention)
  pendingMention = null
}

function onMenuCloseFocus(event: Event) {
  if (!pendingMention) return
  event.preventDefault()
  insertMention()
}
onBeforeUnmount(insertMention)

function copy(text: string) {
  void attempt(() => navigator.clipboard.writeText(text), 'Konnte nicht kopiert werden')
}

function showItem(path: string) {
  void attempt(() => window.api.app.showItem(abs(path)), `Konnte nicht im ${explorer} gezeigt werden`)
}

function openFolder(path: string) {
  void attempt(() => window.api.app.openPath(abs(path)), 'Ordner konnte nicht geöffnet werden')
}

// ── Making, renaming and deleting entries ──

/** What the name dialog is open for. */
const nameRequest = ref<NameRequest | null>(null)

/** A file git deleted: it shows, but isn't on the disk any more. */
function isGone(path: string): boolean {
  return decorations.value.file(path)?.status === 'deleted'
}

function create(kind: NameKind, parent: string) {
  nameRequest.value = { kind, parent, name: '', dir: kind === 'folder' }
}

function rename(path: string, dir: boolean) {
  nameRequest.value = { kind: 'rename', parent: parentPath(path), name: path.slice(path.lastIndexOf('/') + 1), dir }
}

/**
 * Made or renamed: the tree shows the entry at once and selects it. A renamed folder stays open, and the
 * changes shown of a renamed file follow it.
 */
function onNamed(path: string, request: NameRequest) {
  nameRequest.value = null
  const m = model.value
  if (request.kind === 'rename') {
    const from = childPath(request.parent, request.name)
    if (request.dir && m.expanded.has(from)) fileTree.setExpanded(m, path, true)
    const current = props.current
    if (current && (current === from || current.startsWith(`${from}/`))) showDiff(path + current.slice(from.length))
  }
  query.value = ''
  if (filtered.value) for (const folder of ancestors(path)) m.collapsedFiltered.delete(folder)
  else fileTree.reveal(m, path)
  fileTree.refresh(m)
  selectWhenShown(path)
  scroller.value?.focus()
}

/** Selects the entry once its row is there: its folder is read again first. */
function selectWhenShown(path: string) {
  if (rows.value.some((row) => row.path === path)) return select(path)
  const stop = watch(rows, (list) => {
    if (!list.some((row) => row.path === path)) return
    stop()
    clearTimeout(timer)
    select(path)
  })
  const timer = setTimeout(stop, 3000)
}

/** Moves the entry to the recycle bin, once asked; the selection goes on to the next entry, like in Explorer. */
async function trash(path: string, dir: boolean) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const confirmed = await ui.confirm({
    title: `„${name}“ in den Papierkorb verschieben?`,
    description: dir
      ? 'Der Ordner kommt mit allem darin in den Papierkorb. Dort lässt er sich wiederherstellen.'
      : 'Aus dem Papierkorb lässt sich die Datei wiederherstellen.',
    confirmText: 'In den Papierkorb',
    destructive: true,
  })
  if (!confirmed) return
  const list = entries.value
  const index = list.findIndex((row) => row.path === path)
  const inside = (other: string) => other === path || other.startsWith(`${path}/`)
  const next = list.slice(index + 1).find((row) => !inside(row.path)) ?? list[index - 1]
  const done = await attempt(async () => {
    await api.files.trash(props.target.root, path)
    return true
  }, 'Nicht in den Papierkorb verschoben')
  if (!done) return
  fileTree.refresh(model.value)
  if (selected.value && inside(selected.value)) select(next?.path ?? null)
  scroller.value?.focus()
}

// ── Width ──

const panel = ref<HTMLElement | null>(null)
const resizing = ref(false)
let endResize: (() => void) | null = null

/** The tree's edge moved with the keyboard, 16 px a step; on the right its width grows to the left. */
function onResizeKey(event: KeyboardEvent) {
  const width = separatorValue(event, true, {
    value: fileTree.width,
    min: MIN_TREE_WIDTH,
    max: MAX_TREE_WIDTH,
    step: 16,
    initial: DEFAULT_TREE_WIDTH,
    reversed: props.side === 'right',
  })
  if (width === null) return
  event.preventDefault()
  fileTree.setWidth(width)
}

function onResizeStart(event: PointerEvent) {
  if (event.button !== 0 || !panel.value) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const bounds = panel.value.getBoundingClientRect()
  resizing.value = true
  // The pages of browsers would take the pointer as it passes over them.
  document.documentElement.dataset.resizing = 'col'
  const move = (e: PointerEvent) => {
    const width = props.side === 'left' ? e.clientX - bounds.left : bounds.right - e.clientX
    fileTree.setWidth(Math.min(width, props.maxWidth))
  }
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    resizing.value = false
    delete document.documentElement.dataset.resizing
    endResize = null
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  endResize = end
}
onBeforeUnmount(() => endResize?.())

const iconButton =
  'flex size-[24px] shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 aria-expanded:bg-accent aria-expanded:text-foreground'
</script>

<template>
  <aside
    ref="panel"
    data-slot="file-tree"
    aria-label="Dateibaum"
    class="flex min-w-0 flex-col overflow-visible text-foreground select-none"
  >
    <!-- The folder, like a section of VS Code's Explorer, with the tree's actions. -->
    <div class="flex h-[38px] shrink-0 items-center gap-0.5 pr-2 pl-3">
      <span class="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase" v-tooltip="target.root">
        {{ rootName }}
      </span>
      <Tooltip>
        <TooltipTrigger as-child>
          <button type="button" aria-label="Aktualisieren" :class="iconButton" @click="refresh">
            <RefreshCwIcon class="size-[16px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Aktualisieren</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            aria-label="Alle Ordner zuklappen"
            :class="iconButton"
            :disabled="!canCollapse"
            @click="collapseAll"
          >
            <ChevronsDownUpIcon class="size-[16px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Alle Ordner zuklappen</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button type="button" aria-label="Weitere Aktionen" :class="iconButton">
            <EllipsisIcon class="size-[16px]" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-60">
          <template v-if="canWrite">
            <DropdownMenuItem @select="create('file', '')">
              <FilePlusIcon />
              Neue Datei…
            </DropdownMenuItem>
            <DropdownMenuItem @select="create('folder', '')">
              <FolderPlusIcon />
              Neuer Ordner…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </template>
          <DropdownMenuItem v-if="local" @select="openFolder('')">
            <FolderOpenIcon />
            Im {{ explorer }} öffnen
          </DropdownMenuItem>
          <DropdownMenuItem @select="copy(target.root)">
            <CopyIcon />
            Pfad kopieren
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem @select="fileTree.open = false">
            <XIcon />
            Dateibaum schließen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Branch with how far it is from its upstream, and the changes by kind, like the plugin's branch row;
         at its end the button for all changes one below the other, and the filters' one. Also without git,
         so the filters' button has its place. -->
    <div class="-mt-1 flex h-[24px] shrink-0 items-center gap-1.5 pr-2 pl-3 text-xs text-muted-foreground">
      <span v-if="git" class="flex min-w-0 items-center gap-2" v-tooltip="branchTooltip">
        <GitCommitHorizontalIcon v-if="!git.branch" class="size-3.5 shrink-0" />
        <GitBranchIcon v-else class="size-3.5 shrink-0" />
        <span :class="cn('truncate', !git.branch && 'font-mono')">{{ branchLabel }}</span>
        <span v-if="git.ahead" class="flex shrink-0 items-center tabular-nums"><ArrowUpIcon class="size-[12px]" />{{ git.ahead }}</span>
        <span v-if="git.behind" class="flex shrink-0 items-center tabular-nums"><ArrowDownIcon class="size-[12px]" />{{ git.behind }}</span>
      </span>
      <span class="flex-1" />
      <!-- The changes by kind. -->
      <span v-if="summary.length" class="mr-1 flex shrink-0 items-center gap-1.5" v-tooltip="changesTooltip">
        <span
          v-for="item in summary"
          :key="item.status"
          :class="cn('font-mono text-[11px] font-medium tabular-nums', STATUS_CLASS[item.status])"
        >
          {{ STATUS_LETTER[item.status] }}{{ item.count }}
        </span>
      </span>
      <!-- All changes one below the other, to review them like a pull request. -->
      <Tooltip v-if="summary.length">
        <TooltipTrigger as-child>
          <button type="button" aria-label="Alle Änderungen ansehen" :class="iconButton" @click="showDiff('')">
            <FileDiffIcon class="size-[16px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Alle Änderungen untereinander ansehen</TooltipContent>
      </Tooltip>
      <!-- Unfolds the filters; while one holds, a dot on it says so. -->
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            aria-label="Filter"
            :aria-pressed="fileTree.filtersOpen"
            :class="cn(iconButton, 'relative aria-pressed:bg-accent aria-pressed:text-foreground')"
            @click="fileTree.filtersOpen = !fileTree.filtersOpen"
          >
            <ListFilterIcon class="size-[16px]" />
            <span v-if="filtered" class="absolute top-[3px] right-[3px] size-[6px] rounded-full bg-primary" />
          </button>
        </TooltipTrigger>
        <TooltipContent class="flex-col items-start gap-0.5">
          <span>{{ fileTree.filtersOpen ? 'Filter zuklappen' : 'Filter' }}</span>
          <span v-if="filtered" class="opacity-70">{{ filterLabel }}</span>
        </TooltipContent>
      </Tooltip>
    </div>

    <FileTreeFilters
      v-if="fileTree.filtersOpen"
      :statuses="summary"
      :kinds="kindCounts"
      :git="!!git"
      :session-id="target.id"
    />

    <!-- Search by name across every folder, the open ones or not. -->
    <!-- Like the search in the title bar. -->
    <div class="shrink-0 px-[6px] pt-2 pb-1.5">
      <label
        class="flex h-7 items-center rounded-lg bg-foreground/5 text-xs ring-1 ring-foreground/10 transition-colors focus-within:ring-2 focus-within:ring-ring/50 hover:bg-foreground/8"
      >
        <SearchIcon class="ml-2.5 size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :aria-label="searchPlaceholder"
          :placeholder="searchPlaceholder"
          class="h-full min-w-0 flex-1 bg-transparent px-2 outline-none placeholder:text-muted-foreground"
          @keydown="onSearchKeydown"
        />
        <Spinner
          v-if="(searching && model.searchLoading) || (contentShown && content.loading.value)"
          class="mr-1.5 size-[14px] text-muted-foreground"
        />
        <button
          v-if="query"
          type="button"
          aria-label="Suche leeren"
          class="mr-1 flex size-[20px] shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          @click="query = ''"
        >
          <XIcon class="size-[12px]" />
        </button>
        <!-- Name or content, like the switches in VS Code's search. -->
        <button
          type="button"
          aria-label="Im Inhalt der Dateien suchen"
          :aria-pressed="model.searchContent"
          class="mr-1 flex size-[20px] shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground aria-pressed:bg-primary/20 aria-pressed:text-foreground"
          v-tooltip="model.searchContent ? 'Sucht im Inhalt der Dateien, ein Klick sucht nach Namen' : 'Im Inhalt der Dateien suchen'"
          @click="toggleContent"
        >
          <TextSearchIcon class="size-[13px]" />
        </button>
      </label>
      <p
        v-if="contentShown && contentStatus"
        :class="cn('px-2.5 pt-1.5 text-[11px]', content.error.value ? 'text-destructive' : 'text-muted-foreground')"
      >
        {{ contentStatus }}
      </p>
      <p v-else-if="searching && searchResult" class="px-2.5 pt-1.5 text-[11px] text-muted-foreground">
        {{
          searchResult.matches === 0
            ? 'Keine Datei passt.'
            : searchResult.matches > 400
              ? `${searchResult.matches} Treffer, die besten 400`
              : `${searchResult.matches} ${searchResult.matches === 1 ? 'Treffer' : 'Treffer'}`
        }}
        <template v-if="model.search?.truncated && !filtered"> · nicht alle Dateien durchsucht</template>
      </p>
      <p v-else-if="filtered && filteredPaths.length && !contentShown" class="flex items-center gap-1.5 px-2.5 pt-1.5 text-[11px] text-muted-foreground">
        <!-- Something goes on: the dot glows while the agent is at a file. -->
        <span v-if="filters.activity" class="relative flex size-[6px] shrink-0" aria-hidden="true">
          <span v-if="touched" class="absolute inset-0 animate-ping rounded-full bg-success/60 motion-reduce:hidden" />
          <span :class="cn('relative size-[6px] rounded-full transition-colors', touched ? 'bg-success' : 'bg-success/50')" />
        </span>
        <span class="min-w-0 truncate">
          {{ filterLabel }}: {{ filteredPaths.length }} {{ filteredPaths.length === 1 ? 'Datei' : 'Dateien' }}
          <template v-if="filters.changes && git && (git.truncated || (untrackedDirs.length && model.search?.truncated))"> · nicht alle</template>
        </span>
        <button
          type="button"
          class="ml-auto shrink-0 cursor-pointer rounded px-1 text-foreground/80 hover:bg-accent hover:text-foreground"
          @click="showAll"
        >
          Alle zeigen
        </button>
      </p>
      <!-- A filter is on, but there is nothing to show: all files, until something comes up. -->
      <p
        v-else-if="filterOn && !filteredPaths.length && !contentShown"
        class="flex items-center gap-1.5 px-2.5 pt-1.5 text-[11px] text-muted-foreground"
        v-tooltip="'Tut sich etwas, zeigt der Baum nur das'"
      >
        <span class="size-[6px] shrink-0 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ idleText }} · alle Dateien</span>
      </p>
    </div>

    <div v-if="rootError" class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
      <FolderXIcon class="size-[24px]" />
      <span class="font-medium text-foreground">{{ rootError }}</span>
      <span class="break-all">{{ target.root }}</span>
    </div>
    <div v-else-if="rootLoading" class="flex flex-1 justify-center pt-6">
      <Spinner class="size-[16px] text-muted-foreground" />
    </div>
    <template v-else-if="contentShown">
      <FileContentResults
        v-if="content.result.value?.files.length"
        ref="contentResults"
        :result="content.result.value"
        @open="openHit"
        @type="typeInSearch"
        @leave="searchInput?.focus()"
      />
      <div v-else class="flex-1" />
    </template>
    <ContextMenu v-else>
      <ContextMenuTrigger as-child>
        <div
          ref="scroller"
          role="tree"
          aria-label="Dateien"
          tabindex="0"
          class="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-2 text-sm outline-none"
          @scroll.passive="onScroll"
          @keydown="onListKeydown"
          @focus="listFocused = true"
          @blur="listFocused = false"
          @contextmenu="onContextMenu"
        >
          <!-- All files and the filtered ones are two lists: the one that takes over fades in. -->
          <div :key="filtered ? 'filtered' : 'all'" class="file-tree-swap relative w-full" :style="{ height: `${rows.length * rowHeight}px` }">
            <template v-for="view in visibleRows" :key="view.row.path">
              <div
                v-if="view.row.kind === 'entry'"
                role="treeitem"
                :data-path="view.row.path"
                :aria-level="view.row.depth + 1"
                :aria-expanded="view.row.entry.dir ? view.row.expanded : undefined"
                :aria-selected="selected === view.row.path"
                :draggable="local"
                :class="
                  cn(
                    'group/row absolute inset-x-0 top-0 cursor-pointer',
                    animated && 'file-tree-glide',
                    view.motion === 'enter' && 'file-tree-enter',
                    view.motion === 'leave' && 'file-tree-leave',
                  )
                "
                :style="{ transform: `translateY(${view.index * rowHeight}px)`, height: `${rowHeight}px` }"
                @click="onRowClick(view.row)"
                @dblclick="onRowDoubleClick(view.row)"
                @dragstart="onDragStart($event, view.row)"
              >
                <!-- Guides down from each folder the entry lies in, over the pill, so they run through a selected row. -->
                <span
                  v-for="level in view.row.depth"
                  :key="level"
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-y-0 z-[1] w-px bg-border"
                  :style="{ left: guideLeft(level) }"
                />
                <!-- The row: selected it stands out like the search above it, while the agent is at the file in its colour. -->
                <div
                  :data-touch="view.touch ?? view.touchInside ?? undefined"
                  :class="
                    cn(
                      'file-tree-pill absolute inset-x-[6px] inset-y-px flex items-center rounded-md pr-1.5 transition-[background-color,box-shadow] duration-300',
                      selected === view.row.path
                        ? cn('bg-foreground/8 shadow-sm ring-1', listFocused ? 'ring-ring/60' : 'ring-foreground/12')
                        : 'group-hover/row:bg-foreground/5',
                      view.touch && 'file-tree-touch-row',
                    )
                  "
                  :style="{ paddingLeft: `${PAD + view.row.depth * INDENT}px`, '--row-start': `${PAD + view.row.depth * INDENT + CHEVRON}px` }"
                >
                  <span class="flex shrink-0 justify-center" :style="{ width: `${CHEVRON}px` }">
                    <ChevronRightIcon
                      v-if="view.row.entry.dir"
                      :class="cn('size-3.5 text-muted-foreground transition-transform duration-150', view.row.expanded && 'rotate-90')"
                    />
                  </span>
                  <component :is="view.icon!.icon" :class="cn('ml-1 size-[15px] shrink-0', view.icon!.class, view.ignored && 'opacity-50')" />
                  <span
                    :class="
                      cn(
                        'ml-2 min-w-0 flex-1 truncate',
                        view.state ? STATUS_CLASS[view.state.status] : view.folderState && STATUS_CLASS[view.folderState],
                        view.state?.status === 'deleted' && 'line-through',
                        view.ignored && !view.touch && 'opacity-50',
                        view.touch && 'file-tree-touch',
                        view.touchInside && 'file-tree-touch-folder',
                      )
                    "
                  >
                    <template v-if="view.row.match">
                      {{ view.row.name.slice(0, view.row.match[0])
                      }}<mark class="rounded-[3px] bg-primary/25 text-inherit">{{ view.row.name.slice(view.row.match[0], view.row.match[1]) }}</mark
                      >{{ view.row.name.slice(view.row.match[1]) }}
                    </template>
                    <template v-else>{{ view.row.name }}</template>
                  </span>
                  <ArrowUpRightIcon v-if="view.row.entry.link && !view.row.entry.broken" class="ml-1 size-3 shrink-0 text-muted-foreground" />
                  <span
                    v-if="view.state && (view.state.added || view.state.removed)"
                    class="ml-2 shrink-0 font-mono text-[0.75rem] tabular-nums"
                  >
                    <span v-if="view.state.added" class="text-success">+{{ view.state.added }}</span>
                    <span v-if="view.state.added && view.state.removed">&nbsp;</span>
                    <span v-if="view.state.removed" class="text-destructive">−{{ view.state.removed }}</span>
                  </span>
                  <!-- What the agent does with the file, in its colour; filtered by activity, quieter after the moment. -->
                  <component
                    :is="TOUCH_ICON[view.touch]"
                    v-if="view.touch"
                    role="status"
                    :aria-label="TOUCH_LABEL[view.touch]"
                    class="file-tree-touch-icon ml-2 size-3.5 shrink-0"
                  />
                  <span
                    v-else-if="view.activity"
                    :data-touch="view.activity"
                    class="ml-2 flex shrink-0"
                    :aria-label="`Gerade vom Agenten ${TOUCH_DONE[view.activity]}`"
                    v-tooltip="`Gerade vom Agenten ${TOUCH_DONE[view.activity]}`"
                  >
                    <component :is="TOUCH_ICON[view.activity]" class="size-3.5 text-(--touch) opacity-60" />
                  </span>
                  <span
                    v-if="view.touchInside"
                    class="relative ml-2 flex w-[12px] shrink-0 items-center justify-center"
                    role="status"
                    :aria-label="TOUCH_INSIDE[view.touchInside]"
                    v-tooltip="TOUCH_INSIDE[view.touchInside]"
                  >
                    <span class="file-tree-touch-dot absolute size-[8px] animate-ping rounded-full opacity-70 motion-reduce:hidden" />
                    <span class="file-tree-touch-dot relative size-[6px] rounded-full" />
                  </span>
                  <span
                    v-else-if="view.state"
                    :class="cn('ml-2 w-[12px] shrink-0 text-center font-mono text-[0.75rem] font-semibold', STATUS_CLASS[view.state.status])"
                    v-tooltip="STATUS_LABEL[view.state.status] + (view.state.staged ? ', vorgemerkt' : '')"
                  >
                    {{ STATUS_LETTER[view.state.status] }}
                  </span>
                  <span v-else-if="view.folderState" class="ml-2 flex w-[12px] shrink-0 justify-center">
                    <span :class="cn('size-[6px] rounded-full bg-current', STATUS_CLASS[view.folderState])" />
                  </span>
                </div>
              </div>
              <div
                v-else
                class="absolute inset-x-0 top-0 flex items-center pr-3 text-xs text-muted-foreground italic"
                :style="{
                  transform: `translateY(${view.index * rowHeight}px)`,
                  height: `${rowHeight}px`,
                  paddingLeft: `${INSET + PAD + view.row.depth * INDENT + CHEVRON + 4}px`,
                }"
              >
                <span :class="cn('truncate', view.row.kind === 'message' && view.row.error && 'text-destructive not-italic')">
                  {{ view.row.kind === 'more' ? `… ${view.row.count} weitere Einträge` : view.row.text }}
                </span>
              </div>
            </template>
          </div>
          <!-- Filtered, there is always something: with nothing to show the tree shows all files. -->
          <div v-if="rows.length === 0 && !searching" class="px-4 pt-3 text-center text-xs text-muted-foreground">Der Ordner ist leer.</div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-64" @close-auto-focus="onMenuCloseFocus">
        <ContextMenuItem v-if="menuTarget.path && canPrompt" @select="mention(menuTarget.path, menuTarget.dir)">
          <AtSignIcon />
          Im Chat erwähnen
        </ContextMenuItem>
        <ContextMenuItem v-if="!menuTarget.dir" @select="showDiff(menuTarget.path)">
          <GitCompareIcon />
          Änderungen zeigen
        </ContextMenuItem>
        <template v-if="local">
          <ContextMenuItem v-if="!menuTarget.dir" @select="openFile(menuTarget.path)">
            <ExternalLinkIcon />
            Mit Standardprogramm öffnen
          </ContextMenuItem>
          <ContextMenuItem v-else @select="openFolder(menuTarget.path)">
            <FolderOpenIcon />
            Im {{ explorer }} öffnen
          </ContextMenuItem>
          <ContextMenuItem v-if="menuTarget.path" @select="showItem(menuTarget.path)">
            <SearchIcon />
            Im {{ explorer }} zeigen
          </ContextMenuItem>
        </template>
        <ContextMenuItem v-if="searching && menuTarget.path" @select="showInTree(menuTarget.path, false)">
          <ListTreeIcon />
          Im Baum zeigen
        </ContextMenuItem>
        <template v-if="menuState && canWrite">
          <ContextMenuSeparator />
          <ContextMenuItem @select="onGit('stage', menuTarget.path)">
            <PlusIcon />
            Vormerken
          </ContextMenuItem>
          <ContextMenuItem v-if="menuState.staged" @select="onGit('unstage', menuTarget.path)">
            <MinusIcon />
            Nicht mehr vormerken
          </ContextMenuItem>
          <ContextMenuItem :variant="menuState.status === 'deleted' ? 'default' : 'destructive'" @select="onGit('discard', menuTarget.path)">
            <Undo2Icon />
            {{ menuState.status === 'deleted' ? 'Wiederherstellen…' : 'Änderungen verwerfen…' }}
          </ContextMenuItem>
        </template>
        <template v-if="canWrite">
          <ContextMenuSeparator />
          <ContextMenuItem @select="create('file', menuFolder)">
            <FilePlusIcon />
            Neue Datei…
          </ContextMenuItem>
          <ContextMenuItem @select="create('folder', menuFolder)">
            <FolderPlusIcon />
            Neuer Ordner…
          </ContextMenuItem>
        </template>
        <template v-if="canWrite && menuTarget.path && !isGone(menuTarget.path)">
          <ContextMenuItem @select="rename(menuTarget.path, menuTarget.dir)">
            <PencilIcon />
            Umbenennen…
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" @select="trash(menuTarget.path, menuTarget.dir)">
            <Trash2Icon />
            In den Papierkorb
            <ContextMenuShortcut>Entf</ContextMenuShortcut>
          </ContextMenuItem>
        </template>
        <ContextMenuSeparator />
        <ContextMenuItem @select="copy(abs(menuTarget.path))">
          <CopyIcon />
          Pfad kopieren
        </ContextMenuItem>
        <ContextMenuItem v-if="menuTarget.path" @select="copy(menuTarget.path)">
          <CopyIcon />
          Relativen Pfad kopieren
        </ContextMenuItem>
        <template v-if="menuTarget.path && ancestors(menuTarget.path).length && !searching">
          <ContextMenuSeparator />
          <ContextMenuItem @select="toggleDir(parentPath(menuTarget.path), false)">
            <ChevronsDownUpIcon />
            Übergeordneten Ordner zuklappen
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenu>

    <FileNameDialog :root="target.root" :root-name="rootName" :request="nameRequest" @close="nameRequest = null" @done="onNamed" />

    <!-- The tree's inner edge: a line to drag its width by, like the dividers between groups. -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite des Dateibaums ändern"
      tabindex="0"
      :aria-valuenow="Math.round(fileTree.width)"
      :aria-valuemin="MIN_TREE_WIDTH"
      :aria-valuemax="MAX_TREE_WIDTH"
      :class="cn('group/handle absolute inset-y-0 z-20 w-[9px] cursor-col-resize outline-none', side === 'left' ? '-right-[4px]' : '-left-[4px]')"
      @pointerdown="onResizeStart"
      @dblclick="fileTree.setWidth(DEFAULT_TREE_WIDTH)"
      @keydown="onResizeKey"
    >
      <div
        :class="
          cn(
            'absolute inset-y-0 left-[4px] w-px bg-border transition-colors group-hover/handle:bg-primary/60 group-focus-visible/handle:bg-primary',
            resizing && 'bg-primary/60',
          )
        "
      />
    </div>
  </aside>
</template>
