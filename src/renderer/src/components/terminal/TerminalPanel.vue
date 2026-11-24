<script setup lang="ts">
import { PanelRightCloseIcon, PlusIcon, TerminalIcon, XIcon } from '@lucide/vue'
import { useEventListener } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { TerminalInfo } from '@shared/terminals'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useProjectPath } from '@/composables/useProjectPath'
import { separatorValue } from '@/lib/separator-keys'
import { cn } from '@/lib/utils'
import { DEFAULT_TERMINAL_WIDTH, MIN_TERMINAL_WIDTH, useTerminalsStore } from '@/stores/terminals'
import TerminalView from './TerminalView.vue'

/**
 * The user's terminals beside the chat, right of it: a tab for each shell, the shown one below. Open
 * or closed per chat, one width for all; the left edge drags it wider or narrower. Closing the panel
 * leaves the shells running, the cross on a tab ends one.
 */
const props = defineProps<{ sessionId: string }>()
const terminals = useTerminalsStore()
const { shorten } = useProjectPath()

/** The chat keeps at least this much room (px). */
const MIN_CHAT_WIDTH = 360

const open = computed(() => terminals.isOpen(props.sessionId))
const tabs = computed(() => terminals.terminalsOf(props.sessionId))
const shown = computed(() => terminals.shownOf(props.sessionId))
const creating = computed(() => terminals.isCreating(props.sessionId))

/** „PowerShell 7“, and with more of the same shell „PowerShell 7 (2)“ … */
function label(t: TerminalInfo): string {
  const same = tabs.value.filter((other) => other.shell === t.shell)
  return same.length > 1 ? `${t.shell} (${same.indexOf(t) + 1})` : t.shell
}

function tooltipOf(t: TerminalInfo): string {
  const parts = [label(t), shorten(t.cwd) || t.cwd]
  if (t.account) parts.push(`Account „${t.account}“`)
  if (t.status === 'exited') parts.push(`beendet${t.exitCode === null ? '' : ` mit Code ${t.exitCode}`}`)
  return parts.join('\n')
}

function onTabMouseDown(event: MouseEvent, t: TerminalInfo): void {
  // Middle click ends it, as tabs close in browsers.
  if (event.button !== 1) return
  event.preventDefault()
  terminals.kill(t.id)
}

const strip = ref<HTMLElement | null>(null)
watch(
  () => shown.value?.id,
  (id) => {
    if (id) void nextTick(() => strip.value?.querySelector<HTMLElement>(`[data-terminal-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
  },
)

// ── Width ──

const panel = ref<HTMLElement | null>(null)
const resizing = ref(false)
let endResize: (() => void) | null = null

function maxWidth(): number {
  const container = panel.value?.parentElement?.getBoundingClientRect().width ?? window.innerWidth
  return Math.max(MIN_TERMINAL_WIDTH, container - MIN_CHAT_WIDTH)
}

/** The edge moved with the keyboard, 16 px a step; the panel grows to the left. */
function onResizeKey(event: KeyboardEvent): void {
  const width = separatorValue(event, true, {
    value: terminals.width,
    min: MIN_TERMINAL_WIDTH,
    max: maxWidth(),
    step: 16,
    initial: DEFAULT_TERMINAL_WIDTH,
    reversed: true,
  })
  if (width === null) return
  event.preventDefault()
  terminals.setWidth(width)
  terminals.saveWidth()
}

function onResizeStart(event: PointerEvent): void {
  if (event.button !== 0 || !panel.value) return
  event.preventDefault()
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const right = panel.value.getBoundingClientRect().right
  const max = maxWidth()
  resizing.value = true
  // The browser's pages would take the pointer as it passes over them (main.css).
  document.documentElement.dataset.resizing = 'col'
  const move = (e: PointerEvent) => terminals.setWidth(Math.min(right - e.clientX, max))
  const end = () => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
    resizing.value = false
    delete document.documentElement.dataset.resizing
    terminals.saveWidth()
    endResize = null
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  endResize = end
}

function resetWidth(): void {
  terminals.setWidth(Math.min(DEFAULT_TERMINAL_WIDTH, maxWidth()))
  terminals.saveWidth()
}

onBeforeUnmount(() => endResize?.())

// A vertical mouse wheel scrolls the tabs sideways.
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

const iconButton =
  'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50'
</script>

<template>
  <aside
    v-if="open"
    ref="panel"
    aria-label="Terminal"
    class="relative flex h-full max-w-[calc(100%-22.5rem)] shrink-0 flex-col border-l"
    :style="{ width: `${terminals.width}px`, minWidth: `${MIN_TERMINAL_WIDTH}px` }"
  >
    <!-- The panel's left edge: a line to drag its width by. -->
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite des Terminals ändern"
      tabindex="0"
      :aria-valuenow="Math.round(terminals.width)"
      :aria-valuemin="MIN_TERMINAL_WIDTH"
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

    <!-- A tab for each shell of the chat, level with the chat's header. -->
    <div class="flex h-11 shrink-0 items-center gap-1 border-b pr-1.5 pl-2">
      <div ref="strip" role="tablist" aria-label="Terminals" class="flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
        <div
          v-for="t in tabs"
          :key="t.id"
          role="tab"
          :data-terminal-id="t.id"
          :aria-selected="t.id === shown?.id"
          :tabindex="t.id === shown?.id ? 0 : -1"
          v-tooltip.bottom="tooltipOf(t)"
          :class="
            cn(
              'group/tab flex h-7 max-w-52 min-w-24 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-[3px] pl-2 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              t.id === shown?.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )
          "
          @click="terminals.show(sessionId, t.id)"
          @keydown.enter.prevent="terminals.show(sessionId, t.id)"
          @mousedown="onTabMouseDown($event, t)"
        >
          <TerminalIcon :class="cn('size-3.5 shrink-0', t.status === 'exited' ? 'text-destructive' : 'text-(--tool-run)')" />
          <span :class="cn('min-w-0 flex-1 truncate', t.status === 'exited' && 'line-through decoration-muted-foreground/60')">{{ label(t) }}</span>
          <button
            type="button"
            aria-label="Terminal beenden"
            v-tooltip="'Terminal beenden'"
            :class="
              cn(
                'flex size-5 shrink-0 items-center justify-center rounded-[5px] text-muted-foreground opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-foreground/10 hover:text-foreground',
                t.id === shown?.id && 'opacity-100',
              )
            "
            @click.stop="terminals.kill(t.id)"
          >
            <XIcon class="size-3" />
          </button>
        </div>
      </div>
      <button
        type="button"
        aria-label="Neues Terminal"
        v-tooltip.bottom="'Neues Terminal'"
        :class="iconButton"
        :disabled="creating"
        @click="terminals.create(sessionId)"
      >
        <Spinner v-if="creating" class="size-3.5" />
        <PlusIcon v-else class="size-4" />
      </button>
      <div class="min-w-2 flex-1" />
      <button
        type="button"
        aria-label="Terminal ausblenden"
        v-tooltip.bottom="'Terminal ausblenden (Strg+Ö); die Shells laufen weiter'"
        :class="iconButton"
        @click="terminals.setOpen(sessionId, false)"
      >
        <PanelRightCloseIcon class="size-4" />
      </button>
    </div>

    <!-- The shown terminal, on the code background of the theme as code blocks are. -->
    <div class="relative min-h-0 flex-1 bg-(--code-bg) py-2 pl-3 pr-1">
      <TerminalView v-if="shown" :key="shown.id" :terminal="shown" />
      <div v-else class="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <template v-if="creating"><Spinner class="size-4" /> Terminal startet …</template>
        <template v-else>
          <span>Kein Terminal offen.</span>
          <Button variant="outline" size="sm" @click="terminals.create(sessionId)"><PlusIcon /> Neues Terminal</Button>
        </template>
      </div>
    </div>
  </aside>
</template>
