<script setup lang="ts">
import { FolderIcon, PanelLeftIcon } from '@lucide/vue'
import { computed } from 'vue'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { subfolderSegments } from '@shared/folders'
import AppLogo from '@/components/common/AppLogo.vue'
import GitBranchChip from '@/components/common/GitBranchChip.vue'
import { Button } from '@/components/ui/button'
import { isChatWindow } from '@/lib/chat-window'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import TitleBarNotifications from './TitleBarNotifications.vue'
import TitleBarSearch from './TitleBarSearch.vue'
import TitleBarUsage from './TitleBarUsage.vue'

/**
 * The title bar: logo, the sidebar's button, the open chat's project and branch, the quick open's
 * search, the usage of the CLIs that count now and the bell of the notifications. The caption buttons are Electron's titleBarOverlay on the right, so that
 * area stays free. A chat's own window has no sidebar and no quick open: logo, project, usage, bell.
 */
const app = useAppStore()
const projects = useProjectsStore()
const providers = useProvidersStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
/** A chat's own window has no sidebar. */
const sidebarOpen = computed(() => ui.sidebarOpen && !isChatWindow)

/**
 * The CLIs that count now: in a chat those it ran with (both after a switch), elsewhere the one new
 * chats start with. Limits of a CLI the chat doesn't use, or one switched off, would only be noise.
 */
const shown = computed<ProviderId[]>(() => {
  const meta = ui.view === 'chat' ? sessions.active : null
  const wanted = meta ? PROVIDER_IDS.filter((id) => id === meta.provider || meta.cli[id]) : [settings.settings.defaults.provider]
  const list = wanted.filter((id) => providers.available.includes(id))
  return list.length ? list : providers.available.slice(0, 1)
})

/** Where the open chat's agent works. */
const project = computed(() => (ui.view === 'chat' && sessions.active ? projects.get(sessions.active.projectId) : undefined))
/** The folder itself: the project's, or one in it the chat works in. */
const cwd = computed(() => (project.value ? (sessions.cwdOf(sessions.active) ?? project.value.path) : null))
/**
 * The way from the project to the chat's folder, e.g. `nexa/src`; empty for the project's own. Empty
 * for a chat's worktree too: the branch chip names it (`worktree-<name>`), and `.claude/worktrees/`
 * would push the project's name out.
 */
const subfolder = computed(() => {
  if (!project.value || !cwd.value) return ''
  const worktree = ui.view === 'chat' ? sessions.active?.worktree : undefined
  if (worktree && cwd.value === worktree.path) return ''
  return subfolderSegments(cwd.value, project.value.path).join('/')
})

function openProject(): void {
  if (cwd.value) void window.api.app.openPath(cwd.value)
}
</script>

<template>
  <header
    :data-unfocused="!app.windowState.focused || undefined"
    class="app-drag flex h-(--titlebar-height) shrink-0 items-center gap-1 pr-(--caption-buttons-width) pl-3"
  >
    <!-- As wide as the sidebar while it is open, so the project starts above the page's corner. -->
    <div :class="cn('flex shrink-0 items-center', sidebarOpen && 'w-[calc(var(--sidebar-width)-0.75rem)]')">
      <div class="flex items-center gap-2.5 transition-opacity in-data-unfocused:opacity-75">
        <AppLogo class="size-5" />
        <span class="text-[0.95rem] font-semibold tracking-tight">Nexa</span>
      </div>
      <Button
        v-if="!isChatWindow"
        variant="ghost"
        size="icon-sm"
        class="app-no-drag ml-2 text-muted-foreground"
        aria-label="Seitenleiste"
        @click="ui.toggleSidebar()"
      >
        <PanelLeftIcon />
      </Button>
    </div>
    <!-- The search in the middle above the page, between the open chat's place and the usage. The right
         column never gets narrower than the usage: the search moves left rather than cover it. -->
    <div
      :class="
        cn(
          'grid h-full min-w-0 flex-1 items-center gap-2',
          isChatWindow
            ? 'grid-cols-[minmax(0,1fr)_minmax(max-content,auto)]'
            : 'grid-cols-[minmax(0,1fr)_minmax(11rem,min(30rem,42%))_minmax(max-content,1fr)]',
        )
      "
    >
      <div :class="cn('flex min-w-0 items-center gap-1.5 transition-opacity in-data-unfocused:opacity-75', !sidebarOpen && 'ml-2')">
        <template v-if="project">
          <button
            type="button"
            class="app-no-drag flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[0.8rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :aria-label="`Projektordner ${project.name} öffnen`"
            v-tooltip="`${cwd} · Klicken öffnet den Ordner`"
            @click="openProject"
          >
            <FolderIcon class="size-3.5 shrink-0" />
            <!-- Gives way to the subfolder slowly: the project is what tells chats apart. -->
            <span class="shrink-[0.25] truncate font-medium">{{ project.name }}</span>
            <span v-if="subfolder" class="truncate">/ {{ subfolder }}</span>
          </button>
          <GitBranchChip :cwd="cwd ?? project.path" class="min-w-0" />
        </template>
      </div>
      <TitleBarSearch v-if="!isChatWindow" />
      <div class="mr-2 flex items-center justify-end gap-1 transition-opacity in-data-unfocused:opacity-75">
        <TitleBarUsage v-for="id in shown" :key="id" :provider="id" />
        <TitleBarNotifications />
      </div>
    </div>
  </header>
</template>
