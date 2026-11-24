<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import AccountFormDialog from '@/components/accounts/AccountFormDialog.vue'
import AccountLoginDialog from '@/components/accounts/AccountLoginDialog.vue'
import BrowserLayer from '@/components/browser/BrowserLayer.vue'
import ChatView from '@/components/chat/ChatView.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ChatCleanupDialog from '@/components/layout/ChatCleanupDialog.vue'
import FolderPromptDialog from '@/components/layout/FolderPromptDialog.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import TitleBar from '@/components/layout/TitleBar.vue'
import CommandPalette from '@/components/palette/CommandPalette.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import ThemeEditorDialog from '@/components/themes/ThemeEditorDialog.vue'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useShortcuts } from '@/composables/useShortcuts'
import { useThemeSync } from '@/composables/useThemeSync'
import { attempt, errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useAppStore } from '@/stores/app'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { useUiStore } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import ArtifactsView from '@/views/ArtifactsView.vue'
import HomeView from '@/views/HomeView.vue'
import SetupView from '@/views/SetupView.vue'

const settings = useSettingsStore()
const themes = useThemesStore()
const app = useAppStore()
const providers = useProvidersStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const ui = useUiStore()

const ready = ref(false)
const fatal = ref<string | null>(null)
const { theme } = useThemeSync()

// Ctrl+, the settings, Ctrl+Shift+A/P the quick open, Ctrl+Tab and Ctrl+1–9 the chats (shared/shortcuts.ts).
useShortcuts(ready)

// The chat in view: its notification has been seen, and it gets none while the window is in front.
watch(
  () => (ready.value && ui.view === 'chat' ? (sessions.active?.id ?? null) : null),
  (id) => void window.api.notifications.viewing(id).catch(() => undefined),
  { immediate: true },
)

onMounted(async () => {
  try {
    await Promise.all([settings.load(), app.load(), themes.load().catch((error) => console.error('[themes]', error))])
    await Promise.all([providers.load(), accounts.load(), projects.load(), sessions.load()])
    // `nx` or the local API asks for a session.
    window.api.sessions.onShow((id) => {
      ui.view = 'chat'
      void attempt(() => sessions.open(id), 'Session ließ sich nicht öffnen')
    })
    // `nx -r` without an id: the folder's chats to pick from, as Claude Code's `--resume` offers them.
    window.api.sessions.onFind((query) => {
      ui.paletteQuery = query
      ui.paletteOpen = true
    })
    // A notification about an account's limits or login.
    window.api.settings.onOpen((section) => ui.openSettings(section))
    ready.value = true
    // After the window is up: the hints about a new version or an update just installed are toasts.
    void useUpdatesStore()
      .load()
      .catch((error) => console.error('[updates]', error))
  } catch (error) {
    fatal.value = errorMessage(error)
  }
})
</script>

<template>
  <TooltipProvider :delay-duration="400">
    <div v-if="ready" class="flex h-full flex-col">
      <TitleBar />
      <div class="flex min-h-0 flex-1">
        <Sidebar v-if="ui.sidebarOpen" />
        <!-- The page sits as a panel in the window's frame (title bar and sidebar share its colour). -->
        <main
          :class="
            cn(
              'relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t bg-surface',
              ui.sidebarOpen && 'rounded-tl-xl border-l',
            )
          "
        >
          <ChatView v-if="ui.view === 'chat' && sessions.active" />
          <ArtifactsView v-else-if="ui.view === 'artifacts'" />
          <!-- Chats stay reachable; only the start page waits for the setup. -->
          <SetupView v-else-if="!settings.settings.setup.done" />
          <HomeView v-else />
          <!-- The pages of the chats' browsers, placed over the open chat's browser panel. -->
          <BrowserLayer />
        </main>
      </div>
    </div>
    <div v-else class="app-drag flex h-full items-center justify-center">
      <Empty v-if="fatal">
        <EmptyHeader>
          <EmptyTitle>Start fehlgeschlagen</EmptyTitle>
          <EmptyDescription class="selectable">{{ fatal }}</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <Spinner v-else class="size-6 text-muted-foreground" />
    </div>
    <template v-if="ready">
      <CommandPalette />
      <SettingsDialog />
      <ThemeEditorDialog />
      <AccountFormDialog />
      <AccountLoginDialog />
      <FolderPromptDialog />
      <ChatCleanupDialog />
    </template>
    <ConfirmDialog />
    <AppTooltip />
    <Toaster :theme="theme.mode" position="bottom-right" close-button />
  </TooltipProvider>
</template>
