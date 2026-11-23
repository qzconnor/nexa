<script setup lang="ts">
import { ArrowDownIcon, BotIcon, FolderOpenIcon, MoreHorizontalIcon, PanelLeftIcon, PencilIcon, PowerIcon, Trash2Icon } from '@lucide/vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import { computed, nextTick, ref, watch } from 'vue'
import type { AgentItem, TodoItem } from '@shared/chat'
import type { SessionUpdateInput } from '@shared/types'
import { PROVIDERS } from '@shared/providers'
import BrowserPanel from '@/components/browser/BrowserPanel.vue'
import BrowserToggle from '@/components/browser/BrowserToggle.vue'
import GitBranchChip from '@/components/common/GitBranchChip.vue'
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
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { provideProjectPath } from '@/composables/useProjectPath'
import { useStickToBottom } from '@/composables/useStickToBottom'
import { attempt } from '@/lib/errors'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { MAX_TREE_SHARE, useFileTreeStore } from '@/stores/file-tree'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import AgentPanel from './AgentPanel.vue'
import Composer from './Composer.vue'
import MessageList from './MessageList.vue'
import TodoCard from './TodoCard.vue'

/** The open chat: header, timeline, the agents beside it and the composer below. */
const sessions = useSessionsStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()
const ui = useUiStore()
const fileTree = useFileTreeStore()
const now = useClock(1000)

const meta = computed(() => sessions.active)
const chat = computed(() => sessions.activeChat)
const runtime = computed(() => sessions.activeRuntime)
const items = computed(() => chat.value?.items ?? [])
const project = computed(() => projects.get(meta.value?.projectId))
provideProjectPath(computed(() => project.value?.path ?? null))
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
const { atBottom, scrollToBottom } = useStickToBottom(viewport, content)

const agents = computed(() => items.value.filter((i): i is AgentItem => i.kind === 'agent'))
const runningAgents = computed(() => agents.value.filter((a) => a.status === 'running').length)
const todo = computed(() => [...items.value].reverse().find((i): i is TodoItem => i.kind === 'todo' && !i.parentId))
const showTodo = computed(() => busy.value && todo.value && todo.value.entries.some((e) => e.status !== 'completed'))

/** What the agent is doing, under the timeline while a turn runs and no text streams. */
const working = computed(() => {
  if (!busy.value) return null
  const last = items.value[items.value.length - 1]
  if (last && (last.kind === 'assistant' || last.kind === 'thinking') && last.streaming) return null
  if (runtime.value.status === 'waiting') return 'Wartet auf deine Antwort'
  if (runtime.value.status === 'starting') return `${PROVIDERS[meta.value?.provider ?? 'claude'].name} startet …`
  return 'Arbeitet …'
})
const elapsed = computed(() => (runtime.value.turnStartedAt ? formatDuration(Math.max(0, now.value - runtime.value.turnStartedAt)) : ''))

watch(
  () => sessions.activeId,
  async () => {
    ui.agentId = null
    await nextTick()
    scrollToBottom()
  },
)

async function send(input: { text: string; images: string[] }): Promise<void> {
  const id = meta.value?.id
  if (!id) return
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
  if (project.value) void window.api.app.openPath(project.value.path)
}

async function remove(): Promise<void> {
  const id = meta.value?.id
  if (!id || !(await ui.confirm({ title: `„${meta.value?.title}“ löschen?`, description: 'Der Verlauf in Nexa geht verloren.', confirmText: 'Löschen', destructive: true }))) return
  await attempt(() => sessions.remove(id), 'Löschen fehlgeschlagen')
  ui.view = 'home'
}
</script>

<template>
  <div v-if="meta" ref="area" class="flex min-h-0 min-w-0 flex-1">
    <FileTreePanel
      v-if="treeShown && treeTarget"
      :target="treeTarget"
      side="left"
      :max-width="treeMax"
      :current="diff?.path || null"
      class="relative shrink-0 border-r"
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
        <button v-else type="button" class="min-w-0 truncate text-sm font-medium" :title="meta.title" @dblclick="startRename">{{ meta.title }}</button>
        <span v-if="project" class="hidden min-w-0 truncate text-xs text-muted-foreground sm:inline">{{ project.name }}</span>
        <GitBranchChip :cwd="project?.path ?? null" class="hidden md:flex" />
        <div class="ml-auto flex shrink-0 items-center gap-1">
          <Button
            v-if="agents.length"
            variant="ghost"
            size="sm"
            :class="cn('gap-1.5', ui.agentId && 'bg-muted')"
            @click="ui.agentId = ui.agentId ? null : (agents.find((a) => a.status === 'running') ?? agents[agents.length - 1]).id"
          >
            <BotIcon :class="cn(runningAgents && 'text-primary')" />
            {{ runningAgents ? `${runningAgents} aktiv` : agents.length }}
          </Button>
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

      <!-- Timeline -->
      <div class="relative min-h-0 flex-1">
        <!-- Hidden, not removed, under a file's changes: it keeps its place in the chat. -->
        <div ref="viewport" :class="cn('h-full overflow-y-auto', diff && 'invisible')">
          <div ref="content" class="mx-auto w-full max-w-(--chat-width) px-6 pt-6 pb-4">
            <div v-if="chat && !chat.loaded" class="flex justify-center py-10"><Spinner class="size-5 text-muted-foreground" /></div>
            <MessageList v-else :items="items" :session-id="meta.id" />
            <div v-if="working" class="flex items-center gap-2 py-2 text-[0.85rem] text-muted-foreground">
              <Spinner class="size-3.5" />
              <span class="text-shimmer">{{ working }}</span>
              <span v-if="elapsed" class="tabular-nums opacity-70">{{ elapsed }}</span>
            </div>
            <div v-if="runtime.status === 'error' && runtime.error" class="selectable my-2 rounded-lg bg-destructive/10 px-3 py-2 text-[0.82rem] text-destructive">
              {{ runtime.error }}
            </div>
          </div>
        </div>
        <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition-opacity" leave-active-class="transition-opacity">
          <Button
            v-if="!atBottom && !diff"
            variant="outline"
            size="icon-sm"
            class="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-popover shadow-md"
            aria-label="Nach unten"
            @click="scrollToBottom(true)"
          >
            <ArrowDownIcon />
          </Button>
        </Transition>
        <!-- A file's changes from the tree, or all of them, over the timeline; the composer stays below. -->
        <div v-if="diff" class="absolute inset-0 z-10 flex flex-col">
          <ChangesView v-if="diff.path === ''" :key="diff.root" :root="diff.root" closable class="min-h-0 flex-1" @close="fileTree.closeDiff(meta.id)" />
          <DiffView v-else :key="`${diff.root}|${diff.path}`" :root="diff.root" :path="diff.path" closable class="min-h-0 flex-1" @close="fileTree.closeDiff(meta.id)" />
        </div>
      </div>

      <!-- Composer -->
      <div class="mx-auto w-full max-w-(--chat-width) shrink-0 px-6 pb-5">
        <TodoCard v-if="showTodo && todo" :item="todo" compact class="mb-2 bg-card/80" />
        <Composer
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
    <AgentPanel v-if="ui.agentId" :items="items" :session-id="meta.id" />
    <BrowserPanel :session-id="meta.id" />
  </div>
</template>
