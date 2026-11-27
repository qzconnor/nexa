<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import BrowserLayer from '@/components/browser/BrowserLayer.vue'
import ChatView from '@/components/chat/ChatView.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import DeviceScope from '@/components/layout/DeviceScope.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import TitleBar from '@/components/layout/TitleBar.vue'
import CommandPalette from '@/components/palette/CommandPalette.vue'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAgentNotifications } from '@/composables/useAgentNotifications'
import { useChatActions } from '@/composables/useChatActions'
import { useShortcuts } from '@/composables/useShortcuts'
import { useThemeSync } from '@/composables/useThemeSync'
import { isChatWindow, ownChat } from '@/lib/chat-window'
import { attempt, errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useAppStore } from '@/stores/app'
import { useChatWindowsStore } from '@/stores/chat-windows'
import { useShownDeviceStore } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useScheduledStore } from '@/stores/scheduled'
import { useServerLinkStore } from '@/stores/server-link'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { useUiStore } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import HomeView from '@/views/HomeView.vue'

/*
 * Dialogs and pages that aren't on screen at the start come as chunks of their own: the start loads
 * and parses less, and each comes right after the window is up.
 */
const AccountFormDialog = defineAsyncComponent(() => import('@/components/accounts/AccountFormDialog.vue'))
const AccountLoginDialog = defineAsyncComponent(() => import('@/components/accounts/AccountLoginDialog.vue'))
const ChatCleanupDialog = defineAsyncComponent(() => import('@/components/layout/ChatCleanupDialog.vue'))
const FolderPromptDialog = defineAsyncComponent(() => import('@/components/layout/FolderPromptDialog.vue'))
const StartCommandsDialog = defineAsyncComponent(() => import('@/components/layout/StartCommandsDialog.vue'))
const WorktreeDialog = defineAsyncComponent(() => import('@/components/layout/WorktreeDialog.vue'))
const SettingsDialog = defineAsyncComponent(() => import('@/components/settings/SettingsDialog.vue'))
const SettingsImportDialog = defineAsyncComponent(() => import('@/components/settings/SettingsImportDialog.vue'))
const ThemeEditorDialog = defineAsyncComponent(() => import('@/components/themes/ThemeEditorDialog.vue'))
const ArtifactsView = defineAsyncComponent(() => import('@/views/ArtifactsView.vue'))
const InboxView = defineAsyncComponent(() => import('@/views/InboxView.vue'))
const ScheduledTaskDialog = defineAsyncComponent(() => import('@/components/scheduled/ScheduledTaskDialog.vue'))
const ScheduledView = defineAsyncComponent(() => import('@/views/ScheduledView.vue'))
const SetupView = defineAsyncComponent(() => import('@/views/SetupView.vue'))

const settings = useSettingsStore()
const themes = useThemesStore()
const app = useAppStore()
const providers = useProvidersStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const chatWindows = useChatWindowsStore()
const scheduled = useScheduledStore()
const shown = useShownDeviceStore()
/** The chats of the device the main area shows: this one's, or another's (Remote Control). */
const shownSessions = computed(() => useSessionsStore(shown.device))

/** Under the title bar, where no button of the chat sits (`--titlebar-height`, main.css). */
const TOAST_OFFSET = { top: 'calc(var(--titlebar-height) + 0.75rem)', right: '1rem' }

const ready = ref(false)
const fatal = ref<string | null>(null)
const { theme } = useThemeSync()

// Ctrl+, the settings, Ctrl+Shift+A/P the quick open, Ctrl+Tab and Ctrl+1–9 the chats (shared/shortcuts.ts).
useShortcuts(ready)
// What the agents send with `notify`, as toasts in whichever window main picks.
useAgentNotifications()

// The chat in view: its notification has been seen, and it gets none while the window is in front.
watch(
  () => (ready.value && ui.view === 'chat' ? (sessions.active?.id ?? null) : null),
  (id) => void window.api.notifications.viewing(id).catch(() => undefined),
  { immediate: true },
)

const sidebarShown = computed(() => ui.sidebarOpen && !isChatWindow)
const serverLink = useServerLinkStore()

if (isChatWindow) {
  // The taskbar and Alt+Tab name the chat.
  watch(
    () => sessions.active?.title,
    (title) => (document.title = title ? `${title} – Nexa` : 'Nexa'),
    { immediate: true },
  )
  // Its chat is gone (deleted elsewhere): nothing left to show.
  watch(
    () => ready.value && !sessions.active,
    (gone) => {
      if (gone) void chatWindows.closeOwn()
    },
  )
} else {
  // The open chat went into a window of its own (or came up there at the start): the start page here.
  const chatActions = useChatActions()
  watch(
    () => ui.view === 'chat' && chatWindows.elsewhere(sessions.activeId),
    (gone) => {
      if (gone) chatActions.newChat(sessions.active?.projectId ?? null)
    },
  )
}

/** A chat's own window: its chat, with what came along from the main window. */
async function openOwnChat(id: string): Promise<void> {
  ui.view = 'chat'
  // Deleted meanwhile: the window closes once it is up (see above).
  if (!sessions.get(id)) return
  const handoff = await window.api.chatWindows.takeHandoff(id).catch(() => null)
  if (handoff) chatWindows.apply(id, handoff)
  await sessions.open(id)
}

onMounted(async () => {
  try {
    await Promise.all([settings.load(), app.load(), themes.load().catch((error) => console.error('[themes]', error))])
    await Promise.all([providers.load(), accounts.load(), projects.load(), sessions.load()])
    if (ownChat) {
      await openOwnChat(ownChat)
    } else {
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
    }
    ready.value = true
    // After the window is up: the hints about a new version or an update just installed are toasts,
    // in the main window only.
    if (!isChatWindow) {
      void useUpdatesStore()
        .load()
        .catch((error) => console.error('[updates]', error))
      // The sidebar counts the tasks that run on their own.
      void scheduled
        .load()
        .catch((error) => console.error('[scheduled]', error))
      // Whether there is a server, and the other devices it connects: their chats in the sidebar.
      void serverLink.load().catch((error) => console.error('[nexa-server]', error))
      useDevicesStore().start()
    }
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
        <Sidebar v-if="sidebarShown" />
        <!-- The page sits as a panel in the window's frame (title bar and sidebar share its colour). -->
        <main
          :class="
            cn(
              'relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t bg-surface',
              sidebarShown && 'rounded-tl-xl border-l',
            )
          "
        >
          <!-- The chat and the start page of the device whose chat was opened last, with its stores. -->
          <DeviceScope v-if="ui.view === 'chat' && shownSessions.active" :key="`chat:${shown.device ?? ''}`" :device="shown.device">
            <ChatView />
          </DeviceScope>
          <!-- A chat's own window shows that chat and nothing else. -->
          <template v-else-if="!isChatWindow">
            <InboxView v-if="ui.view === 'inbox'" />
            <ArtifactsView v-else-if="ui.view === 'artifacts'" />
            <ScheduledView v-else-if="ui.view === 'scheduled'" />
            <!-- Chats stay reachable; only this device's start page waits for the setup. -->
            <SetupView v-else-if="!shown.device && !settings.settings.setup.done" />
            <DeviceScope v-else :key="`home:${shown.device ?? ''}`" :device="shown.device">
              <HomeView />
            </DeviceScope>
          </template>
          <div v-else class="flex flex-1 items-center justify-center"><Spinner class="size-5 text-muted-foreground" /></div>
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
      <!-- In a chat's own window the main window's quick open comes instead (ui.openPalette). -->
      <CommandPalette v-if="!isChatWindow" />
      <SettingsDialog />
      <ThemeEditorDialog />
      <AccountFormDialog />
      <AccountLoginDialog />
      <FolderPromptDialog />
      <StartCommandsDialog />
      <ChatCleanupDialog />
      <WorktreeDialog />
      <SettingsImportDialog />
      <ScheduledTaskDialog v-if="!isChatWindow" />
    </template>
    <ConfirmDialog />
    <AppTooltip />
    <!-- At the top, under the title bar: at the bottom they covered the composer's send button for seconds. -->
    <Toaster :theme="theme.mode" position="top-right" :offset="TOAST_OFFSET" :mobile-offset="TOAST_OFFSET" close-button />
  </TooltipProvider>
</template>
