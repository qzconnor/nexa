<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, CircleStopIcon, SquareTerminalIcon, XIcon } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import type { ChatItem, ShellStatus, ToolItem } from '@shared/chat'
import { startCommandLabel } from '@shared/start-commands'
import type { StartCommand } from '@shared/types'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { formatDuration } from '@/lib/format'
import { dockRows, shellCommand, shellEnd, shellPurpose, shellStatus, startCommandOf, startShellId } from '@/lib/shells'
import { cn } from '@/lib/utils'
import { useStartCommandsStore } from '@/stores/start-commands'
import { useUiStore } from '@/stores/ui'
import ShellDetail from './ShellDetail.vue'
import StartCommandDetail from './StartCommandDetail.vue'

/**
 * The shells at work in the background, floating frosted above the composer as the agents do (in a
 * `.frost-backing` wrapper), and beside them when both are there. One line each, one below the other:
 * what it is for, its command and how long it runs. A click unfolds a line downwards with the shell's
 * command, state and output; only one is open at a time, and another click or Esc folds it again.
 * A shell opened from its row in the chat, or a start command from the header, joins the lines open.
 */
const props = defineProps<{ shells: ToolItem[]; items: ChatItem[]; sessionId: string; projectId?: string | null }>()
const ui = useUiStore()
const startCommands = useStartCommandsStore()
const now = useClock(1000)

const root = ref<HTMLElement | null>(null)
const { width } = useElementSize(root)
/** Beside the agents: room for what a shell is for or its command, not both. */
const narrow = computed(() => width.value > 0 && width.value < 300)

/** Fewer than the agents: a shell says little more than its command, unfolded it says the rest. */
const MAX_ROWS = 3
const showAll = ref(false)

const STATE: Record<ShellStatus, string> = { running: 'läuft', done: 'beendet', error: 'fehlgeschlagen', stopped: 'abgebrochen' }

/** A start command of the project, open from the header, as a line above the chat's shells. */
const start = computed<StartCommand | undefined>(() => {
  const id = startCommandOf(ui.shellId)
  return id ? startCommands.commandsOf(props.projectId).find((c) => c.id === id) : undefined
})
const startRun = computed(() => (start.value ? startCommands.runOf(props.projectId, start.value.id) : undefined))
const startStatus = computed<ShellStatus | null>(() => startRun.value?.status ?? null)

const list = computed(() => dockRows(props.items, props.shells, ui.shellId))
const running = computed(() => list.value.filter((s) => shellStatus(s) === 'running'))
const activeCount = computed(() => running.value.length + (startStatus.value === 'running' ? 1 : 0))
const finished = computed(() => list.value.length + (start.value ? 1 : 0) - activeCount.value)
/** In the order they started; with too many, the running ones first and the open one in any case. */
const rows = computed(() => {
  if (showAll.value || list.value.length <= MAX_ROWS) return list.value
  const first = (s: ToolItem) => shellStatus(s) === 'running' || s.id === ui.shellId
  return [...list.value.filter(first), ...list.value.filter((s) => !first(s))].slice(0, Math.max(MAX_ROWS, list.value.filter(first).length))
})
const more = computed(() => list.value.length - rows.value.length)

/** Open, the lines show whatever the fold said. */
const folded = computed(() => ui.shellDockFolded && !ui.shellId)

const elapsed = (s: ToolItem) => formatDuration(Math.max(0, (shellEnd(s) ?? now.value) - s.startedAt))
const startElapsed = computed(() => (startRun.value ? formatDuration(Math.max(0, (startRun.value.endedAt ?? now.value) - startRun.value.startedAt)) : ''))

/** Unfolds the line, or folds it when it is the open one; one at a time. */
function toggle(id: string): void {
  ui.shellId = ui.shellId === id ? null : id
}

function toggleFold(): void {
  ui.shellId = null
  ui.shellDockFolded = !folded.value
}

const row = 'flex h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-muted/60'
const chevron = 'size-3.5 shrink-0 text-muted-foreground transition-transform duration-150'
const body = 'mt-0.5 mb-1.5 ml-[1.375rem] mr-1 animate-in duration-200 fade-in-0 slide-in-from-top-1'
</script>

<template>
  <div ref="root" class="flex flex-col rounded-xl border bg-card/50 p-1.5 shadow-sm backdrop-blur-lg">
    <div class="flex h-7 items-center gap-2 pr-0.5 pl-2 text-[0.8rem]">
      <SquareTerminalIcon class="size-3.5 shrink-0 text-(--tool-run)" />
      <span class="font-medium">Shells</span>
      <span class="shrink-0 text-muted-foreground tabular-nums">
        {{ activeCount }} aktiv<template v-if="finished && !narrow"> · {{ finished }} beendet</template>
      </span>
      <!-- Folded, the one that runs still says which it is. -->
      <span v-if="folded && running[0]" class="min-w-0 flex-1 truncate font-mono text-[0.74rem] text-muted-foreground">
        {{ shellCommand(running[0]) }}
      </span>
      <button
        type="button"
        :class="
          cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
            !folded || !running[0] ? 'ml-auto' : '',
          )
        "
        :aria-label="folded ? 'Shells ausklappen' : 'Shells einklappen'"
        :aria-expanded="!folded"
        @click="toggleFold"
      >
        <ChevronDownIcon :class="cn('size-3.5 transition-transform', folded && 'rotate-180')" />
      </button>
    </div>

    <div v-if="!folded" class="flex flex-col">
      <!-- A start command opened from the header. -->
      <template v-if="start && projectId">
        <button
          type="button"
          :class="cn(row, 'bg-muted/50')"
          :aria-label="`${startCommandLabel(start)}: ${startStatus ? STATE[startStatus] : 'läuft nicht'}`"
          aria-expanded="true"
          @click="toggle(startShellId(start.id))"
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <Spinner v-if="startStatus === 'running'" class="size-3.5 text-(--tool-run)" />
            <CheckIcon v-else-if="startStatus === 'done'" class="size-3.5 text-success" />
            <XIcon v-else-if="startStatus === 'error'" class="size-3.5 text-destructive" />
            <CircleStopIcon v-else class="size-3.5 text-muted-foreground" />
          </span>
          <span class="max-w-[40%] shrink-0 truncate text-[0.8rem] font-medium">{{ startCommandLabel(start) }}</span>
          <span class="min-w-0 flex-1 truncate font-mono text-[0.74rem] text-muted-foreground">{{ startRun?.command ?? start.command }}</span>
          <span class="shrink-0 text-[0.72rem] text-muted-foreground tabular-nums">{{ startElapsed }}</span>
          <ChevronRightIcon :class="cn(chevron, 'rotate-90')" />
        </button>
        <div :class="body">
          <StartCommandDetail :key="start.id" :project-id="projectId" :command="start" />
        </div>
      </template>

      <template v-for="s in rows" :key="s.id">
        <button
          type="button"
          :class="cn(row, 'group/row', ui.shellId === s.id && 'bg-muted/50')"
          :aria-label="`${shellPurpose(s) ?? shellCommand(s)}: ${STATE[shellStatus(s)]}`"
          :aria-expanded="ui.shellId === s.id"
          v-tooltip="narrow && shellPurpose(s) ? shellCommand(s) : ''"
          @click="toggle(s.id)"
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
                shellStatus(s) !== 'running' && ui.shellId !== s.id && 'text-muted-foreground',
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
          <ChevronRightIcon
            :class="cn(chevron, ui.shellId === s.id ? 'rotate-90' : 'opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100')"
          />
        </button>
        <div v-if="ui.shellId === s.id" :class="body">
          <ShellDetail :key="s.id" :shell="s" :items="items" :session-id="sessionId" />
        </div>
      </template>

      <button
        v-if="more || (showAll && list.length > MAX_ROWS)"
        type="button"
        class="flex h-7 items-center rounded-lg px-2 text-left text-[0.78rem] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Weniger zeigen' : `+ ${more} weitere` }}
      </button>
      <p v-if="ui.shellId && !start && !list.some((s) => s.id === ui.shellId)" class="px-2 py-3 text-[0.8rem] text-muted-foreground">
        Die Shell gibt es in diesem Chat nicht mehr.
      </p>
    </div>
  </div>
</template>
