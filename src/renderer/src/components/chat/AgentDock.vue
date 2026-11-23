<script setup lang="ts">
import { ArrowLeftIcon, BotIcon, CheckIcon, ChevronDownIcon, CircleStopIcon, XIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { AgentItem } from '@shared/chat'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'

/**
 * The subagents at work, floating frosted over the chat above the composer (in a `.frost-backing`
 * wrapper): what each one does right now. It switches the chat between the main thread and an
 * agent's work, as the CLI's agent list does: a row shows the agent's, „Hauptchat“ the main one.
 */
const props = defineProps<{ agents: AgentItem[] }>()
const ui = useUiStore()
const now = useClock(1000)
const folded = ref(false)

/** More rows would cover too much of the chat; the rest on request. */
const MAX_ROWS = 4
const showAll = ref(false)

const running = computed(() => props.agents.filter((a) => a.status === 'running'))
const finished = computed(() => props.agents.length - running.value.length)
/** In the order they started; with too many, the running ones first (and the one shown), as they matter now. */
const rows = computed(() => {
  if (showAll.value || props.agents.length <= MAX_ROWS) return props.agents
  const first = (a: AgentItem) => a.status === 'running' || a.id === ui.agentId
  return [...props.agents.filter(first), ...props.agents.filter((a) => !first(a))].slice(0, MAX_ROWS)
})
const more = computed(() => props.agents.length - rows.value.length)

const elapsed = (a: AgentItem) => formatDuration(Math.max(0, (a.endedAt ?? now.value) - a.startedAt))
const state = (a: AgentItem) => (a.status === 'running' ? a.activity || 'startet …' : a.status === 'done' ? 'fertig' : a.status === 'error' ? 'fehlgeschlagen' : 'gestoppt')

/** Its work in place of the chat; again: back to the main chat. */
function open(agent: AgentItem): void {
  ui.agentId = ui.agentId === agent.id ? null : agent.id
}
</script>

<template>
  <div class="flex flex-col rounded-xl border bg-card/50 p-1.5 shadow-sm backdrop-blur-lg">
    <div class="flex h-7 items-center gap-2 pr-0.5 pl-2 text-[0.8rem]">
      <BotIcon class="size-3.5 shrink-0 text-primary" />
      <span class="font-medium">Agents</span>
      <span class="truncate text-muted-foreground tabular-nums">
        {{ running.length }} aktiv<template v-if="finished"> · {{ finished }} fertig</template>
      </span>
      <!-- Folded, the one at work still says what it does. -->
      <span v-if="folded && running[0]" class="min-w-0 flex-1 truncate text-[0.78rem] text-muted-foreground">
        <span class="text-shimmer">{{ running[0].description || running[0].agentType }}: {{ state(running[0]) }}</span>
      </span>
      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          v-if="ui.agentId"
          type="button"
          class="flex h-6 items-center gap-1 rounded-md px-1.5 text-[0.76rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          v-tooltip="'Zurück zum Hauptchat (Esc)'"
          @click="ui.agentId = null"
        >
          <ArrowLeftIcon class="size-3.5" />
          Hauptchat
        </button>
        <button
          type="button"
          class="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          :aria-label="folded ? 'Agents ausklappen' : 'Agents einklappen'"
          :aria-expanded="!folded"
          @click="folded = !folded"
        >
          <ChevronDownIcon :class="cn('size-3.5 transition-transform', folded && 'rotate-180')" />
        </button>
      </div>
    </div>
    <div v-if="!folded" class="flex flex-col">
      <button
        v-for="a in rows"
        :key="a.id"
        type="button"
        :class="
          cn(
            'flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left transition-colors hover:bg-muted/60',
            ui.agentId === a.id && 'bg-primary/10 ring-1 ring-primary/25 ring-inset hover:bg-primary/15',
          )
        "
        :aria-label="`${a.description || a.agentType}: ${state(a)}`"
        :aria-current="ui.agentId === a.id ? 'page' : undefined"
        @click="open(a)"
      >
        <span class="flex size-4 shrink-0 items-center justify-center">
          <Spinner v-if="a.status === 'running'" class="size-3.5 text-primary" />
          <CheckIcon v-else-if="a.status === 'done'" class="size-3.5 text-success" />
          <XIcon v-else-if="a.status === 'error'" class="size-3.5 text-destructive" />
          <CircleStopIcon v-else class="size-3.5 text-muted-foreground" />
        </span>
        <span :class="cn('max-w-[40%] shrink-0 truncate text-[0.82rem] font-medium', a.status !== 'running' && 'text-muted-foreground')">
          {{ a.description || a.agentType }}
        </span>
        <span v-if="a.description" class="shrink-0 rounded bg-muted px-1.5 text-[0.68rem] text-muted-foreground">{{ a.agentType }}</span>
        <span
          :class="
            cn(
              'min-w-0 flex-1 truncate text-[0.78rem] text-muted-foreground',
              a.status === 'running' && a.activity && 'text-shimmer',
              a.status === 'error' && 'text-destructive',
            )
          "
        >
          {{ state(a) }}
        </span>
        <span class="shrink-0 text-[0.72rem] text-muted-foreground tabular-nums">
          <template v-if="a.toolCount">{{ a.toolCount }} {{ a.toolCount === 1 ? 'Werkzeug' : 'Werkzeuge' }} · </template>{{ elapsed(a) }}
        </span>
      </button>
      <button
        v-if="more || (showAll && agents.length > MAX_ROWS)"
        type="button"
        class="flex h-7 items-center rounded-lg px-2 text-left text-[0.78rem] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Weniger zeigen' : `+ ${more} weitere` }}
      </button>
    </div>
  </div>
</template>
