<script setup lang="ts">
import { BotIcon, CheckIcon, ChevronRightIcon, CircleStopIcon, XIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { AgentItem } from '@shared/chat'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'

/** A subagent: what it does right now, how many tools it used; a click shows its work in place of the chat. */
const props = defineProps<{ item: AgentItem }>()
const ui = useUiStore()
const now = useClock(1000)

const running = computed(() => props.item.status === 'running')
const elapsed = computed(() => (props.item.endedAt ?? (running.value ? now.value : props.item.startedAt)) - props.item.startedAt)
const selected = computed(() => ui.agentId === props.item.id)

function toggle(): void {
  ui.agentId = selected.value ? null : props.item.id
}
</script>

<template>
  <button
    type="button"
    :class="
      cn(
        'my-1.5 flex w-full min-w-0 items-center gap-3 rounded-xl border bg-card/60 px-3 py-2.5 text-left transition-colors hover:bg-card',
        selected && 'border-primary/60 ring-1 ring-primary/30',
      )
    "
    @click="toggle"
  >
    <span
      :class="
        cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary',
          running && 'pulse-ring',
          item.status === 'error' && 'bg-destructive/12 text-destructive',
        )
      "
    >
      <BotIcon class="size-4" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col">
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate text-[0.88rem] font-medium">{{ item.description || item.agentType }}</span>
        <span class="shrink-0 rounded bg-muted px-1.5 text-[0.7rem] text-muted-foreground">{{ item.agentType }}</span>
        <span v-if="item.background" class="shrink-0 rounded bg-muted px-1.5 text-[0.7rem] text-muted-foreground">Hintergrund</span>
      </span>
      <span :class="cn('truncate text-[0.78rem] text-muted-foreground', running && item.activity && 'text-shimmer')">
        {{ running ? item.activity || 'Startet …' : item.status === 'done' ? 'Fertig' : item.status === 'error' ? 'Fehlgeschlagen' : 'Gestoppt' }}
      </span>
    </span>
    <span class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
      <span v-if="item.toolCount">{{ item.toolCount }} {{ item.toolCount === 1 ? 'Werkzeug' : 'Werkzeuge' }}</span>
      <span>{{ formatDuration(Math.max(0, elapsed)) }}</span>
      <Spinner v-if="running" class="size-3.5" />
      <CheckIcon v-else-if="item.status === 'done'" class="size-3.5 text-(--tool-run)" />
      <XIcon v-else-if="item.status === 'error'" class="size-3.5 text-destructive" />
      <CircleStopIcon v-else class="size-3.5" />
      <ChevronRightIcon :class="cn('size-3.5 transition-transform', selected && 'rotate-180')" />
    </span>
  </button>
</template>
