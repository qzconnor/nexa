<script setup lang="ts">
import { CalendarClockIcon, InboxIcon, SettingsIcon, ShapesIcon, SquarePenIcon, TagIcon, XIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { allTags, hasTag } from '@shared/session-tags'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useChatActions } from '@/composables/useChatActions'
import { useClock } from '@/composables/useClock'
import { useListKeys } from '@/composables/useListKeys'
import { chatCounts } from '@/lib/chat-state'
import { cn } from '@/lib/utils'
import { useShownDeviceStore } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { useInboxStore } from '@/stores/inbox'
import { useProjectsStore } from '@/stores/projects'
import { useScheduledStore } from '@/stores/scheduled'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { PAGE_VIEWS, useUiStore, type SidebarFilter } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import DeviceScope from './DeviceScope.vue'
import SidebarDevice from './SidebarDevice.vue'
import SidebarPinned from './SidebarPinned.vue'
import SidebarTree from './SidebarTree.vue'

/**
 * A new chat, the inbox, the artifacts and scheduled tasks, the pinned chats of all devices
 * (SidebarPinned), and the projects with their chats (SidebarTree): this device's, and below them those
 * of every other device it controls (Remote Control), each the same. A switch between the two narrows
 * the projects to the chats that run.
 */
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const updates = useUpdatesStore()
const scheduled = useScheduledStore()
const inbox = useInboxStore()
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
  () => !shown.device && !(ui.view === 'chat' && sessions.active) && !PAGE_VIEWS.includes(ui.view) && settings.settings.setup.done,
)
const onInbox = computed(() => ui.view === 'inbox')
const onArtifacts = computed(() => ui.view === 'artifacts')
const onScheduled = computed(() => ui.view === 'scheduled')

const FILTERS: { value: SidebarFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'live', label: 'Aktiv' },
]

/** This device and every other one whose chats are loaded below. */
const loadedDevices = computed(() => [null, ...devices.devices.filter((d) => d.state === 'ready').map((d) => d.id)])

/**
 * On the switch, what each side shows: the chats in the projects (not archived, as the tree has them,
 * with the tag picked beside it) and how many of them run, of every device loaded here.
 */
const counts = computed<Record<SidebarFilter, number>>(() => {
  const total = { all: 0, live: 0 }
  const tag = ui.sidebarTag
  for (const id of loadedDevices.value) {
    const projectIds = new Set(useProjectsStore(id).projects.map((p) => p.id))
    const chats = useSessionsStore(id)
    const { all, live } = chatCounts(
      chats.metas.filter((m) => !m.archived && projectIds.has(m.projectId) && (tag === null || hasTag(m.tags, tag))),
      chats.runtime,
    )
    total.all += all
    total.live += live
  }
  return total
})

/** The tags of the chats in the projects, of every device loaded here, to filter by one. */
const tags = computed(() => allTags(loadedDevices.value.flatMap((id) => useSessionsStore(id).metas.filter((m) => !m.archived))))
const pickTag = (value: unknown) => (ui.sidebarTag = typeof value === 'string' && value ? value : null)

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
        :class="cn('justify-start gap-2 px-2.5', onInbox && 'bg-sidebar-accent')"
        :aria-current="onInbox ? 'page' : undefined"
        @click="ui.view = 'inbox'"
      >
        <InboxIcon />
        <span class="flex-1 text-left">Posteingang</span>
        <!-- A question waits: with the mark a waiting chat has in its row. -->
        <span v-if="inbox.waiting" class="pulse-ring size-2 rounded-full bg-warning" aria-label="Ein Chat wartet auf eine Antwort" role="img" />
        <span v-if="inbox.attention" class="text-[0.7rem] text-muted-foreground tabular-nums">{{ inbox.attention }}</span>
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

    <!-- The scroll bar's gutter always: „Aktiv“ is often short enough to need none, and the switch and rows
         would grow and shrink by its width with every change. The gutter is the right margin then. -->
    <nav ref="nav" class="min-h-0 flex-1 overflow-y-auto pb-2 pl-2 [scrollbar-gutter:stable]">
      <SidebarPinned :now="now" />
      <!-- For the projects below, on every device; the pinned above stay as they are. -->
      <!-- A click keeps the focus where it was (the composer): held by the switch, the next key press
           would show its focus ring. Tab still reaches it, with the ring. -->
      <div class="mt-2 flex items-center gap-1">
        <SegmentedControl
          v-model="ui.sidebarFilter"
          :options="FILTERS"
          block
          size="sm"
          class="min-w-0 flex-1"
          aria-label="Welche Chats die Projekte zeigen"
          @mousedown.prevent
        >
          <template #option="{ option }">
            {{ option.label }}
            <span class="text-[0.7rem] tabular-nums opacity-60">{{ counts[option.value] }}</span>
          </template>
        </SegmentedControl>
        <!-- Only once a chat has a tag: before, there is nothing to pick. -->
        <DropdownMenu v-if="tags.length || ui.sidebarTag">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon-xs"
              :class="cn('shrink-0 text-muted-foreground', ui.sidebarTag && 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary')"
              :aria-label="ui.sidebarTag ? `Nach Schlagwort gefiltert: ${ui.sidebarTag}` : 'Nach Schlagwort filtern'"
              v-tooltip="ui.sidebarTag ? `Nur „${ui.sidebarTag}“` : 'Nach Schlagwort filtern'"
              @mousedown.prevent
            >
              <TagIcon class="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="max-h-80 w-52 overflow-y-auto">
            <DropdownMenuLabel>Nach Schlagwort filtern</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="ui.sidebarTag ?? ''" @update:model-value="pickTag">
              <DropdownMenuRadioItem value="">Alle Chats</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              <DropdownMenuRadioItem v-for="tag in tags" :key="tag" :value="tag">
                <span class="truncate">{{ tag }}</span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <!-- The filter in sight, so a short tree doesn't look like chats went missing. -->
      <div v-if="ui.sidebarTag" class="mt-1 flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <TagIcon class="size-3 shrink-0" />
        <span class="min-w-0 truncate">Nur „{{ ui.sidebarTag }}“</span>
        <button
          type="button"
          class="ml-auto flex size-5 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-accent hover:text-foreground"
          aria-label="Filter aufheben"
          v-tooltip="'Filter aufheben'"
          @click="ui.sidebarTag = null"
        >
          <XIcon class="size-3" />
        </button>
      </div>
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
