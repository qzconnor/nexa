<script setup lang="ts">
import { ArchiveIcon, ChevronRightIcon, CircleHelpIcon, FolderIcon, MonitorIcon, PinIcon, SearchIcon } from '@lucide/vue'
import { refDebounced } from '@vueuse/core'
import { injectListboxRootContext, ListboxContent, ListboxFilter, ListboxGroup, ListboxGroupLabel, ListboxItem } from 'reka-ui'
import { computed, nextTick, onMounted, watch } from 'vue'
import { subfolderSegments } from '@shared/folders'
import { PROVIDERS } from '@shared/providers'
import type { Project, SessionMeta, SessionSearchHit } from '@shared/types'
import { searchTerms } from '@shared/utils'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Spinner } from '@/components/ui/spinner'
import { useChatActions } from '@/composables/useChatActions'
import { useClock } from '@/composables/useClock'
import { useSessionSearch } from '@/composables/useSessionSearch'
import { chatSources, matchChats, recentChats, searchedDevices, startsChats, type ChatEntry, type ChatMatch } from '@/lib/device-chats'
import { formatRelative } from '@/lib/format'
import { containsTerms, searchText } from '@/lib/search'
import { chatKey } from '@/lib/session-tree'
import { cn } from '@/lib/utils'
import { useShownDeviceStore } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'

/** Chats listed at most for a search; with more, another word narrows it down better than scrolling. */
const MAX_CHATS = 50
/** Chats offered to carry on with before anything is typed. */
const RECENT_CHATS = 8
/** Projects listed at most for a search. */
const MAX_PROJECTS = 6

/**
 * The chats and projects, searched by title, project and folder and through the conversations: the
 * quick open's mode without a prefix, like VS Code's "Go to File". Lives inside a ListboxRoot, whose
 * keyboard navigation it drives from the input. Before anything is typed it offers the other modes
 * and the latest chats. Those of the other devices shown in the sidebar (Remote Control) come along,
 * marked with their device, and open there as from the sidebar.
 */
const emit = defineEmits<{ done: [] }>()
/** What is typed; a prefix (`>`, `?`) switches the quick open to another mode. */
const query = defineModel<string>('query', { required: true })

const ui = useUiStore()
const devices = useDevicesStore()
const shown = useShownDeviceStore()
const listbox = injectListboxRootContext()
// Every 30 seconds: `formatRelative` takes a time up to 45 seconds ago as just now.
const now = useClock(30_000)

/** This device and every other one whose chats are loaded here (the hidden ones are not among them). */
const sources = computed(() => chatSources(devices.devices))

/** Each device's chat actions, made once: the rows ask them for their state on every render. */
const actions = new Map<string, ReturnType<typeof useChatActions>>()
function actionsOf(device: string | null): ReturnType<typeof useChatActions> {
  let found = actions.get(device ?? '')
  if (!found) actions.set(device ?? '', (found = useChatActions(device)))
  return found
}

/** Titles are filtered on every key, the conversations shortly after typing stops. */
const terms = computed(() => searchTerms(query.value))
const { hits, searching, prepare } = useSessionSearch(
  refDebounced(query, 150),
  computed(() => searchedDevices(sources.value)),
)

onMounted(() => {
  prepare()
  listbox.highlightFirstItem()
})

/** Where a chat works: its project, and the folder in it if it isn't the project's own. */
function placeOf(device: string | null, meta: SessionMeta): string {
  const project = useProjectsStore(device).get(meta.projectId)
  if (!project) return ''
  const sub = meta.cwd ? subfolderSegments(meta.cwd, project.path).join('/') : ''
  return sub ? `${project.name} / ${sub}` : project.name
}

interface IndexedChat extends ChatEntry {
  device: string | null
  /** Another device's name. */
  deviceName?: string
}

/** Every chat of every device with the text its title search runs on; a device's name finds its chats too. */
const indexed = computed<IndexedChat[]>(() =>
  sources.value.flatMap(({ id, name }) =>
    useSessionsStore(id).metas.map((meta) => ({
      key: chatKey(id, meta.id),
      device: id,
      deviceName: name,
      meta,
      text: searchText(meta.title, meta.preview, placeOf(id, meta), meta.cwd, name),
    })),
  ),
)

type ChatRow = ChatMatch<IndexedChat>

const chatMatches = computed<ChatRow[]>(() => matchChats(indexed.value, terms.value, hits.value))

const chatRows = computed<ChatRow[]>(() =>
  terms.value.length
    ? chatMatches.value.slice(0, MAX_CHATS)
    : recentChats(indexed.value, RECENT_CHATS).map((item) => ({ ...item, hit: null, named: true })),
)
const hiddenChats = computed(() => (terms.value.length ? chatMatches.value.length - chatRows.value.length : 0))

interface ProjectRow {
  key: string
  device: string | null
  deviceName?: string
  project: Project
}

/**
 * Projects by name and folder, only while searching: a new chat in one is a step away. Another
 * device's only if it lets this one start chats there.
 */
const projectRows = computed<ProjectRow[]>(() =>
  terms.value.length
    ? sources.value
        .filter(startsChats)
        .flatMap(({ id, name }) =>
          useProjectsStore(id)
            .projects.filter((p) => containsTerms(searchText(p.name, p.path, name), terms.value))
            .map((project) => ({ key: chatKey(id, project.id), device: id, deviceName: name, project })),
        )
        .slice(0, MAX_PROJECTS)
    : [],
)

const nothingFound = computed(() => terms.value.length > 0 && !searching.value && chatRows.value.length === 0 && projectRows.value.length === 0)

// The list changes while typing and again when the conversations have been searched:
// Enter has to keep hitting a row that is still there.
watch([chatRows, projectRows], () => {
  void nextTick(() => {
    if (!listbox.highlightedElement.value?.isConnected) listbox.highlightFirstItem()
  })
})

function chatCount(row: ProjectRow): string {
  const count = useSessionsStore(row.device).byProject(row.project.id).length
  return count === 1 ? '1 Chat' : `${count} Chats`
}

const stateOf = (row: ChatRow) => actionsOf(row.device).state(row.meta.id)

/** On screen: the main area shows this chat of this device. */
const isOpen = (row: ChatRow) => ui.view === 'chat' && shown.device === row.device && useSessionsStore(row.device).activeId === row.meta.id

/** Who wrote the message a snippet is from. */
function speaker(hit: SessionSearchHit): string {
  return hit.role === 'user' ? 'Du' : PROVIDERS[hit.provider].short
}

/** On its device, as its row in the sidebar opens it. */
function openChat(row: ChatRow): void {
  emit('done')
  void actionsOf(row.device).open(row.meta.id)
}

function openProject(row: ProjectRow): void {
  emit('done')
  actionsOf(row.device).newChat(row.project.id)
}

/** The other modes of the quick open, offered before anything is typed. */
const MODES = [
  { prefix: '>', label: 'Befehle anzeigen und ausführen', shortcut: 'Strg+Umschalt+P', icon: ChevronRightIcon },
  { prefix: '?', label: 'Weitere Möglichkeiten', shortcut: '', icon: CircleHelpIcon },
]

const rowClass = 'group/row flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 outline-none select-none data-highlighted:bg-accent'
const groupLabelClass = 'px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground'
</script>

<template>
  <div class="flex items-center gap-2.5 border-b px-3.5">
    <SearchIcon class="size-4 shrink-0 text-muted-foreground" />
    <ListboxFilter
      v-model="query"
      auto-focus
      placeholder="Chats und Projekte suchen (> für Befehle, ? für Hilfe)"
      aria-label="Chats und Projekte suchen"
      spellcheck="false"
      class="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
    />
    <Spinner v-if="searching" class="size-3.5 shrink-0 text-muted-foreground" />
    <span v-else class="shrink-0 text-xs text-muted-foreground">Strg+Umschalt+A</span>
  </div>

  <ListboxContent class="max-h-[min(32rem,calc(80vh-6rem))] overflow-y-auto p-1.5 outline-none">
    <ListboxGroup v-if="!query.trim()" class="mb-1 border-b pb-1.5">
      <ListboxItem
        v-for="mode in MODES"
        :key="mode.prefix"
        :value="`mode:${mode.prefix}`"
        :class="cn(rowClass, 'py-1')"
        @select.prevent="query = mode.prefix"
      >
        <component :is="mode.icon" class="size-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate text-sm">
          {{ mode.label }}
          <span class="ml-1 font-mono text-muted-foreground">{{ mode.prefix }}</span>
        </span>
        <span v-if="mode.shortcut" class="shrink-0 text-xs text-muted-foreground">{{ mode.shortcut }}</span>
      </ListboxItem>
    </ListboxGroup>

    <ListboxGroup v-if="chatRows.length">
      <ListboxGroupLabel :class="groupLabelClass">
        {{ terms.length ? 'Chats' : 'Letzte Chats' }}
        <span v-if="terms.length" class="tabular-nums">· {{ chatMatches.length }}</span>
      </ListboxGroupLabel>
      <ListboxItem v-for="row in chatRows" :key="row.key" :value="`chat:${row.key}`" :class="rowClass" @select="openChat(row)">
        <span class="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Spinner v-if="stateOf(row) === 'running'" class="size-4 text-primary" />
          <ProviderIcon v-else :provider="row.meta.provider" class="size-4" />
          <span
            v-if="stateOf(row) && stateOf(row) !== 'running'"
            :class="
              cn(
                'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-popover',
                stateOf(row) === 'waiting' && 'bg-warning',
                stateOf(row) === 'unread' && 'bg-primary',
                stateOf(row) === 'error' && 'bg-destructive',
              )
            "
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 truncate text-sm font-medium">{{ row.meta.title }}</span>
            <PinIcon v-if="row.meta.pinned" class="size-3 shrink-0 text-muted-foreground" />
            <!-- Another device's chat, as „Angeheftet“ in the sidebar marks it. -->
            <span v-if="row.deviceName" class="flex max-w-[40%] shrink-0 items-center gap-1 text-[11px] text-muted-foreground" :title="`Auf ${row.deviceName}`">
              <MonitorIcon class="size-3 shrink-0" />
              <span class="truncate">{{ row.deviceName }}</span>
            </span>
            <span v-if="isOpen(row)" class="shrink-0 rounded-sm bg-primary/10 px-1.5 text-[11px] leading-4 font-medium text-primary">
              Offen
            </span>
            <span v-if="row.meta.archived" class="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <ArchiveIcon class="size-3" />
              Archiviert
            </span>
          </span>
          <span v-if="row.hit" class="line-clamp-2 text-xs text-muted-foreground">
            <span class="font-medium text-foreground/80">{{ speaker(row.hit) }}:</span>
            {{ row.hit.snippet }}
          </span>
          <span v-else class="truncate text-xs text-muted-foreground">{{ placeOf(row.device, row.meta) }}</span>
        </span>
        <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ formatRelative(row.meta.updatedAt, now) }}</span>
      </ListboxItem>
    </ListboxGroup>

    <p v-if="hiddenChats > 0" class="px-2 py-2 text-xs text-muted-foreground">
      {{ hiddenChats }} weitere Chats passen – ein weiteres Wort grenzt die Suche ein.
    </p>

    <ListboxGroup v-if="projectRows.length">
      <ListboxGroupLabel :class="groupLabelClass">Projekte</ListboxGroupLabel>
      <ListboxItem v-for="row in projectRows" :key="row.key" :value="`project:${row.key}`" :class="rowClass" @select="openProject(row)">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FolderIcon class="size-4" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 truncate text-sm font-medium">{{ row.project.name }}</span>
            <span v-if="row.deviceName" class="flex max-w-[40%] shrink-0 items-center gap-1 text-[11px] text-muted-foreground" :title="`Auf ${row.deviceName}`">
              <MonitorIcon class="size-3 shrink-0" />
              <span class="truncate">{{ row.deviceName }}</span>
            </span>
          </span>
          <span class="truncate text-xs text-muted-foreground">{{ row.project.path }}</span>
        </span>
        <span class="shrink-0 text-xs text-muted-foreground group-data-highlighted/row:hidden">{{ chatCount(row) }}</span>
        <span class="hidden shrink-0 text-xs text-muted-foreground group-data-highlighted/row:inline">Neuer Chat</span>
      </ListboxItem>
    </ListboxGroup>

    <p v-if="nothingFound" class="px-3 py-8 text-center text-sm text-muted-foreground">Kein Chat und kein Projekt passt zu „{{ query.trim() }}“.</p>
    <p v-else-if="!terms.length && chatRows.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">Noch keine Chats.</p>
  </ListboxContent>
</template>
