<script setup lang="ts">
import {
  ArrowDownIcon,
  BotIcon,
  ChevronRightIcon,
  CopyIcon,
  FileDownIcon,
  FolderOpenIcon,
  GitForkIcon,
  InfoIcon,
  MonitorIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PencilIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  RotateCwIcon,
  SearchIcon,
  SquareArrowDownLeftIcon,
  SquareArrowOutUpRightIcon,
  SquareTerminalIcon,
  TerminalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from '@lucide/vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { computed, nextTick, ref, watch } from 'vue'
import { PROVIDER_IDS, type AgentItem, type ChatItem, type TodoItem } from '@shared/chat'
import type { ChatChanges } from '@shared/checkpoints'
import type { SessionUpdateInput } from '@shared/types'
import { PROVIDERS } from '@shared/providers'
import BrowserFind from '@/components/browser/BrowserFind.vue'
import BrowserPanel from '@/components/browser/BrowserPanel.vue'
import BrowserToggle from '@/components/browser/BrowserToggle.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import ChangesView from '@/components/files/ChangesView.vue'
import DiffView from '@/components/files/DiffView.vue'
import FileTreePanel from '@/components/files/FileTreePanel.vue'
import TerminalPanel from '@/components/terminal/TerminalPanel.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import { useChatActions } from '@/composables/useChatActions'
import { useChatCommands } from '@/composables/useChatCommands'
import { useClock } from '@/composables/useClock'
import { useDomFind } from '@/composables/useDomFind'
import { provideProjectPath } from '@/composables/useProjectPath'
import { useStickToBottom } from '@/composables/useStickToBottom'
import type { AppCommand } from '@/lib/chat-commands'
import { isChatWindow } from '@/lib/chat-window'
import { attempt } from '@/lib/errors'
import { andList, formatDuration } from '@/lib/format'
import { runErrorToShow } from '@/lib/run-error'
import { dockShells } from '@/lib/shells'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useBrowsersStore } from '@/stores/browsers'
import { useDevice, useDeviceApi } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { MAX_TREE_SHARE, useFileTreeStore } from '@/stores/file-tree'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useStartCommandsStore } from '@/stores/start-commands'
import { useTerminalsStore } from '@/stores/terminals'
import { useUiStore } from '@/stores/ui'
import AgentDock from './AgentDock.vue'
import AgentThread from './AgentThread.vue'
import ChatSkeleton from './ChatSkeleton.vue'
import ChatStatusDialog from './ChatStatusDialog.vue'
import PromptChangesDialog from './PromptChangesDialog.vue'
import { provideChatChanges } from '@/composables/useChatChanges'
import Composer from './Composer.vue'
import LimitBanner from './LimitBanner.vue'
import MessageList from './MessageList.vue'
import ShellDock from './ShellDock.vue'
import StartCommandsMenu from './StartCommandsMenu.vue'
import TodoCard from './TodoCard.vue'
import UserMessage from './UserMessage.vue'

/**
 * The open chat: header, timeline (the main thread or, in its place, a subagent's work), the agents
 * and shells at work above the composer, the shells' output beside it.
 */
const sessions = useSessionsStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const fileTree = useFileTreeStore()
const browsers = useBrowsersStore()
const chatActions = useChatActions()
const now = useClock(1000)
/**
 * A chat of another device (Remote Control): the same window, its calls going there. What works on
 * this device's own files, terminals, browser and windows isn't offered for it.
 */
const device = useDevice()
const api = useDeviceApi()
const devices = useDevicesStore()
const deviceName = computed(() => (device ? (devices.devices.find((d) => d.id === device)?.name ?? 'anderes Gerät') : null))
/** What the other device lets this one do: prompts, and the dock's settings with everything. */
const canPrompt = computed(() => devices.can(device, 'prompt'))

const meta = computed(() => sessions.active)
const chat = computed(() => sessions.activeChat)
const runtime = computed(() => sessions.activeRuntime)
const items = computed(() => chat.value?.items ?? [])
const runError = computed(() => (runtime.value.status === 'error' ? runErrorToShow(items.value, runtime.value.error) : null))
const project = computed(() => projects.get(meta.value?.projectId))
/** Where the agent works: paths in it are shown relative to it. */
const cwd = computed(() => (project.value ? (sessions.cwdOf(meta.value) ?? project.value.path) : null))
provideProjectPath(cwd)

// The first chat of a project on screen starts its start commands with „Automatisch starten“ (main
// counts: once per run of Nexa).
const startCommands = useStartCommandsStore()
watch(
  () => project.value?.id,
  (id) => {
    if (id && !device) startCommands.chatOpened(id)
  },
  { immediate: true },
)
const busy = computed(() => runtime.value.status === 'running' || runtime.value.status === 'waiting' || runtime.value.status === 'starting')

// ── The user's terminal on the right ──

const terminals = useTerminalsStore()
const terminalOpen = computed(() => terminals.isOpen(meta.value?.id))
// Hidden while it had the keyboard: back to the composer, not to nowhere.
watch(terminalOpen, (open, before) => {
  if (before && !open && document.activeElement?.closest('[aria-label="Terminal"]')) void nextTick(() => composer.value?.focus())
})

// ── The file panel on the left, and a file's changes over the timeline ──

const area = ref<HTMLElement | null>(null)
const { width: areaWidth } = useElementSize(area)
/** Another device's chat has its files there (Remote Control): shown while that device lets this one read them. */
const canRead = computed(() => devices.can(device, 'read'))
const treeTarget = computed(() => (canRead.value ? fileTree.targetOf(meta.value?.id) : null))
const treeShown = computed(() => fileTree.open && !!treeTarget.value)
/** The tree takes at most a share of the chat's area, so the chat keeps room. */
const treeMax = computed(() => Math.max(180, Math.round(areaWidth.value * MAX_TREE_SHARE)))
const treeWidth = computed(() => Math.min(fileTree.width, treeMax.value))
const diff = computed(() => {
  const file = fileTree.diffOf(meta.value?.id)
  // A diff of another folder (the chat moved to another project) isn't this chat's any more.
  return file && file.root === treeTarget.value?.root ? file : null
})

// What the agent did to files before comes from the chat's history, once the tree is on screen.
watch(
  () => (treeShown.value ? treeTarget.value?.id : null),
  (id) => {
    if (id) void fileTree.loadHistory(id)
  },
  { immediate: true },
)

// Ctrl+Shift+E shows or hides the files, as the Explorer of VS Code does.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'e') {
    event.preventDefault()
    fileTree.toggle()
  }
})

const viewport = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const dock = ref<HTMLElement | null>(null)
const { height: dockHeight } = useElementSize(dock, undefined, { box: 'border-box' })
/** The chat fades out under the lower half of the composer, towards the window's edge (`.chat-fade`). */
const fadeStyle = computed(() => ({ '--fade-from': '6px', '--fade-to': `${Math.round(dockHeight.value * 0.55)}px` }))
const { atBottom, scrollToBottom } = useStickToBottom(viewport, content)

/**
 * Above the composer while a subagent runs: those of the last prompt (the finished ones stay until
 * the last is through, so the progress shows) and background ones still at work from before.
 * Agents of agents show in their parent's thread.
 */
const dockAgents = computed(() => {
  const lastPrompt = items.value.findLastIndex((i) => i.kind === 'user' && !i.parentId)
  const list = items.value.filter((i, index): i is AgentItem => i.kind === 'agent' && !i.parentId && (index > lastPrompt || i.status === 'running'))
  return list.some((a) => a.status === 'running') ? list : []
})
const dockShellList = computed(() => dockShells(items.value))
const todo = computed(() => [...items.value].reverse().find((i): i is TodoItem => i.kind === 'todo' && !i.parentId))
const showTodo = computed(() => busy.value && todo.value && todo.value.entries.some((e) => e.status !== 'completed'))
/** Nothing said yet: the empty timeline greets instead. */
const fresh = computed(() => !!chat.value?.loaded && items.value.length === 0 && !busy.value)
const enterSends = computed(() => settings.settings.chat.enterSends)

// ── The thread shown: the main chat, or a subagent's work in its place ──

const viewed = computed(() => (ui.agentId ? items.value.find((i): i is AgentItem => i.kind === 'agent' && i.id === ui.agentId) : undefined))
/** The agents from the main chat down to the one shown (an agent of an agent has its parent before it). */
const viewedPath = computed(() => {
  const path: AgentItem[] = []
  for (let a = viewed.value; a; a = a.parentId ? items.value.find((i): i is AgentItem => i.kind === 'agent' && i.id === a!.parentId) : undefined) {
    path.unshift(a)
    if (path.length > 8) break
  }
  return path
})

// The one shown is through: back to the thread it came from, where its answer lands. One opened
// when it was through already (from its card) stays.
watch(
  () => [ui.agentId, viewed.value?.status ?? null] as const,
  ([id, status], before) => {
    if (!before || id !== before[0] || before[1] !== 'running' || status === 'running') return
    ui.agentId = viewed.value?.parentId ?? null
  },
)

// Into a thread at its end; back in the main chat where the user left it.
let mainScroll: number | null = null
watch(
  () => ui.agentId,
  async (id, before) => {
    const el = viewport.value
    if (id && !before && el) mainScroll = atBottom.value ? null : el.scrollTop
    await nextTick()
    if (!id && mainScroll !== null && el) {
      el.scrollTop = mainScroll
      atBottom.value = false
    } else {
      scrollToBottom()
    }
    if (!id) mainScroll = null
  },
)

/** Escape is someone else's: a field's, an open menu's or dialog's, the browser's in full screen. */
function escapeTaken(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || browsers.fullscreen) return true
  const target = event.target as HTMLElement | null
  if (target?.isContentEditable || target?.closest('input, textarea, select')) return true
  return !!document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]')
}

// Escape closes a file's changes, back to the chat. Before the one below, so it doesn't also leave an agent's work.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !diff.value || !meta.value || escapeTaken(event)) return
  event.preventDefault()
  fileTree.closeDiff(meta.value.id)
})

// Escape folds a shell unfolded in the dock, before it would leave an agent's work below.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !ui.shellId || diff.value) return
  if (document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]')) return
  event.preventDefault()
  ui.shellId = null
})

// Escape goes back, as in the CLI; not while a menu or dialog takes it.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !viewed.value) return
  if (document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]')) return
  // Taken: the same press doesn't also stop the agent (below).
  event.preventDefault()
  ui.agentId = viewed.value.parentId ?? null
})

// Escape stops the agent, as in the CLIs: in the composer or anywhere in the chat, once nothing above
// took it (the composer keeps its own for its list, the shell mode and dictation).
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.repeat || !busy.value || !meta.value || diff.value) return
  const target = event.target as HTMLElement | null
  const inComposer = !!target?.closest('[data-composer]')
  if (inComposer ? event.defaultPrevented || browsers.fullscreen || !!document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]') : escapeTaken(event)) return
  event.preventDefault()
  void attempt(() => sessions.interrupt(meta.value!.id), 'Anhalten fehlgeschlagen')
})

/**
 * Text streams where the timeline shows it. A block begins empty (and a thought is left out with the
 * thoughts off), and its first words can take a second or two: until then the agent is still at work.
 */
function streamsVisibly(item: ChatItem | undefined): boolean {
  if (!item || (item.kind !== 'assistant' && item.kind !== 'thinking') || !item.streaming) return false
  if (item.kind === 'thinking' && !settings.settings.chat.showThinking) return false
  return item.text.trim().length > 0
}

/** What the agent is doing, under the timeline while a turn runs and no text streams. */
const working = computed(() => {
  const agent = viewed.value
  if (agent) {
    if (agent.status !== 'running') return null
    const last = items.value.findLast((i) => i.parentId === agent.id)
    if (streamsVisibly(last)) return null
    return last ? 'Arbeitet …' : 'Startet …'
  }
  if (!busy.value) return null
  // Compacting takes a while and nothing streams meanwhile; the CLI says what it waits for, Nexa too.
  if (runtime.value.compactingSince) return 'Kontext wird zusammengefasst …'
  const last = items.value[items.value.length - 1]
  if (streamsVisibly(last)) return null
  if (runtime.value.status === 'waiting') return 'Wartet auf deine Antwort'
  if (runtime.value.status === 'starting') return `${PROVIDERS[meta.value?.provider ?? 'claude'].name} startet …`
  return 'Arbeitet …'
})
const elapsed = computed(() => {
  const since = viewed.value ? viewed.value.startedAt : (runtime.value.compactingSince ?? runtime.value.turnStartedAt)
  return since ? formatDuration(Math.max(0, now.value - since)) : ''
})

watch(
  () => sessions.activeId,
  async () => {
    mainScroll = null
    ui.agentId = null
    ui.shellId = null
    await nextTick()
    scrollToBottom()
  },
)

// ── The CLIs' conversations, gone on outside Nexa (a terminal, Claude Desktop, VS Code) ──

/** The CLIs the chat has a conversation with, by name: „Claude Code und Codex“. */
const syncNames = computed(() => andList(PROVIDER_IDS.filter((p) => meta.value?.cli[p]).map((p) => PROVIDERS[p].name)))
const syncable = computed(() => !!syncNames.value)
let lastSync = 0
/** Takes in what came outside Nexa; quietly, as the chat comes back on screen. */
function syncQuietly(): void {
  const id = meta.value?.id
  if (!id || !syncable.value || busy.value || Date.now() - lastSync < 2000) return
  lastSync = Date.now()
  void sessions.sync(id).catch((error) => console.warn('[chat] sync failed', error))
}
// Back from the terminal: what was said there shows.
useEventListener(window, 'focus', syncQuietly)
// Open elsewhere too: its finished turns come in while the chat is on screen, and the note goes once
// it's closed there.
watch(
  () => (runtime.value.openElsewhere ? meta.value?.id : undefined),
  (id, _before, onCleanup) => {
    if (!id) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') syncQuietly()
    }, 5000)
    onCleanup(() => window.clearInterval(timer))
  },
  // The chat may have come with the note already, opened before this view was on screen.
  { immediate: true },
)

async function syncNow(): Promise<void> {
  const id = meta.value?.id
  if (!id) return
  lastSync = Date.now()
  const taken = await attempt(() => sessions.sync(id), 'Abgleich fehlgeschlagen')
  if (taken === 0) toast(`Nichts Neues aus ${syncNames.value}`, { description: 'Der Chat ist auf dem Stand der CLI.' })
  else if (taken) scrollToBottom(true)
}

async function send(input: { text: string; images: string[] }): Promise<void> {
  const id = meta.value?.id
  if (!id) return
  // The answer comes in the main chat.
  mainScroll = null
  ui.agentId = null
  scrollToBottom()
  await attempt(() => sessions.send(id, input), 'Senden fehlgeschlagen')
}

/** A command from the shell mode (`!`): it shows in the main chat with its output. */
async function runShell(command: string): Promise<void> {
  const id = meta.value?.id
  if (!id) return
  mainScroll = null
  ui.agentId = null
  scrollToBottom()
  await attempt(() => api.sessions.runShell(id, command), 'Befehl ließ sich nicht ausführen')
}

function update(patch: SessionUpdateInput): void {
  const id = meta.value?.id
  if (id) void attempt(() => sessions.update(id, patch), 'Ändern fehlgeschlagen')
}

// ── Nexa's own commands (`/clear`, `/diff` …), run here instead of by the CLI ──

const composer = ref<InstanceType<typeof Composer> | null>(null)
const statusOpen = ref(false)

// ── What each prompt changed in the files (Nexa's checkpoints), and rewinding to before one ──

const changes = ref<ChatChanges | null>(null)
const changesOpen = ref(false)
const changesFocus = ref<string | null>(null)
const changesRewind = ref<string | null>(null)
const checkpointed = computed(() => new Set(changes.value?.prompts.filter((p) => !p.unavailable).map((p) => p.promptId)))

/** `live` only while the dialog shows: the running turn's files need a snapshot of the folders now. */
async function loadChanges(): Promise<void> {
  const id = meta.value?.id
  if (!id) return
  const next = await api.sessions.changes(id, changesOpen.value).catch(() => null)
  if (meta.value?.id === id) changes.value = next
}

// A turn's end counts what its prompt changed (`fileChanges`), a prompt begins a checkpoint, a rewind leaves a note.
const changeStamp = computed(() => {
  const list = items.value
  const last = list.findLast((i) => i.kind === 'user' || (i.kind === 'turn' && !!i.fileChanges) || (i.kind === 'notice' && !!i.rewind))
  return `${meta.value?.id ?? ''}|${last?.id ?? ''}|${last?.kind === 'turn' ? (last.fileChanges?.files ?? 0) : ''}`
})
watch(changeStamp, () => void loadChanges(), { immediate: true })
watch(
  () => meta.value?.id,
  () => {
    changes.value = null
    changesOpen.value = false
  },
)

/** The prompt a turn answered: the last one before it with a checkpoint (prompts joining the turn have none). */
function promptOfTurn(turnId: string): string | null {
  const list = items.value
  const at = list.findIndex((i) => i.id === turnId)
  for (let i = at - 1; i >= 0; i--) {
    const item = list[i]!
    if (item.kind === 'user' && checkpointed.value.has(item.id)) return item.id
    if (item.kind === 'turn') break
  }
  return null
}

function openChanges(at?: { promptId?: string; turnId?: string }): void {
  changesFocus.value = at?.promptId ?? (at?.turnId ? promptOfTurn(at.turnId) : null)
  changesRewind.value = null
  changesOpen.value = true
  void loadChanges()
}

provideChatChanges({
  has: (promptId) => checkpointed.value.has(promptId),
  show: openChanges,
  rewind: (promptId) => {
    changesFocus.value = promptId
    changesRewind.value = promptId
    changesOpen.value = true
  },
})

const commands = useChatCommands({ meta, items, cwd, composer, startRename: () => void startRename(), showStatus: () => (statusOpen.value = true), showChanges: () => openChanges() })

function runCommand(input: { command: AppCommand; args: string }): void {
  void commands.run(input.command, input.args)
}

const renaming = ref(false)
const title = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
async function startRename(): Promise<void> {
  title.value = meta.value?.title ?? ''
  renaming.value = true
  await nextTick()
  titleInput.value?.select()
}
function finishRename(save: boolean): void {
  renaming.value = false
  if (save && meta.value && title.value.trim() && title.value.trim() !== meta.value.title) {
    void attempt(() => sessions.update(meta.value!.id, { title: title.value.trim() }))
  }
}

function openFolder(): void {
  if (cwd.value) void window.api.app.openPath(cwd.value)
}

function remove(): void {
  if (meta.value) void chatActions.remove(meta.value)
}

// ── A window of its own: out of the main window, or back into it ──

const popOutLabel = isChatWindow ? 'Zurück ins Hauptfenster' : 'In eigenem Fenster öffnen'
const popOutHint = isChatWindow ? 'Zurück ins Hauptfenster: der Chat erscheint dort wieder' : 'In eigenem Fenster öffnen: nur dieser Chat, neben anderen Fenstern'
function popOut(): void {
  if (meta.value) void chatActions.popOut(meta.value)
}

const restarting = ref(false)
async function restart(): Promise<void> {
  if (!meta.value || restarting.value) return
  restarting.value = true
  try {
    await chatActions.restart(meta.value)
  } finally {
    restarting.value = false
  }
}

// ── Find in the chat (Ctrl+F, F3), as in a browser ──

const list = ref<InstanceType<typeof MessageList> | null>(null)
const findBar = ref<InstanceType<typeof BrowserFind> | null>(null)
const findOpen = ref(false)
const find = useDomFind(() => (findOpen.value ? content.value : null), '[data-find-blocks] > *')
/** Older messages of the main thread aren't rendered (MessageList's pages): the search can't see them. */
const unshown = computed(() => (findOpen.value && !viewed.value ? (list.value?.hidden ?? 0) : 0))

function openFind(): void {
  findOpen.value = true
  void nextTick(() => findBar.value?.focus())
}

function closeFind(): void {
  findOpen.value = false
  find.clear()
  composer.value?.focus()
}

async function showAllForFind(): Promise<void> {
  await list.value?.showAll()
  // Searched again over all of them, from what is in view.
  if (find.query.value) find.search(find.query.value)
}

// Another chat: its own search.
watch(
  () => meta.value?.id,
  () => {
    if (!findOpen.value) return
    findOpen.value = false
    find.clear()
  },
)
watch(
  () => ui.findRequest,
  () => openFind(),
)

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  // Taken by what has the keyboard (the browser's page search, a dialog's own), or the chat is covered.
  if (event.defaultPrevented || diff.value || (event.target instanceof Element && event.target.closest('[role=dialog]'))) return
  const ctrl = event.ctrlKey || event.metaKey
  if (ctrl && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    openFind()
  } else if (event.key === 'F3' && !ctrl && !event.altKey) {
    event.preventDefault()
    if (findOpen.value && findBar.value?.query) findBar.value.step(!event.shiftKey)
    else openFind()
  }
})
</script>

<template>
  <div v-if="meta" ref="area" class="relative flex min-h-0 min-w-0 flex-1">
    <FileTreePanel
      v-if="treeShown && treeTarget"
      :target="treeTarget"
      side="left"
      :max-width="treeMax"
      :current="diff?.path || null"
      class="relative shrink-0"
      :style="{ width: `${treeWidth}px` }"
    />
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- Header -->
      <div class="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <Button
          v-if="canRead"
          variant="ghost"
          size="icon-sm"
          :class="cn('-ml-2', treeShown && 'bg-muted')"
          :aria-label="treeShown ? 'Dateien ausblenden' : 'Dateien zeigen'"
          :aria-pressed="treeShown"
          :disabled="!treeTarget"
          v-tooltip="`${treeShown ? 'Dateien ausblenden' : 'Dateien und Aktivität zeigen'} (Strg+Umschalt+E)`"
          @click="fileTree.toggle()"
        >
          <PanelLeftIcon />
        </Button>
        <ProviderIcon :provider="meta.provider" class="size-4 shrink-0" />
        <input
          v-if="renaming"
          ref="titleInput"
          v-model="title"
          class="field-sizing-content max-w-full min-w-40 rounded-md border bg-background/60 px-2 py-0.5 text-sm font-medium outline-none"
          @keydown.enter="finishRename(true)"
          @keydown.esc="finishRename(false)"
          @blur="finishRename(true)"
        />
        <!-- In a subagent's work: the way back to the main chat, through its parents. -->
        <nav v-else-if="viewedPath.length" class="flex min-w-0 items-center gap-1.5 text-sm" aria-label="Verlauf">
          <button
            type="button"
            class="min-w-0 shrink truncate text-muted-foreground transition-colors hover:text-foreground"
            :title="meta.title"
            v-tooltip="'Zurück zum Hauptchat'"
            @click="ui.agentId = null"
          >
            {{ meta.title }}
          </button>
          <template v-for="(a, index) in viewedPath" :key="a.id">
            <ChevronRightIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <button
              v-if="index < viewedPath.length - 1"
              type="button"
              class="min-w-0 shrink truncate text-muted-foreground transition-colors hover:text-foreground"
              @click="ui.agentId = a.id"
            >
              {{ a.description || a.agentType }}
            </button>
            <span v-else class="flex min-w-0 shrink-[0.5] items-center gap-1.5 font-medium" aria-current="page">
              <BotIcon class="size-4 shrink-0 text-primary" />
              <span class="truncate">{{ a.description || a.agentType }}</span>
            </span>
          </template>
        </nav>
        <button v-else type="button" class="min-w-0 truncate text-sm font-medium" :title="meta.title" @dblclick="startRename">{{ meta.title }}</button>
        <span v-if="deviceName" class="flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[0.72rem] text-muted-foreground" v-tooltip="'Der Chat läuft auf diesem Gerät'">
          <MonitorIcon class="size-3" />
          {{ deviceName }}
        </span>
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <StartCommandsMenu v-if="project && !device" :project-id="project.id" />
          <Button
            v-if="!device"
            variant="ghost"
            size="icon-sm"
            :class="cn('relative', terminalOpen && 'bg-muted')"
            :aria-label="terminalOpen ? 'Terminal ausblenden' : 'Terminal öffnen'"
            :aria-pressed="terminalOpen"
            :disabled="!project"
            v-tooltip.bottom="`${terminalOpen ? 'Terminal ausblenden' : 'Terminal im Ordner des Chats'} (Strg+Ö)`"
            @click="terminals.toggle(meta.id)"
          >
            <TerminalIcon />
            <!-- Hidden, its shells still run. -->
            <span
              v-if="!terminalOpen && terminals.runningIn(meta.id).length"
              aria-hidden="true"
              class="absolute top-1 right-1 size-1.5 rounded-full bg-(--tool-run) ring-2 ring-background"
            />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Chat neu starten"
            :disabled="restarting"
            v-tooltip="'Chat neu starten: übernimmt geänderte Einstellungen'"
            @click="restart"
          >
            <RotateCwIcon :class="cn(restarting && 'animate-spin')" />
          </Button>
          <Button v-if="!device" variant="ghost" size="icon-sm" :aria-label="popOutLabel" v-tooltip.bottom="popOutHint" @click="popOut">
            <SquareArrowDownLeftIcon v-if="isChatWindow" />
            <SquareArrowOutUpRightIcon v-else />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" aria-label="Mehr">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Chat</DropdownMenuLabel>
                <DropdownMenuItem @select="startRename"><PencilIcon /> Umbenennen</DropdownMenuItem>
                <DropdownMenuItem :disabled="busy" @select="chatActions.fork(meta.id)"><GitForkIcon /> Chat abzweigen</DropdownMenuItem>
                <DropdownMenuItem v-if="!device" @select="popOut">
                  <SquareArrowDownLeftIcon v-if="isChatWindow" />
                  <SquareArrowOutUpRightIcon v-else />
                  {{ popOutLabel }}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Verlauf</DropdownMenuLabel>
                <DropdownMenuItem :disabled="!!diff" @select="openFind"><SearchIcon /> Im Chat suchen <DropdownMenuShortcut>Strg+F</DropdownMenuShortcut></DropdownMenuItem>
                <DropdownMenuItem @select="chatActions.copyLastAnswer(meta.id)"><CopyIcon /> Letzte Antwort kopieren</DropdownMenuItem>
                <DropdownMenuItem v-if="!device" @select="chatActions.exportMarkdown(meta.id)"><FileDownIcon /> Als Markdown speichern …</DropdownMenuItem>
                <DropdownMenuItem @select="openChanges()"><RotateCcwIcon /> Änderungen je Prompt …</DropdownMenuItem>
              </DropdownMenuGroup>
              <template v-if="project && !device">
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Projekt</DropdownMenuLabel>
                  <DropdownMenuItem @select="openFolder"><FolderOpenIcon /> Projektordner öffnen</DropdownMenuItem>
                  <DropdownMenuItem @select="ui.startCommandsProject = project.id"><SquareTerminalIcon /> Startbefehle …</DropdownMenuItem>
                </DropdownMenuGroup>
              </template>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sitzung</DropdownMenuLabel>
                <DropdownMenuItem @select="statusOpen = true"><InfoIcon /> Status</DropdownMenuItem>
                <DropdownMenuItem v-if="syncable" :disabled="busy" @select="syncNow"><RefreshCwIcon /> Mit {{ syncNames }} abgleichen</DropdownMenuItem>
                <DropdownMenuItem :disabled="restarting" @select="restart"><RotateCwIcon /> Chat neu starten</DropdownMenuItem>
                <DropdownMenuItem @select="chatActions.end(meta)"><PowerIcon /> Chat beenden</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive" @select="remove"><Trash2Icon /> Löschen</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <BrowserToggle v-if="!device" :session-id="meta.id" class="-mr-2" />
        </div>
      </div>

      <!-- Timeline, with the composer floating over its end. A container: `--chat-width` grows with its width (cqw). -->
      <div class="@container relative min-h-0 flex-1">
        <!-- Hidden, not removed, under a file's changes: it keeps its place in the chat. -->
        <!-- The scroll bar's gutter always, so the chat and what floats over it share one centre. -->
        <div ref="viewport" :class="cn('chat-fade h-full overflow-y-auto [scrollbar-gutter:stable]', diff && 'invisible')" :style="fadeStyle">
          <div ref="content" class="mx-auto w-full max-w-(--chat-width) px-6 pt-6" :style="{ paddingBottom: `${dockHeight + 16}px` }">
            <ChatSkeleton v-if="chat && !chat.loaded" />
            <template v-else>
              <AgentThread v-if="viewed" :key="viewed.id" :agent="viewed" :items="items" :session-id="meta.id" />
              <!-- Kept while a subagent's thread shows: back, the same older messages are there to return to. -->
              <MessageList v-show="!viewed" ref="list" :items="items" :session-id="meta.id" />
            </template>
            <div v-if="working" class="flex items-center gap-2 py-2 text-[0.85rem] text-muted-foreground">
              <Spinner class="size-3.5 text-primary" />
              <span class="text-shimmer text-shimmer-accent">{{ working }}</span>
              <span v-if="elapsed" class="tabular-nums opacity-70">{{ elapsed }}</span>
            </div>
            <!-- Under what the agent does, as in the CLIs: into the chat once it takes them up. -->
            <template v-if="!viewed">
              <UserMessage
                v-for="(prompt, i) in runtime.queued"
                :key="prompt.id"
                :item="prompt"
                :session-id="meta.id"
                :send-now="i === 0"
                queued
              />
            </template>
            <div v-if="runError && !viewed" class="selectable my-2 rounded-lg bg-destructive/10 px-3 py-2 text-[0.82rem] text-destructive">
              {{ runError }}
            </div>
          </div>
        </div>
        <!-- The search in the chat, in its corner as in a browser (clear of the scroll bar). -->
        <div
          v-if="findOpen && !diff"
          class="absolute top-2 right-[calc(10px+0.75rem)] z-40 flex max-w-[calc(100%-2rem)] animate-in flex-col items-end gap-1.5 duration-150 fade-in slide-in-from-top-1"
        >
          <BrowserFind ref="findBar" label="Im Chat suchen" :matches="find.matches.value" @search="find.search" @close="closeFind" />
          <div v-if="unshown" class="flex items-center gap-2 rounded-lg bg-popover py-1 pr-1 pl-3 text-xs text-muted-foreground shadow-md ring-1 ring-foreground/10">
            <span>Ältere Nachrichten sind nicht geladen</span>
            <Button variant="outline" size="xs" @click="showAllForFind">Alle laden</Button>
          </div>
        </div>
        <!-- A chat without a prompt yet: one started with „+“ beside a project, not from the start page. -->
        <div
          v-if="fresh && !diff"
          class="pointer-events-none absolute top-0 right-[10px] left-0 flex items-center justify-center px-6"
          :style="{ bottom: `${dockHeight}px` }"
        >
          <div class="flex max-w-md flex-col items-center gap-3 text-center">
            <ProviderIcon :provider="meta.provider" class="size-10" />
            <h2 class="text-xl font-semibold tracking-tight">Woran arbeiten wir?</h2>
            <p class="text-sm text-balance text-muted-foreground">
              Neuer Chat mit {{ PROVIDERS[meta.provider].name }}
              <template v-if="project">in <span class="font-medium text-foreground">{{ project.name }}</span></template>
            </p>
            <ul class="mt-4 flex flex-col gap-2 text-[0.8rem] text-muted-foreground">
              <li>
                <template v-if="enterSends"><Kbd>Enter</Kbd> sendet, <Kbd>Umschalt</Kbd> + <Kbd>Enter</Kbd> beginnt eine neue Zeile</template>
                <template v-else><Kbd>Strg</Kbd> + <Kbd>Enter</Kbd> sendet</template>
              </li>
              <li>Bilder einfügen oder ins Feld ziehen hängt sie an</li>
              <li v-if="deviceName">Der Chat läuft auf {{ deviceName }}</li>
              <li v-if="treeTarget && !device">Dateien aus dem Baum ins Feld ziehen erwähnt sie · <Kbd>Strg</Kbd> + <Kbd>Umschalt</Kbd> + <Kbd>E</Kbd></li>
              <li v-else-if="treeTarget">Die Dateien des Chats zeigt <Kbd>Strg</Kbd> + <Kbd>Umschalt</Kbd> + <Kbd>E</Kbd></li>
            </ul>
          </div>
        </div>
        <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity" leave-active-class="transition-opacity">
          <Button
            v-if="!atBottom && !diff"
            variant="outline"
            size="icon-sm"
            class="absolute left-[calc(50%-5px)] -translate-x-1/2 rounded-full bg-popover/80 shadow-md backdrop-blur-md"
            :style="{ bottom: `${dockHeight + 10}px` }"
            aria-label="Nach unten"
            @click="scrollToBottom(true)"
          >
            <ArrowDownIcon />
          </Button>
        </Transition>
        <!-- A file's changes from the tree, or all of them, over the whole timeline, composer and all. -->
        <div v-if="diff" class="absolute inset-0 z-10 flex flex-col">
          <ChangesView v-if="diff.path === ''" :key="diff.root" :root="diff.root" closable class="min-h-0 flex-1" @close="fileTree.closeDiff(meta.id)" />
          <DiffView v-else :key="`${diff.root}|${diff.path}`" :root="diff.root" :path="diff.path" closable class="min-h-0 flex-1" @close="fileTree.closeDiff(meta.id)" />
        </div>

        <!--
          Composer: floats over the end of the timeline, frosted, so the chat scrolls on beneath it
          instead of being cut off above it. Clicks around it reach the chat. No z-index, here or on
          what sits beside it (the button „Nach unten“): a z-index makes the dock a stacking context
          of its own, and the .frost-backing under each card then covers the timeline's text instead
          of getting below it, so nothing shows through the frost. Last in the DOM, it still lies
          over the button and the hint of a fresh chat. Leaves out the scroll bar (10px, main.css)
          on the right, as the chat does. Hidden, not removed, under a file's changes: its draft
          stays, and so does its height the timeline makes room for.
        -->
        <div
          ref="dock"
          :class="cn('pointer-events-none absolute right-[10px] bottom-0 left-0 mx-auto max-w-(--chat-width) px-6 pb-5', diff && 'invisible')"
        >
          <div v-if="showTodo && todo" class="frost-backing pointer-events-auto mb-2 rounded-xl">
            <TodoCard :item="todo" compact />
          </div>
          <!--
            Agents and shells at work side by side, resting on the composer. The agents take what the
            shells leave over their 16rem (grow 1000 to 1); without room for both the shells go below
            them, alone in their line and as wide as it.
          -->
          <div class="flex flex-wrap items-end gap-x-2">
            <Transition
              enter-from-class="translate-y-1 opacity-0"
              leave-to-class="translate-y-1 opacity-0"
              enter-active-class="transition duration-200"
              leave-active-class="transition duration-150"
            >
              <div v-if="dockAgents.length" class="frost-backing pointer-events-auto mb-2 min-w-0 flex-[1000_1_20rem] rounded-xl">
                <AgentDock :agents="dockAgents" />
              </div>
            </Transition>
            <Transition
              enter-from-class="translate-y-1 opacity-0"
              leave-to-class="translate-y-1 opacity-0"
              enter-active-class="transition duration-200"
              leave-active-class="transition duration-150"
            >
              <!-- A shell unfolded in the dock takes the composer's width, the agents above it. -->
              <div
                v-if="dockShellList.length || ui.shellId"
                :class="cn('frost-backing pointer-events-auto mb-2 min-w-0 rounded-xl', ui.shellId ? 'basis-full' : 'flex-[1_1_16rem]')"
              >
                <ShellDock :shells="dockShellList" :items="items" :session-id="meta.id" :project-id="project?.id" />
              </div>
            </Transition>
          </div>
          <div v-if="runtime.openElsewhere" class="frost-backing pointer-events-auto mb-2 rounded-xl" role="status">
            <div class="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[0.8rem] leading-snug">
              <TriangleAlertIcon class="mt-px size-3.5 shrink-0 text-warning" />
              <p>
                <span class="font-medium">Auch in {{ runtime.openElsewhere.where }} offen.</span>
                <span v-if="runtime.openElsewhere.provider === 'codex'" class="text-muted-foreground">
                  Solange der Chat dort offen ist, nimmt Codex hier keine Prompts an. Fertige Antworten von dort erscheinen hier.
                </span>
                <span v-else class="text-muted-foreground">
                  Schreib nur an einer Stelle weiter, sonst laufen die Unterhaltungen auseinander. Fertige Antworten von dort erscheinen hier.
                </span>
              </p>
            </div>
          </div>
          <LimitBanner
            :session-id="meta.id"
            :provider="meta.provider"
            :account-id="accounts.sessionAccount(meta)"
            :runtime="runtime"
            :items="items"
            :busy="busy"
          />
          <div class="frost-backing pointer-events-auto rounded-2xl">
            <Composer
              ref="composer"
              floating
              :draft-key="meta.id"
              :provider="meta.provider"
              :account="accounts.sessionAccount(meta)"
              :model="meta.model"
              :effort="meta.effort"
              :mode="meta.permissionMode"
              :ultracode="meta.ultracode"
              :busy="busy"
              :context="runtime.context"
              :compacting="!!runtime.compactingSince"
              :session-id="meta.id"
              :dirs="meta.dirs"
              :suggestion="settings.settings.chat.promptSuggestions ? runtime.suggestion : undefined"
              :disabled="!canPrompt"
              autofocus
              @send="send"
              @command="runCommand"
              @shell="runShell"
              @inserted="fileTree.closeDiff(meta.id)"
              @stop="sessions.interrupt(meta.id)"
              @update:provider="(provider) => update({ provider })"
              @update:account="(account) => update({ account })"
              @update:model="(model) => update({ model })"
              @update:effort="(effort) => update({ effort })"
              @update:mode="(permissionMode) => update({ permissionMode })"
              @update:ultracode="(ultracode) => update({ ultracode })"
              @update:dirs="(dirs) => update({ dirs })"
            />
          </div>
        </div>
      </div>
    </div>
    <template v-if="!device">
      <TerminalPanel :session-id="meta.id" />
      <BrowserPanel :session-id="meta.id" />
    </template>
    <ChatStatusDialog v-model:open="statusOpen" :meta="meta" :runtime="runtime" :cwd="cwd" />
    <PromptChangesDialog
      v-model:open="changesOpen"
      :session-id="meta.id"
      :items="items"
      :state="changes"
      :focus="changesFocus"
      :rewind-to="changesRewind"
      :busy="busy"
      @changed="loadChanges"
    />
  </div>
</template>
