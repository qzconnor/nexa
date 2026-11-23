<script setup lang="ts">
import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { NoticeItem } from '@shared/chat'
import { cn } from '@/lib/utils'

/** Something the CLI or Nexa reports between the messages: a compaction, a retry, an error. */
const props = defineProps<{ item: NoticeItem }>()
const icon = computed(() => ({ info: InfoIcon, warning: TriangleAlertIcon, error: CircleAlertIcon })[props.item.level])
</script>

<template>
  <div
    :class="
      cn(
        'my-1.5 flex items-start gap-2 rounded-lg px-3 py-2 text-[0.82rem]',
        item.level === 'info' && 'text-muted-foreground',
        item.level === 'warning' && 'bg-warning/10 text-warning',
        item.level === 'error' && 'bg-destructive/10 text-destructive',
      )
    "
  >
    <component :is="icon" class="mt-0.5 size-3.5 shrink-0" />
    <div class="min-w-0">
      <div>{{ item.text }}</div>
      <div v-if="item.detail" class="selectable mt-0.5 font-mono text-[0.75rem] whitespace-pre-wrap opacity-80">{{ item.detail }}</div>
    </div>
  </div>
</template>
