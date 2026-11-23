<script setup lang="ts">
import { computed } from 'vue'
import type { TurnItem } from '@shared/chat'
import { formatDuration, formatTokens } from '@/lib/format'

/**
 * The end of a turn: how long it took and the tokens. No price: the CLIs report what the API would
 * charge, which isn't what a subscription costs.
 */
const props = defineProps<{ item: TurnItem }>()

const parts = computed(() => {
  const t = props.item
  const out: string[] = []
  if (t.status === 'interrupted') out.push('Abgebrochen')
  else if (t.status === 'error') out.push('Fehlgeschlagen')
  if (t.durationMs) out.push(formatDuration(t.durationMs))
  if (t.inputTokens || t.outputTokens) out.push(`${formatTokens(t.inputTokens ?? 0)} ein · ${formatTokens(t.outputTokens ?? 0)} aus`)
  return out
})
</script>

<template>
  <div class="flex flex-col gap-1 pt-2 pb-5">
    <div v-if="item.error" class="selectable rounded-lg bg-destructive/10 px-3 py-2 text-[0.82rem] text-destructive">{{ item.error }}</div>
    <div v-if="parts.length" class="text-[0.72rem] text-muted-foreground/80 tabular-nums">{{ parts.join(' · ') }}</div>
  </div>
</template>
