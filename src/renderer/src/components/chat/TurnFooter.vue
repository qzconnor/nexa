<script setup lang="ts">
import { computed } from 'vue'
import type { TurnItem } from '@shared/chat'
import { formatCost, formatDuration, formatTokens } from '@/lib/format'

/** The end of a turn: how long it took, the tokens and what it cost. */
const props = defineProps<{ item: TurnItem }>()

const parts = computed(() => {
  const t = props.item
  const out: string[] = []
  if (t.status === 'interrupted') out.push('Abgebrochen')
  else if (t.status === 'error') out.push('Fehlgeschlagen')
  if (t.durationMs) out.push(formatDuration(t.durationMs))
  if (t.inputTokens || t.outputTokens) out.push(`${formatTokens(t.inputTokens ?? 0)} ein · ${formatTokens(t.outputTokens ?? 0)} aus`)
  if (t.costUsd) out.push(formatCost(t.costUsd))
  return out
})
</script>

<template>
  <div class="flex flex-col gap-1 pt-1 pb-3">
    <div v-if="item.error" class="selectable rounded-lg bg-destructive/10 px-3 py-2 text-[0.82rem] text-destructive">{{ item.error }}</div>
    <div v-if="parts.length" class="text-[0.72rem] text-muted-foreground/80 tabular-nums">{{ parts.join(' · ') }}</div>
  </div>
</template>
