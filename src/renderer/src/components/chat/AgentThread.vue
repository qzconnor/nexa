<script setup lang="ts">
import { ArrowLeftIcon, BotIcon, CheckIcon, CircleStopIcon, XIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { AgentItem, ChatItem } from '@shared/chat'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'
import Markdown from './Markdown.vue'
import MessageList from './MessageList.vue'

/**
 * A subagent's work in place of the chat, as Claude Code's CLI shows an agent's transcript: who it
 * is, the task it got (as the prompt of its thread), every step, and what it gave back.
 */
const props = defineProps<{ agent: AgentItem; items: ChatItem[]; sessionId: string }>()
const ui = useUiStore()
const now = useClock(1000)

/** A long task shows its start; the rest on request. */
const LONG_TASK = 600
const showTask = ref(false)

const running = computed(() => props.agent.status === 'running')
const elapsed = computed(() => formatDuration(Math.max(0, (props.agent.endedAt ?? now.value) - props.agent.startedAt)))
const thread = computed(() => props.items.filter((i) => i.parentId === props.agent.id))
const steps = computed(() => thread.value.filter((i) => i.kind === 'tool' || i.kind === 'agent').length)
const state = computed(() =>
  running.value ? props.agent.activity || 'arbeitet …' : props.agent.status === 'done' ? 'fertig' : props.agent.status === 'error' ? 'fehlgeschlagen' : 'gestoppt',
)

/**
 * What it gave back, unless its last message already says it: Claude streams the agent's answer
 * into its thread and hands the same text (with a trailer) back as the result.
 */
const result = computed(() => {
  const text = props.agent.result?.trim()
  if (!text) return null
  const last = thread.value.findLast((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant' && !!i.text.trim())
  return last && text.startsWith(last.text.trim().slice(0, 400)) ? null : text
})

function back(): void {
  ui.agentId = props.agent.parentId ?? null
}
</script>

<template>
  <div class="flex flex-col">
    <!-- Whose work this is; back to the thread it came from. -->
    <div class="mb-2 flex items-center gap-3 rounded-xl border bg-card/60 px-3 py-2.5">
      <span
        :class="
          cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary',
            running && 'pulse-ring',
            agent.status === 'error' && 'bg-destructive/12 text-destructive',
          )
        "
      >
        <BotIcon class="size-4.5" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex min-w-0 items-center gap-2">
          <span class="truncate text-[0.95rem] font-medium">{{ agent.description || agent.agentType }}</span>
          <span class="shrink-0 rounded bg-muted px-1.5 text-[0.7rem] text-muted-foreground">{{ agent.agentType }}</span>
          <span v-if="agent.background" class="shrink-0 rounded bg-muted px-1.5 text-[0.7rem] text-muted-foreground">Hintergrund</span>
        </span>
        <span class="flex min-w-0 items-center gap-1.5 text-[0.78rem] text-muted-foreground">
          <Spinner v-if="running" class="size-3 shrink-0 text-primary" />
          <CheckIcon v-else-if="agent.status === 'done'" class="size-3.5 shrink-0 text-(--tool-run)" />
          <XIcon v-else-if="agent.status === 'error'" class="size-3.5 shrink-0 text-destructive" />
          <CircleStopIcon v-else class="size-3.5 shrink-0" />
          <span :class="cn('truncate', running && agent.activity && 'text-shimmer', agent.status === 'error' && 'text-destructive')">{{ state }}</span>
          <span class="shrink-0 tabular-nums">· {{ elapsed }} · {{ steps }} {{ steps === 1 ? 'Schritt' : 'Schritte' }}</span>
          <span v-if="agent.model" class="truncate">· {{ agent.model }}</span>
        </span>
      </span>
      <button
        type="button"
        class="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[0.8rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        v-tooltip="'Zurück (Esc)'"
        @click="back"
      >
        <ArrowLeftIcon class="size-3.5" />
        {{ agent.parentId ? 'Zurück' : 'Hauptchat' }}
      </button>
    </div>

    <!-- Its task: what the main agent asked of it, as the prompt of this thread. -->
    <div v-if="agent.prompt" class="flex flex-col items-end gap-1 py-2">
      <span class="text-[0.72rem] text-muted-foreground">Auftrag</span>
      <div class="relative max-w-[85%] overflow-hidden rounded-2xl rounded-br-md bg-secondary px-4 py-2.5">
        <div :class="cn(!showTask && agent.prompt.length > LONG_TASK && 'max-h-40 overflow-hidden')">
          <Markdown :text="agent.prompt" breaks />
        </div>
        <div v-if="agent.prompt.length > LONG_TASK" :class="cn('flex justify-end', !showTask && 'absolute inset-x-0 bottom-0 bg-linear-to-t from-secondary from-40% to-transparent px-4 pt-6 pb-2')">
          <button type="button" class="text-[0.78rem] text-muted-foreground hover:text-foreground" @click="showTask = !showTask">
            {{ showTask ? 'Weniger zeigen' : 'Ganzen Auftrag zeigen' }}
          </button>
        </div>
      </div>
    </div>

    <MessageList :items="items" :session-id="sessionId" :parent-id="agent.id" />

    <div v-if="result" class="my-2 rounded-xl border bg-card/60 px-4 py-3">
      <div class="mb-1 text-xs font-medium text-muted-foreground">Ergebnis</div>
      <Markdown :text="result" />
    </div>
  </div>
</template>
