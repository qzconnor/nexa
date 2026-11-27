<script setup lang="ts">
import { ChevronRightIcon, GlobeIcon, Maximize2Icon, MousePointerClickIcon, PanelRightOpenIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { BLANK_PAGE, type BrowserFrame } from '@shared/browser'
import type { ToolItem } from '@shared/chat'
import ToolRow from '@/components/chat/ToolRow.vue'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { formatDuration } from '@/lib/format'
import { browserAction, browserStep } from '@/lib/tools'
import { cn } from '@/lib/utils'
import { useBrowsersStore } from '@/stores/browsers'
import BrowserFavicon from './BrowserFavicon.vue'

/**
 * What an agent did in the chat's browser, in the chat like a diagram: a live picture of the page and
 * the steps. The picture only looks on; to use the page (a login, say) it opens in the browser panel
 * or over the whole chat; while it is open there, the card says so and its picture pauses. The newest
 * card is live; older ones keep the page as it was when they ended.
 */
const props = defineProps<{ tools: ToolItem[]; blockId: string; sessionId: string; live: boolean }>()
const browsers = useBrowsersStore()
const now = useClock(1000)
const showSteps = ref(false)

const tabId = computed(() => browsers.agentTab(props.sessionId))
const tab = computed(() => browsers.tab(tabId.value))
const running = computed(() => props.tools.some((t) => t.status === 'running' || t.status === 'pending'))
const acting = computed(() => props.live && (running.value || (!!tabId.value && browsers.controls.get(tabId.value)?.busy === true)))
const failed = computed(() => props.tools.filter((t) => t.status === 'error').length)

/** What the agent does right now, in words of the browser's log („Klickt auf „Anmelden““). */
const activity = computed(() => {
  if (!acting.value || !tabId.value) return null
  const log = browsers.logs.get(tabId.value)
  const last = log?.[log.length - 1]
  return last?.status === 'running' ? last.label : null
})

/** The user has the page open to use it (panel or full screen): the picture pauses meanwhile. */
const inUse = computed(() => props.live && !!tabId.value && browsers.visibleTab === tabId.value)

// The live card watches its tab's page; every card keeps the last picture it got. While the page is
// open, the card shows the picture from before and takes the new ones only for when it is closed again.
watch(
  () => (props.live ? tabId.value : null),
  (id, _before, onCleanup) => {
    if (id) onCleanup(browsers.watchFrames(id))
  },
  { immediate: true },
)
const liveFrame = computed(() => (props.live && tabId.value ? browsers.frames.get(tabId.value) : undefined))
watch(
  liveFrame,
  (frame) => {
    if (frame) browsers.stills.set(props.blockId, frame)
  },
  { immediate: true },
)
const latest = computed(() => liveFrame.value ?? browsers.stills.get(props.blockId))
const paused = ref<BrowserFrame | null>(null)
watch(
  inUse,
  (open) => {
    paused.value = open ? (latest.value ?? null) : null
  },
  { immediate: true },
)
const frame = computed(() => (inUse.value ? (paused.value ?? undefined) : latest.value))
/** The page's own proportions: a phone's stay upright, a desktop's wide. */
const ratio = computed(() => {
  const shown = frame.value ?? latest.value
  return shown && shown.height > 0 ? shown.width / shown.height : 16 / 10
})
/** The preview's size: a picture's, and the same while the page is open elsewhere, picture or not. */
const sized = computed(() => !!frame.value || inUse.value)
/**
 * As wide as the page's proportions allow at the picture's highest, between a width the caption and the
 * steps still fit in and one that leaves the chat its column. A phone (down to 9 : 20) fits whole; a
 * page narrower still keeps the picture's height and shows its top.
 */
const PICTURE_MAX_HEIGHT = '34rem'
const cardWidth = computed(() => `min(100%, max(15rem, min(38rem, calc(${PICTURE_MAX_HEIGHT} * ${ratio.value.toFixed(4)}))))`)

const address = computed(() => {
  const url = tab.value?.url
  if (!url || url === BLANK_PAGE) return ''
  try {
    const parsed = new URL(url)
    return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname)
  } catch {
    return url
  }
})
const duration = computed(() => {
  const first = props.tools[0]
  if (!first) return ''
  const end = running.value ? now.value : Math.max(...props.tools.map((t) => t.endedAt ?? t.startedAt))
  return formatDuration(Math.max(0, end - first.startedAt))
})
/** Its browser steps in words of their own; others (Claude loading a browser tool) as they are. */
const steps = computed(() => props.tools.map((t): ToolItem => (browserAction(t) ? { ...t, ...browserStep(t), tool: 'web' } : t)))

function openPanel(): void {
  browsers.openInPanel(props.sessionId, tab.value ? tab.value.id : null)
}

function openFullscreen(): void {
  browsers.openFullscreen(props.sessionId, tab.value ? tab.value.id : null)
}

/** Back to watching: the panel or the full screen closes, the picture goes on. */
function closeUse(): void {
  browsers.closeFullscreen()
  browsers.setOpen(props.sessionId, false)
}
</script>

<template>
  <!-- Only as wide as the page's picture, flush with the chat's right edge. -->
  <figure class="my-2 ml-auto overflow-hidden rounded-xl border bg-card/60" :style="{ width: cardWidth }">
    <figcaption class="flex h-10 items-center gap-2 border-b pr-1.5 pl-3">
      <span class="flex size-4 shrink-0 items-center justify-center">
        <BrowserFavicon v-if="tab" :tab-id="tab.id" class="size-4" />
        <GlobeIcon v-else class="size-4 text-muted-foreground" />
      </span>
      <span class="min-w-0 truncate text-[0.86rem] font-medium">{{ tab?.title || 'Browser' }}</span>
      <span v-if="address" class="min-w-0 truncate font-mono text-[0.74rem] text-muted-foreground" :title="tab?.url">{{ address }}</span>
      <div v-if="tab" class="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="In der Seitenleiste öffnen"
          v-tooltip="'In der Seitenleiste öffnen und bedienen'"
          @click="openPanel"
        >
          <PanelRightOpenIcon class="size-4" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Im Vollbild öffnen"
          v-tooltip="'Im Vollbild öffnen und bedienen'"
          @click="openFullscreen"
        >
          <Maximize2Icon class="size-4" />
        </button>
      </div>
    </figcaption>

    <!-- The picture only looks on: a click opens the page beside the chat, to use it there. -->
    <div
      :class="cn('group/frame relative w-full overflow-hidden bg-background/40', !sized && 'h-32')"
      :style="sized ? { aspectRatio: ratio, maxHeight: PICTURE_MAX_HEIGHT } : undefined"
    >
      <img
        v-if="frame"
        :src="frame.url"
        alt=""
        draggable="false"
        :class="cn('size-full object-cover object-top transition select-none', inUse && 'opacity-35 blur-[2px] grayscale')"
      />
      <span v-else-if="!inUse" class="flex size-full flex-col items-center justify-center gap-2 text-[0.82rem] text-muted-foreground">
        <GlobeIcon class="size-6 opacity-60" />
        <template v-if="!tab">Der Tab ist geschlossen.</template>
        <template v-else-if="acting">Die Seite lädt …</template>
        <template v-else>Klicken, um die Seite anzusehen</template>
      </span>

      <!-- Open beside the chat: the picture pauses until the user is through with it. -->
      <div v-if="inUse" class="absolute inset-0 flex items-center justify-center p-3">
        <div class="flex flex-col items-center gap-1.5 rounded-xl border bg-popover/90 px-4 py-3.5 text-center text-balance shadow-lg backdrop-blur-md">
          <span class="flex items-center gap-2 text-[0.88rem] font-medium">
            <MousePointerClickIcon class="size-4 text-primary" />
            Wird gerade bedient
          </span>
          <span class="text-[0.76rem] text-muted-foreground">
            {{ browsers.fullscreen === sessionId ? 'Im Vollbild' : 'In der Seitenleiste' }} geöffnet, die Vorschau ist pausiert
          </span>
          <button
            type="button"
            class="mt-1.5 rounded-md border px-2.5 py-1 text-[0.76rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="closeUse"
          >
            Schließen und weiter zusehen
          </button>
        </div>
      </div>
      <template v-else-if="tab">
        <button
          type="button"
          class="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 outline-none transition group-hover/frame:bg-black/25 group-hover/frame:opacity-100 focus-visible:bg-black/25 focus-visible:opacity-100"
          :aria-label="`${tab?.title || 'Seite'} zum Bedienen öffnen`"
          @click="openPanel"
        >
          <span class="flex items-center gap-1.5 rounded-full bg-popover/90 px-3 py-1.5 text-[0.8rem] font-medium shadow-md">
            <PanelRightOpenIcon class="size-3.5" /> Zum Bedienen öffnen
          </span>
        </button>
        <!-- What the agent does, over the page while it acts. -->
        <span
          v-if="acting"
          class="pointer-events-none absolute top-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full border bg-popover/85 px-2.5 py-1 text-[0.74rem] shadow-sm backdrop-blur-md"
        >
          <span class="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          <span class="shrink-0 font-medium">Live</span>
          <span v-if="activity" class="min-w-0 truncate text-muted-foreground">{{ activity }}</span>
        </span>
      </template>
    </div>

    <button
      type="button"
      class="flex h-8 w-full items-center gap-2 border-t px-3 text-left text-[0.78rem] text-muted-foreground transition-colors hover:bg-muted/40"
      :aria-expanded="showSteps"
      @click="showSteps = !showSteps"
    >
      <ChevronRightIcon :class="cn('size-3.5 transition-transform', showSteps && 'rotate-90')" />
      <span>{{ tools.length }} {{ tools.length === 1 ? 'Schritt' : 'Schritte' }}</span>
      <span v-if="failed" class="min-w-0 truncate text-destructive">· {{ failed }} fehlgeschlagen</span>
      <span v-if="!showSteps && running" class="min-w-0 truncate">· {{ steps[steps.length - 1]?.title }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
        {{ duration }}
        <Spinner v-if="running" class="size-3.5" />
      </span>
    </button>
    <div v-if="showSteps" class="flex flex-col border-t px-1 py-1">
      <ToolRow v-for="step in steps" :key="step.id" :tool="step" />
    </div>
  </figure>
</template>
