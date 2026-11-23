<script setup lang="ts">
import { CheckIcon, CircleIcon, ListChecksIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { TodoItem } from '@shared/chat'
import { cn } from '@/lib/utils'

/**
 * The agent's task list, with what is done, what it works on and what is still open. Compact, it
 * floats frosted over the chat above the composer (in a `.frost-backing` wrapper).
 */
const props = defineProps<{ item: TodoItem; compact?: boolean }>()
const done = computed(() => props.item.entries.filter((e) => e.status === 'completed').length)
</script>

<template>
  <div :class="cn('rounded-xl border', compact ? 'bg-card/50 px-3 py-2 shadow-sm backdrop-blur-lg' : 'my-2 bg-card/60 px-4 py-3')">
    <div class="mb-1.5 flex items-center gap-2 text-[0.82rem] font-medium">
      <ListChecksIcon class="size-3.5 text-muted-foreground" />
      Aufgaben
      <span class="font-normal text-muted-foreground tabular-nums">{{ done }}/{{ item.entries.length }}</span>
    </div>
    <p v-if="item.explanation && !compact" class="mb-2 text-[0.82rem] text-muted-foreground">{{ item.explanation }}</p>
    <ul class="flex flex-col gap-1">
      <li v-for="(entry, i) in item.entries" :key="i" class="flex items-start gap-2 text-[0.85rem]">
        <span
          :class="
            cn(
              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
              entry.status === 'completed' && 'border-(--tool-run) bg-(--tool-run) text-background',
              entry.status === 'in_progress' && 'border-primary',
            )
          "
        >
          <CheckIcon v-if="entry.status === 'completed'" class="size-3" stroke-width="3" />
          <CircleIcon v-else-if="entry.status === 'in_progress'" class="pulse-ring size-2 rounded-full fill-primary text-primary" />
        </span>
        <span
          :class="
            cn(
              entry.status === 'completed' && 'text-muted-foreground line-through decoration-muted-foreground/50',
              entry.status === 'in_progress' && 'font-medium',
            )
          "
          >{{ entry.status === 'in_progress' && entry.activeText ? entry.activeText : entry.text }}</span
        >
      </li>
    </ul>
  </div>
</template>
