<script setup lang="ts">
import { ChevronRightIcon, PinIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { SessionMeta } from '@shared/types'
import { chatKey, movePinned, orderPinned, pinnedChats } from '@/lib/session-tree'
import { cn } from '@/lib/utils'
import { useDevicesStore } from '@/stores/devices'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import DeviceScope from './DeviceScope.vue'
import SidebarSession from './SidebarSession.vue'

/**
 * The pinned chats on top of the sidebar, above the separators, as in the Claude Manager: those of this
 * device and of every other one shown below (Remote Control) in one list, in the order the user dragged
 * them into; one pinned since comes on top. They stay in their projects too: here each row names its
 * project, and another device's chat its device. Each row works on its device's stores (`DeviceScope`).
 */
defineProps<{ now: number }>()
const ui = useUiStore()
const devices = useDevicesStore()

interface PinnedRow {
  key: string
  /** null: this device's. */
  device: string | null
  deviceName?: string
  meta: SessionMeta
  place?: string
}

/** This device, and every other one whose chats are loaded here. */
const sources = computed(() => [
  { id: null, name: undefined },
  ...devices.devices.filter((d) => d.state === 'ready').map((d) => ({ id: d.id, name: d.name })),
])

const rows = computed<PinnedRow[]>(() => {
  const all = sources.value.flatMap(({ id, name }) => {
    const projects = useProjectsStore(id)
    const chats = pinnedChats(useSessionsStore(id).metas, new Set(projects.projects.map((p) => p.id)))
    return chats.map((meta): PinnedRow => ({ key: chatKey(id, meta.id), device: id, deviceName: name, meta, place: projects.get(meta.projectId)?.name }))
  })
  return orderPinned(all, ui.pinnedOrder)
})

// Drag and drop ------------------------------------------------------------------------------
// A pinned chat moves among the pinned, of whichever device; the line shows where. Into a project it
// moves from its row there: this list belongs to no device's tree.

const list = ref<HTMLElement | null>(null)
const dragging = ref<string | null>(null)
/** The row the dragged chat would go before, null after the last; undefined: it would stay where it is. */
const before = ref<string | null | undefined>(undefined)

function startDrag(event: DragEvent, key: string): void {
  if (!event.dataTransfer) return
  dragging.value = key
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', key)
}

function endDrag(): void {
  dragging.value = null
  before.value = undefined
}

/** Over a row: before it in its upper half, else after it. */
function over(event: DragEvent, index: number): void {
  if (!dragging.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const upper = event.clientY < rect.top + rect.height / 2
  const next = upper ? rows.value[index]!.key : (rows.value[index + 1]?.key ?? null)
  const from = rows.value.findIndex((r) => r.key === dragging.value)
  const behind = rows.value[from + 1]?.key ?? null
  before.value = next === dragging.value || next === behind ? undefined : next
}

function leave(event: DragEvent): void {
  if (!list.value?.contains(event.relatedTarget as Node | null)) before.value = undefined
}

function drop(event: DragEvent): void {
  event.preventDefault()
  const moved = dragging.value
  const target = before.value
  endDrag()
  if (!moved || target === undefined) return
  // Chats of a device loaded here that no longer show (deleted, let go) leave the order; those of one not loaded stay.
  const loaded = sources.value.map((s) => `${s.id ?? ''}:`)
  const keep = (key: string) => !loaded.some((prefix) => key.startsWith(prefix))
  const shown = rows.value.map((r) => r.key)
  ui.arrangePinned(movePinned(ui.pinnedOrder, shown, moved, target, keep))
}
</script>

<template>
  <section v-if="rows.length" data-list-group class="pb-1">
    <!-- Looks like a separator's heading, so the sidebar reads as one list. -->
    <div class="group/pinned flex items-center gap-1 rounded-lg pt-2.5 pr-1 pb-1 pl-2">
      <button
        type="button"
        data-list-row
        :aria-expanded="ui.pinnedOpen"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        @click="ui.pinnedOpen = !ui.pinnedOpen"
      >
        <PinIcon class="size-3 shrink-0 text-muted-foreground" />
        <span class="truncate text-[0.72rem] font-medium tracking-wide text-muted-foreground uppercase">Angeheftet</span>
        <ChevronRightIcon
          :class="
            cn('size-3 shrink-0 text-muted-foreground transition-[transform,opacity]', ui.pinnedOpen && 'rotate-90 opacity-0 group-hover/pinned:opacity-100')
          "
        />
      </button>
      <span class="mr-1.5 text-[0.7rem] text-muted-foreground/70 tabular-nums">{{ rows.length }}</span>
    </div>
    <div v-if="ui.pinnedOpen" ref="list" class="flex flex-col gap-px" @dragleave="leave" @drop="drop">
      <div
        v-for="(row, i) in rows"
        :key="row.key"
        :class="cn('relative flex flex-col', dragging === row.key && 'opacity-50')"
        @dragstart="startDrag($event, row.key)"
        @dragend="endDrag"
        @dragover="over($event, i)"
      >
        <div v-if="before === row.key" class="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" />
        <DeviceScope :device="row.device">
          <SidebarSession :meta="row.meta" :now="now" :place="row.place" :device-name="row.deviceName" sortable />
        </DeviceScope>
        <div v-if="before === null && i === rows.length - 1" class="pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" />
      </div>
    </div>
  </section>
</template>
