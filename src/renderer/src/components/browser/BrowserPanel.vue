<script setup lang="ts">
import { LoaderCircleIcon, PanelRightCloseIcon, PlusIcon, SparklesIcon, XIcon } from '@lucide/vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BLANK_PAGE, type BrowserTabInfo } from '@shared/browser'
import { PROVIDERS } from '@shared/providers'
import { separatorValue } from '@/lib/separator-keys'
import { cn } from '@/lib/utils'
import { MIN_PANEL_WIDTH, useBrowsersStore } from '@/stores/browsers'
import { useSessionsStore } from '@/stores/sessions'
import BrowserEmpty from './BrowserEmpty.vue'
import BrowserFavicon from './BrowserFavicon.vue'

/**
 * The chat's browser, right of the chat: its tabs, and the room for the page that is shown. The page
 * itself lies in BrowserLayer over this room (a `<webview>` can't move with the chat without loading
 * anew); the panel tells the layer where the room is. Open or closed per chat, its width for all;
 * its left edge drags it wider or narrower.
 */
const props = defineProps<{ sessionId: string }>()

const browsers = useBrowsersStore()
const sessions = useSessionsStore()

/** The chat keeps at least this much room (px). */
const MIN_CHAT_WIDTH = 360
const DEFAULT_WIDTH = 560

const open = computed(() => browsers.isOpen(props.sessionId))
const agent = computed(() => PROVIDERS[sessions.metas.find((m) => m.id === props.sessionId)?.provider ?? 'claude'].short)
const tabs = computed(() => browsers.tabsOf(props.sessionId))
const shown = computed(() => browsers.shownOf(props.sessionId))

const panel = ref<HTMLElement | null>(null)
const room = ref<HTMLElement | null>(null)
const strip = ref<HTMLElement | null>(null)

/** An agent acts in the tab right now, or did a moment ago. */
const agentIn = (id: string) => browsers.controls.get(id)?.active === true || browsers.controls.get(id)?.busy === true
const agentBusyIn = (id: string) => browsers.controls.get(id)?.busy === true
const loading = (id: string) => browsers.get(id)?.state.loading === true

function tooltipOf(tab: BrowserTabInfo): string {
  return tab.url && tab.url !== BLANK_PAGE ? `${tab.title}\n${tab.url}` : tab.title
}

// ── Where the page goes ──

function layer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="browser-layer"]')
}

/** The chat whose room this panel reported last: the panel stays when the chat switches. */
let reported: string | null = null

/** Tells the layer where this chat's page goes, relative to it; nowhere while the panel is closed. */
function measure() {
  const el = room.value
  const over = layer()
  if (!open.value || !el || !over) {
    const slot = browsers.slot
    if (slot && (slot.sessionId === props.sessionId || slot.sessionId === reported)) browsers.setSlot(null)
    reported = null
    return
  }
  reported = props.sessionId
  const a = el.getBoundingClientRect()
  const b = over.getBoundingClientRect()
  browsers.setSlot({
    sessionId: props.sessionId,
    left: Math.round(a.left - b.left),
    top: Math.round(a.top - b.top),
    width: Math.round(a.width),
    height: Math.round(a.height),
  })
}

useResizeObserver(room, measure)
let layerObserver: ResizeObserver | null = null
onMounted(() => {
  const over = layer()
  if (over) {
    layerObserver = new ResizeObserver(measure)
    layerObserver.observe(over)
  }
  measure()
})
onBeforeUnmount(() => {
  layerObserver?.disconnect()
  endResize?.()
  const slot = browsers.slot
  if (slot && (slot.sessionId === props.sessionId || slot.sessionId === reported)) browsers.setSlot(null)
})
watch([open, () => props.sessionId, () => browsers.width], () => void nextTick(measure), { flush: 'post' })

// ── Width ──

const resizing = ref(false)
let endResize: (() => void) | null = null

function maxWidth(): number {
  const container = panel.value?.parentElement?.getBoundingClientRect().width ?? window.innerWidth
  return Math.max(MIN_PANEL_WIDTH, container - MIN_CHAT_WIDTH)
}

/** The panel's edge moved with the keyboard, 16 px a step; it grows to the left. */
function onResizeKey(event: KeyboardEvent) {
  const width = separatorValue(event, true, {
    value: browsers.width,
    min: MIN_PANEL_WIDTH,
    max: maxWidth(),
    step: 16,
    initial: DEFAULT_WIDTH,
    reversed: true,
  })
  if (width === null) return
  event.preventDefault()
  browsers.setWidth(width)
  browsers.saveWidth()
}

function onResizeStart(event: PointerEvent) {
  if (event.button !== 0 || !panel.value) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const right = panel.value.getBoundingClientRect().right
  const max = maxWidth()
  resizing.value = true
  // The pages would take the pointer as it passes over them (main.css).
  document.documentElement.dataset.resizing = 'col'
  const move = (e: PointerEvent) => browsers.setWidth(Math.min(right - e.clientX, max))
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    resizing.value = false
    delete document.documentElement.dataset.resizing
    browsers.saveWidth()
    endResize = null
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  endResize = end
}

function resetWidth() {
  browsers.setWidth(Math.min(DEFAULT_WIDTH, maxWidth()))
  browsers.saveWidth()
}

// ── Tabs ──

function onTabMouseDown(event: MouseEvent, tab: BrowserTabInfo) {
  // Middle click closes like in browsers.
  if (event.button !== 1) return
  event.preventDefault()
  browsers.closeTab(tab.id)
}

// A vertical mouse wheel scrolls the tabs sideways; the shown one stays in view.
useEventListener(
  strip,
  'wheel',
  (event: WheelEvent) => {
    if (!strip.value || Math.abs(event.deltaY) < Math.abs(event.deltaX)) return
    strip.value.scrollLeft += event.deltaY
    event.preventDefault()
  },
  { passive: false },
)
watch(
  shown,
  (id) => {
    if (!id) return
    void nextTick(() => strip.value?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  },
  { immediate: true },
)

const iconButton =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50'
</script>

<template>
  <aside
    v-if="open"
    ref="panel"
    data-slot="browser-panel"
    aria-label="Browser"
    class="relative flex h-full max-w-[calc(100%-22.5rem)] shrink-0 flex-col border-l"
    :style="{ width: `${browsers.width}px`, minWidth: `${MIN_PANEL_WIDTH}px` }"
  >
    <!-- The panel's left edge: a line to drag its width by. -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite des Browsers ändern"
      tabindex="0"
      :aria-valuenow="Math.round(browsers.width)"
      :aria-valuemin="MIN_PANEL_WIDTH"
      class="group/handle absolute inset-y-0 -left-[5px] z-20 w-[9px] cursor-col-resize outline-none"
      @pointerdown="onResizeStart"
      @dblclick="resetWidth"
      @keydown="onResizeKey"
    >
      <div
        :class="
          cn(
            'absolute inset-y-0 left-[4px] w-px transition-colors group-hover/handle:bg-primary/60 group-focus-visible/handle:bg-primary',
            resizing && 'bg-primary/60',
          )
        "
      />
    </div>

    <!-- The tabs of the chat's browser, level with the chat's header. -->
    <div class="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-2">
      <div ref="strip" role="tablist" aria-label="Tabs des Browsers" class="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        <div
          v-for="tab in tabs"
          :key="tab.id"
          role="tab"
          :data-tab-id="tab.id"
          :aria-selected="tab.id === shown"
          :tabindex="tab.id === shown ? 0 : -1"
          v-tooltip.bottom="tooltipOf(tab)"
          :class="
            cn(
              'group/tab flex h-7 max-w-52 min-w-24 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-[3px] pl-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              tab.id === shown ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )
          "
          @click="browsers.showTab(sessionId, tab.id)"
          @keydown.enter.prevent="browsers.showTab(sessionId, tab.id)"
          @mousedown="onTabMouseDown($event, tab)"
        >
          <span class="flex size-3.5 shrink-0 items-center justify-center">
            <LoaderCircleIcon v-if="loading(tab.id)" role="status" aria-label="Seite lädt" class="size-3.5 animate-spin" />
            <BrowserFavicon v-else :tab-id="tab.id" class="size-3.5" />
          </span>
          <span class="min-w-0 flex-1 truncate">{{ tab.title }}</span>
          <SparklesIcon
            v-if="agentIn(tab.id)"
            :aria-label="`${agent} arbeitet hier`"
            :class="cn('size-3 shrink-0 text-primary', agentBusyIn(tab.id) && 'animate-pulse')"
          />
          <button
            type="button"
            aria-label="Tab schließen"
            v-tooltip="'Tab schließen (Strg+W)'"
            :class="
              cn(
                'flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-foreground/10 hover:text-foreground',
                tab.id === shown && 'opacity-100',
              )
            "
            @click.stop="browsers.closeTab(tab.id)"
          >
            <XIcon class="size-3" />
          </button>
        </div>
      </div>
      <button type="button" aria-label="Neuer Tab" v-tooltip.bottom="'Neuer Tab (Strg+T)'" :class="iconButton" @click="browsers.openTab(sessionId)">
        <PlusIcon class="size-4" />
      </button>
      <div class="min-w-2 flex-1" />
      <button
        type="button"
        aria-label="Browser ausblenden"
        v-tooltip.bottom="'Browser ausblenden'"
        :class="iconButton"
        @click="browsers.setOpen(sessionId, false)"
      >
        <PanelRightCloseIcon class="size-4" />
      </button>
    </div>

    <!-- The room for the page (BrowserLayer draws it here), or the start without a tab. -->
    <div ref="room" class="relative min-h-0 flex-1">
      <BrowserEmpty v-if="tabs.length === 0" :session-id="sessionId" :agent="agent" />
    </div>
  </aside>
</template>
