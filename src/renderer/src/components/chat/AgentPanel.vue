<script setup lang="ts">
import { BotIcon, ChevronRightIcon, XIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { AgentItem, ChatItem } from '@shared/chat'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'
import Markdown from './Markdown.vue'
import MessageList from './MessageList.vue'

/** A subagent's work beside the chat: its task, every step it takes, and its answer. */
const props = defineProps<{ items: ChatItem[]; sessionId: string }>()
const ui = useUiStore()
const now = useClock(1000)
const showPrompt = ref(false)

const agent = computed(() => props.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === ui.agentId))
const agents = computed(() => props.items.filter((i): i is AgentItem => i.kind === 'agent'))
const running = computed(() => agent.value?.status === 'running')
const elapsed = computed(() => (agent.value ? (agent.value.endedAt ?? now.value) - agent.value.startedAt : 0))
const steps = computed(() => (agent.value ? props.items.filter((i) => i.parentId === agent.value!.id).length : 0))
</script>

<template>
  <aside class="flex h-full w-[26rem] shrink-0 flex-col border-l bg-sidebar/60">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <BotIcon class="size-4 text-primary" />
      <span class="text-sm font-medium">Agents</span>
      <span class="text-xs text-muted-foreground">{{ agents.filter((a) => a.status === 'running').length }} aktiv · {{ agents.length }} gesamt</span>
      <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Schließen" @click="ui.agentId = null">
        <XIcon />
      </Button>
    </div>
    <!-- All agents of the chat, to switch between them. -->
    <div v-if="agents.length > 1" class="flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1.5">
      <button
        v-for="a in agents"
        :key="a.id"
        type="button"
        :class="
          cn(
            'flex max-w-44 shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-muted',
            a.id === ui.agentId && 'bg-muted font-medium',
          )
        "
        @click="ui.agentId = a.id"
      >
        <Spinner v-if="a.status === 'running'" class="size-3" />
        <span v-else :class="cn('size-1.5 rounded-full', a.status === 'done' ? 'bg-(--tool-run)' : a.status === 'error' ? 'bg-destructive' : 'bg-muted-foreground')" />
        <span class="truncate">{{ a.description || a.agentType }}</span>
      </button>
    </div>
    <div v-if="agent" class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div class="mb-3 flex flex-col gap-1">
        <div class="text-[0.95rem] font-medium">{{ agent.description || agent.agentType }}</div>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span class="rounded bg-muted px-1.5">{{ agent.agentType }}</span>
          <span v-if="agent.model">{{ agent.model }}</span>
          <span class="tabular-nums">{{ formatDuration(Math.max(0, elapsed)) }}</span>
          <span>{{ steps }} {{ steps === 1 ? 'Schritt' : 'Schritte' }}</span>
          <span :class="cn(running && 'text-shimmer', agent.status === 'error' && 'text-destructive')">
            {{ running ? agent.activity || 'arbeitet …' : agent.status === 'done' ? 'fertig' : agent.status === 'error' ? 'fehlgeschlagen' : 'gestoppt' }}
          </span>
        </div>
      </div>
      <button
        v-if="agent.prompt"
        type="button"
        class="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        @click="showPrompt = !showPrompt"
      >
        <ChevronRightIcon :class="cn('size-3.5 transition-transform', showPrompt && 'rotate-90')" />
        Auftrag
      </button>
      <div v-if="showPrompt && agent.prompt" class="mb-3 rounded-lg border bg-background/40 px-3 py-2 text-[0.85rem]">
        <Markdown :text="agent.prompt" breaks />
      </div>
      <MessageList :items="items" :session-id="sessionId" :parent-id="agent.id" class="text-[0.9rem]" />
      <div v-if="running && steps === 0" class="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Spinner class="size-3.5" /> Startet …
      </div>
      <div v-if="agent.result" class="mt-3 rounded-xl border bg-card/60 px-4 py-3">
        <div class="mb-1 text-xs font-medium text-muted-foreground">Ergebnis</div>
        <Markdown :text="agent.result" class="text-[0.9rem]" />
      </div>
    </div>
    <div v-else class="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      Den Agent gibt es in diesem Chat nicht mehr.
    </div>
  </aside>
</template>
