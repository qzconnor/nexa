<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, CircleStopIcon, SquareTerminalIcon, XIcon } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import type { ShellStatus, ToolItem } from '@shared/chat'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { formatDuration } from '@/lib/format'
import { shellCommand, shellEnd, shellPurpose, shellStatus } from '@/lib/shells'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'

/**
 * The shells at work in the background, floating frosted above the composer as the agents do (in a
 * `.frost-backing` wrapper), and beside them when both are there. One line each: what it is for, its
 * command and how long it runs. A row opens its output at the side (ShellPanel).
 */
const props = defineProps<{ shells: ToolItem[] }>()
const ui = useUiStore()
const now = useClock(1000)

const root = ref<HTMLElement | null>(null)
const { width } = useElementSize(root)
/** Beside the agents: room for what a shell is for or its command, not both. */
const narrow = computed(() => width.value > 0 && width.value < 300)

/** Fewer than the agents: a shell says little more than its command, the panel has the rest. */
const MAX_ROWS = 3

const running = computed(() => props.shells.filter((s) => shellStatus(s) === 'running'))
const finished = computed(() => props.shells.length - running.value.length)
/** In the order they started; with too many, the running ones first. */
const rows = computed(() => {
  if (props.shells.length <= MAX_ROWS) return props.shells
  return [...running.value, ...props.shells.filter((s) => shellStatus(s) !== 'running')].slice(0, MAX_ROWS)
})
const more = computed(() => props.shells.length - rows.value.length)

const STATE: Record<ShellStatus, string> = { running: 'läuft', done: 'beendet', error: 'fehlgeschlagen', stopped: 'abgebrochen' }
const elapsed = (s: ToolItem) => formatDuration(Math.max(0, (shellEnd(s) ?? now.value) - s.startedAt))

function open(shell: ToolItem): void {
  ui.shellId = ui.shellId === shell.id ? null : shell.id
}

function openAll(): void {
  ui.shellId = (running.value[0] ?? props.shells[0])?.id ?? null
}
</script>

<template>
  <div ref="root" class="flex flex-col rounded-xl border bg-card/50 p-1.5 shadow-sm backdrop-blur-lg">
    <div class="flex h-7 items-center gap-2 pr-0.5 pl-2 text-[0.8rem]">
      <SquareTerminalIcon class="size-3.5 shrink-0 text-(--tool-run)" />
      <span class="font-medium">Shells</span>
      <span class="shrink-0 text-muted-foreground tabular-nums">
        {{ running.length }} aktiv<template v-if="finished && !narrow"> · {{ finished }} beendet</template>
      </span>
      <!-- Folded, the one that runs still says which it is. -->
      <span v-if="ui.shellDockFolded && running[0]" class="min-w-0 flex-1 truncate font-mono text-[0.74rem] text-muted-foreground">
        {{ shellCommand(running[0]) }}
      </span>
      <button
        type="button"
        :class="
          cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
            !ui.shellDockFolded || !running[0] ? 'ml-auto' : '',
          )
        "
        :aria-label="ui.shellDockFolded ? 'Shells ausklappen' : 'Shells einklappen'"
        :aria-expanded="!ui.shellDockFolded"
        @click="ui.shellDockFolded = !ui.shellDockFolded"
      >
        <ChevronDownIcon :class="cn('size-3.5 transition-transform', ui.shellDockFolded && 'rotate-180')" />
      </button>
    </div>
    <div v-if="!ui.shellDockFolded" class="flex flex-col">
      <button
        v-for="s in rows"
        :key="s.id"
        type="button"
        :class="cn('flex h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-muted/60', ui.shellId === s.id && 'bg-muted/70')"
        :aria-label="`${shellPurpose(s) ?? shellCommand(s)}: ${STATE[shellStatus(s)]}`"
        v-tooltip="narrow && shellPurpose(s) ? shellCommand(s) : ''"
        @click="open(s)"
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <Spinner v-if="shellStatus(s) === 'running'" class="size-3.5 text-(--tool-run)" />
          <CheckIcon v-else-if="shellStatus(s) === 'done'" class="size-3.5 text-success" />
          <XIcon v-else-if="shellStatus(s) === 'error'" class="size-3.5 text-destructive" />
          <CircleStopIcon v-else class="size-3.5 text-muted-foreground" />
        </span>
        <!-- Narrow, one of the two: what it is for, else the command. -->
        <span
          v-if="shellPurpose(s)"
          :class="
            cn(
              'truncate text-[0.8rem] font-medium',
              narrow ? 'min-w-0 flex-1' : 'max-w-[40%] shrink-0',
              shellStatus(s) !== 'running' && 'text-muted-foreground',
            )
          "
        >
          {{ shellPurpose(s) }}
        </span>
        <span
          v-if="!narrow || !shellPurpose(s)"
          :class="
            cn(
              'min-w-0 flex-1 truncate font-mono text-[0.74rem]',
              (shellPurpose(s) || shellStatus(s) !== 'running') && 'text-muted-foreground',
            )
          "
        >
          {{ shellCommand(s) }}
        </span>
        <span :class="cn('shrink-0 text-[0.72rem] text-muted-foreground tabular-nums', shellStatus(s) === 'error' && 'text-destructive')">
          <template v-if="!narrow && shellStatus(s) !== 'running'">{{ STATE[shellStatus(s)] }} · </template>{{ elapsed(s) }}
        </span>
      </button>
      <button
        v-if="more"
        type="button"
        class="flex h-7 items-center rounded-lg px-2 text-left text-[0.78rem] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        @click="openAll"
      >
        + {{ more }} weitere
      </button>
    </div>
  </div>
</template>
