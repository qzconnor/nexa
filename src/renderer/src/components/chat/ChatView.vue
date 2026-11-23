<script setup lang="ts">
import { ArrowDownIcon, BotIcon, ChevronRightIcon, FolderOpenIcon, MoreHorizontalIcon, PanelLeftIcon, PencilIcon, PowerIcon, Trash2Icon } from '@lucide/vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'
import type { AgentItem, TodoItem } from '@shared/chat'
import type { SessionUpdateInput } from '@shared/types'
import { PROVIDERS } from '@shared/providers'
import BrowserPanel from '@/components/browser/BrowserPanel.vue'
import BrowserToggle from '@/components/browser/BrowserToggle.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import ChangesView from '@/components/files/ChangesView.vue'
import DiffView from '@/components/files/DiffView.vue'
import FileTreePanel from '@/components/files/FileTreePanel.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { provideProjectPath } from '@/composables/useProjectPath'
import { useStickToBottom } from '@/composables/useStickToBottom'
import { attempt } from '@/lib/errors'
import { formatDuration } from '@/lib/format'
import { runErrorToShow } from '@/lib/run-error'
import { dockShells } from '@/lib/shells'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { MAX_TREE_SHARE, useFileTreeStore } from '@/stores/file-tree'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import AgentDock from './AgentDock.vue'
import AgentThread from './AgentThread.vue'
import Composer from './Composer.vue'
import MessageList from './MessageList.vue'
import ShellDock from './ShellDock.vue'
import ShellPanel from './ShellPanel.vue'
import TodoCard from './TodoCard.vue'

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
const now = useClock(1000)

const meta = computed(() => sessions.active)
const chat = computed(() => sessions.activeChat)
const runtime = computed(() => sessions.activeRuntime)
const items = computed(() => chat.value?.items ?? [])
const runError = computed(() => (runtime.value.status === 'error' ? runErrorToShow(items.value, runtime.value.error) : null))
const project = computed(() => projects.get(meta.value?.projectId))
/** Where the agent works: paths in it are shown relative to it. */
const cwd = computed(() => (project.value ? (sessions.cwdOf(meta.value) ?? project.value.path) : null))
provideProjectPath(cwd)
const busy = computed(() => runtime.value.status === 'running' || runtime.value.status === 'waiting' || runtime.value.status === 'starting')

// ── The file panel on the left, and a file's changes over the timeline ──

const area = ref<HTMLElement | null>(null)
const { width: areaWidth } = useElementSize(area)
const treeTarget = computed(() => fileTree.targetOf(meta.value?.id))
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

// Escape goes back, as in the CLI; not while a menu or dialog takes it.
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.defaultPrevented || !viewed.value) return
  if (document.querySelector('[role="menu"], [role="dialog"], [role="listbox"]')) return
  ui.agentId = viewed.value.parentId ?? null
})

/** What the agent is doing, under the timeline while a turn runs and no text streams. */
const working = computed(() => {
  const agent = viewed.value
  if (agent) {
    if (agent.status !== 'running') return null
    const last = items.value.findLast((i) => i.parentId === agent.id)
    if (last && (last.kind === 'assistant' || last.kind === 'thinking') && last.streaming) return null
    return last ? 'Arbeitet …' : 'Startet …'
  }
  if (!busy.value) return null
  const last = items.value[items.value.length - 1]
  if (last && (last.kind === 'assistant' || last.kind === 'thinking') && last.streaming) return null
  if (runtime.value.status === 'waiting') return 'Wartet auf deine Antwort'
  if (runtime.value.status === 'starting') return `${PROVIDERS[meta.value?.provider ?? 'claude'].name} startet …`
  return 'Arbeitet …'
})
const elapsed = computed(() => {
  const since = viewed.value ? viewed.value.startedAt : runtime.value.turnStartedAt
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

async function send(input: { text: string; images: string[] }): Promise<void> {
  const id = meta.value?.id
  if (!id) return
  // The answer comes in the main chat.
  mainScroll = null
  ui.agentId = null
  scrollToBottom()
  await attempt(() => sessions.send(id, input), 'Senden fehlgeschlagen')
}

function update(patch: SessionUpdateInput): void {
  const id = meta.value?.id
  if (id) void attempt(() => sessions.update(id, patch), 'Ändern fehlgeschlagen')
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

async function remove(): Promise<void> {
  const id = meta.value?.id
  if (!id || !(await ui.confirm({ title: `„${meta.value?.title}“ löschen?`, description: 'Der Verlauf in Nexa geht verloren.', confirmText: 'Löschen', destructive: true }))) return
  await attempt(() => sessions.remove(id), 'Löschen fehlgeschlagen')
  ui.view = 'home'
}
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
          class="min-w-0 flex-1 rounded-md border bg-background/60 px-2 py-0.5 text-sm font-medium outline-none"
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
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" aria-label="Mehr">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuItem @select="startRename"><PencilIcon /> Umbenennen</DropdownMenuItem>
              <DropdownMenuItem v-if="project" @select="openFolder"><FolderOpenIcon /> Projektordner öffnen</DropdownMenuItem>
              <DropdownMenuItem :disabled="!runtime.connected" @select="sessions.stop(meta.id)"><PowerIcon /> CLI beenden</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive" @select="remove"><Trash2Icon /> Löschen</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <BrowserToggle :session-id="meta.id" class="-mr-2" />
        </div>
      </div>

      <!-- Timeline, with the composer floating over its end -->
      <div class="relative min-h-0 flex-1">
        <!-- Hidden, not removed, under a file's changes: it keeps its place in the chat. -->
        <!-- The scroll bar's gutter always, so the chat and what floats over it share one centre. -->
        <div ref="viewport" :class="cn('chat-fade h-full overflow-y-auto [scrollbar-gutter:stable]', diff && 'invisible')" :style="fadeStyle">
          <div ref="content" class="mx-auto w-full max-w-(--chat-width) px-6 pt-6" :style="{ paddingBottom: `${dockHeight + 16}px` }">
            <div v-if="chat && !chat.loaded" class="flex justify-center py-10"><Spinner class="size-5 text-muted-foreground" /></div>
            <AgentThread v-else-if="viewed" :key="viewed.id" :agent="viewed" :items="items" :session-id="meta.id" />
            <MessageList v-else :items="items" :session-id="meta.id" />
            <div v-if="working" class="flex items-center gap-2 py-2 text-[0.85rem] text-muted-foreground">
              <Spinner class="size-3.5" />
              <span class="text-shimmer">{{ working }}</span>
              <span v-if="elapsed" class="tabular-nums opacity-70">{{ elapsed }}</span>
            </div>
            <div v-if="runError && !viewed" class="selectable my-2 rounded-lg bg-destructive/10 px-3 py-2 text-[0.82rem] text-destructive">
              {{ runError }}
            </div>
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
              <li v-if="treeTarget">Dateien aus dem Baum ins Feld ziehen erwähnt sie · <Kbd>Strg</Kbd> + <Kbd>Umschalt</Kbd> + <Kbd>E</Kbd></li>
            </ul>
          </div>
        </div>
        <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity" leave-active-class="transition-opacity">
          <Button
            v-if="!atBottom && !diff"
            variant="outline"
            size="icon-sm"
            class="absolute left-[calc(50%-5px)] z-30 -translate-x-1/2 rounded-full bg-popover/80 shadow-md backdrop-blur-md"
            :style="{ bottom: `${dockHeight + 10}px` }"
            aria-label="Nach unten"
            @click="scrollToBottom(true)"
          >
            <ArrowDownIcon />
          </Button>
        </Transition>
        <!-- A file's changes from the tree, or all of them, over the timeline; the composer stays below. -->
        <div v-if="diff" class="absolute inset-x-0 top-0 z-10 flex flex-col" :style="{ bottom: `${dockHeight}px` }">
          <ChangesView v-if="diff.path === ''" :key="diff.root" :root="diff.root" closable class="min-h-0 flex-1" @close="fileTree.closeDiff(meta.id)" />
          <DiffView v-else :key="`${diff.root}|${diff.path}`" :root="diff.root" :path="diff.path" closable class="min-h-0 flex-1" @close="fileTree.closeDiff(meta.id)" />
        </div>

        <!--
          Composer: floats over the end of the timeline, frosted, so the chat scrolls on beneath it
          instead of being cut off above it. Clicks around it reach the chat. No z-index: the
          .frost-backing under each card has to get below the timeline's text. Leaves out the
          scroll bar (10px, main.css) on the right, as the chat does.
        -->
        <div ref="dock" class="pointer-events-none absolute right-[10px] bottom-0 left-0 mx-auto max-w-(--chat-width) px-6 pb-5">
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
              <div v-if="dockShellList.length" class="frost-backing pointer-events-auto mb-2 min-w-0 flex-[1_1_16rem] rounded-xl">
                <ShellDock :shells="dockShellList" />
              </div>
            </Transition>
          </div>
          <div class="frost-backing pointer-events-auto rounded-2xl">
            <Composer
              floating
              :draft-key="meta.id"
              :provider="meta.provider"
              :account="accounts.sessionAccount(meta)"
              :model="meta.model"
              :effort="meta.effort"
              :mode="meta.permissionMode"
              :busy="busy"
              :context="runtime.context"
              autofocus
              @send="send"
              @stop="sessions.interrupt(meta.id)"
              @update:provider="(provider) => update({ provider })"
              @update:account="(account) => update({ account })"
              @update:model="(model) => update({ model })"
              @update:effort="(effort) => update({ effort })"
              @update:mode="(permissionMode) => update({ permissionMode })"
            />
          </div>
        </div>
      </div>
    </div>
    <ShellPanel v-if="ui.shellId" :items="items" :session-id="meta.id" />
    <BrowserPanel :session-id="meta.id" />
  </div>
</template>
