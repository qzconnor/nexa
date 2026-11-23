<script setup lang="ts">
import { FolderIcon, PanelLeftIcon } from '@lucide/vue'
import { computed } from 'vue'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import AppLogo from '@/components/common/AppLogo.vue'
import GitBranchChip from '@/components/common/GitBranchChip.vue'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import TitleBarUsage from './TitleBarUsage.vue'

/**
 * The title bar: logo, the sidebar's button, the open chat's project and branch, and the usage of
 * the CLIs that count now. The caption buttons are Electron's titleBarOverlay on the right, so that
 * area stays free.
 */
const app = useAppStore()
const projects = useProjectsStore()
const providers = useProvidersStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()

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

function openProject(): void {
  if (project.value) void window.api.app.openPath(project.value.path)
}
</script>

<template>
  <header
    :data-unfocused="!app.windowState.focused || undefined"
    class="app-drag flex h-(--titlebar-height) shrink-0 items-center gap-1 pr-(--caption-buttons-width) pl-3"
  >
    <!-- As wide as the sidebar while it is open, so the project starts above the page's corner. -->
    <div :class="cn('flex shrink-0 items-center', ui.sidebarOpen && 'w-[calc(var(--sidebar-width)-0.75rem)]')">
      <div class="flex items-center gap-2.5 transition-opacity in-data-unfocused:opacity-75">
        <AppLogo class="size-5" />
        <span class="text-[0.95rem] font-semibold tracking-tight">Nexa</span>
      </div>
      <Button variant="ghost" size="icon-sm" class="app-no-drag ml-2 text-muted-foreground" aria-label="Seitenleiste" @click="ui.toggleSidebar()">
        <PanelLeftIcon />
      </Button>
    </div>
    <div v-if="project" :class="cn('flex min-w-0 items-center gap-1.5 transition-opacity in-data-unfocused:opacity-75', !ui.sidebarOpen && 'ml-2')">
      <button
        type="button"
        class="app-no-drag flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[0.8rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :aria-label="`Projektordner ${project.name} öffnen`"
        v-tooltip="`${project.path} · Klicken öffnet den Ordner`"
        @click="openProject"
      >
        <FolderIcon class="size-3.5 shrink-0" />
        <span class="truncate font-medium">{{ project.name }}</span>
      </button>
      <GitBranchChip :cwd="project.path" class="min-w-0" />
    </div>
    <div class="h-full min-w-8 flex-1" />
    <div class="mr-2 flex items-center gap-1 transition-opacity in-data-unfocused:opacity-75">
      <TitleBarUsage v-for="id in shown" :key="id" :provider="id" />
    </div>
  </header>
</template>
