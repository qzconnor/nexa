<script setup lang="ts">
import { CalendarClockIcon, SettingsIcon, ShapesIcon, SquarePenIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Button } from '@/components/ui/button'
import { useChatActions } from '@/composables/useChatActions'
import { useClock } from '@/composables/useClock'
import { useListKeys } from '@/composables/useListKeys'
import { cn } from '@/lib/utils'
import { useShownDeviceStore } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { useScheduledStore } from '@/stores/scheduled'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore, type SidebarFilter } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import DeviceScope from './DeviceScope.vue'
import SidebarDevice from './SidebarDevice.vue'
import SidebarPinned from './SidebarPinned.vue'
import SidebarTree from './SidebarTree.vue'

/**
 * A new chat, the artifacts and scheduled tasks, the pinned chats of all devices (SidebarPinned), and
 * the projects with their chats (SidebarTree): this device's, and below them those of every other
 * device it controls (Remote Control), each the same. A switch between the two narrows the projects to
 * the chats that run.
 */
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const updates = useUpdatesStore()
const scheduled = useScheduledStore()
const devices = useDevicesStore()
const shown = useShownDeviceStore()
const chat = useChatActions()

/**
 * The updates are a section of the settings: an update the automatic check found pulses on their
 * button, release notes still unread after an update get a dot. Either way the button then opens the
 * updates. One the user looked for themselves gets neither (`foundByUser`): they know of it.
 */
const settingsHint = computed(() =>
  updates.hasUpdate
    ? `Version ${updates.state.next} ist verfügbar`
    : updates.unseen
      ? `Neu in Version ${updates.state.current}`
      : null,
)
const openSettings = () => ui.openSettings(updates.hasUpdate || updates.unseen ? 'updates' : undefined)
const now = useClock(60_000)

const newChat = () => chat.newChat()
/** The start page is where a new chat begins: its button shows it as the page on screen, as a chat's row does. */
const onStartPage = computed(
  () => !shown.device && !(ui.view === 'chat' && sessions.active) && !['artifacts', 'scheduled'].includes(ui.view) && settings.settings.setup.done,
)
const onArtifacts = computed(() => ui.view === 'artifacts')
const onScheduled = computed(() => ui.view === 'scheduled')

const FILTERS: { value: SidebarFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'live', label: 'Aktiv' },
]

const nav = ref<HTMLElement | null>(null)
// The arrows from row to row, open and close what has rows in it (useListKeys), across the devices.
useListKeys(nav)
</script>

<template>
  <aside class="flex h-full w-(--sidebar-width) shrink-0 flex-col">
    <div class="flex flex-col gap-1 p-2">
      <Button
        variant="ghost"
        :class="cn('justify-start gap-2 px-2.5', onStartPage && 'bg-sidebar-accent')"
        :aria-current="onStartPage ? 'page' : undefined"
        @click="newChat"
      >
        <SquarePenIcon />
        Neuer Chat
      </Button>
      <Button
        variant="ghost"
        :class="cn('justify-start gap-2 px-2.5', onArtifacts && 'bg-sidebar-accent')"
        :aria-current="onArtifacts ? 'page' : undefined"
        @click="ui.view = 'artifacts'"
      >
        <ShapesIcon />
        Artefakte
      </Button>
      <Button
        variant="ghost"
        :class="cn('justify-start gap-2 px-2.5', onScheduled && 'bg-sidebar-accent')"
        :aria-current="onScheduled ? 'page' : undefined"
        @click="ui.view = 'scheduled'"
      >
        <CalendarClockIcon />
        <span class="flex-1 text-left">Geplant</span>
        <!-- What runs on its own is worth a glance: how many tasks are on. -->
        <span v-if="scheduled.activeCount" class="text-[0.7rem] text-muted-foreground/70 tabular-nums">{{ scheduled.activeCount }}</span>
      </Button>
    </div>

    <nav ref="nav" class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <SidebarPinned :now="now" />
      <!-- For the projects below, on every device; the pinned above stay as they are. -->
      <SegmentedControl v-model="ui.sidebarFilter" :options="FILTERS" block class="mt-2" aria-label="Welche Chats die Projekte zeigen" />
      <SidebarTree :now="now" />
      <DeviceScope v-for="d in devices.devices" :key="d.id" :device="d.id">
        <SidebarDevice :device="d" :now="now" />
      </DeviceScope>
    </nav>

    <div class="flex flex-col gap-0.5 p-2">
      <Button
        variant="ghost"
        :class="cn('justify-start gap-2 px-2.5', ui.settingsOpen && 'bg-sidebar-accent')"
        v-tooltip.right="settingsHint"
        @click="openSettings"
      >
        <SettingsIcon />
        <span class="flex-1 text-left">Einstellungen</span>
        <span v-if="updates.announced" class="relative mr-1 flex size-2" aria-hidden="true">
          <span class="absolute size-full animate-ping rounded-full bg-success opacity-75" />
          <span class="relative size-2 rounded-full bg-success" />
        </span>
        <span v-else-if="updates.unseen" class="mr-1 size-2 rounded-full bg-success" aria-hidden="true" />
      </Button>
    </div>
  </aside>
</template>
