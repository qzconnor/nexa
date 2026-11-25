<script setup lang="ts">
import { MapIcon } from '@lucide/vue'
import type { AssistantItem } from '@shared/chat'
import { cn } from '@/lib/utils'
import Markdown from './Markdown.vue'
import MessageActions from './MessageActions.vue'

/**
 * An answer of the agent; a note between its steps (`commentary`) smaller, a proposed plan (Codex's
 * plan mode) framed. Its own component, so that only it follows the streaming text, not the whole
 * timeline. Once complete, hovering shows when it came and copies it.
 */
defineProps<{ item: AssistantItem }>()
</script>

<template>
  <div
    :class="
      cn(
        'group relative',
        item.phase === 'commentary' ? 'py-1.5 text-[0.92rem] text-foreground/85' : 'py-2.5',
        item.phase === 'plan' && 'my-2 rounded-lg border bg-card px-4',
      )
    "
  >
    <div v-if="item.phase === 'plan'" class="mb-1 flex items-center gap-1.5 text-[0.78rem] font-medium text-muted-foreground">
      <MapIcon class="size-3.5" />
      Plan
    </div>
    <Markdown :text="item.text" :streaming="item.streaming" />
    <!-- Over the top edge, where it takes no room from the answer. -->
    <MessageActions
      v-if="!item.streaming && item.text.trim()"
      class="absolute -top-3 right-0 rounded-md border bg-card px-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100"
      :text="item.text"
      :ts="item.ts"
      :label="item.phase === 'plan' ? 'Plan kopieren' : 'Antwort kopieren'"
    />
  </div>
</template>
