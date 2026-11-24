<script setup lang="ts">
import { computed } from 'vue'
import type { UsageWindow } from '@shared/types'
import { formatReset } from '@/lib/format'
import { forecastHint, usageTextClass } from '@/lib/usage'
import { cn } from '@/lib/utils'

/**
 * Under a limit's bar: when it resets and, at the current pace, when the limit comes (in the color of
 * a full window) or how full it gets by the reset. Where the room runs short, the forecast wraps.
 */
const props = defineProps<{ window: UsageWindow; now: number }>()
const hint = computed(() => forecastHint(props.window, props.now))
</script>

<template>
  <div v-if="window.resetsAt || hint" class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-muted-foreground">
    <span v-if="window.resetsAt">Zurückgesetzt {{ formatReset(window.resetsAt, now) }}</span>
    <span v-if="hint" v-tooltip="hint.title" :class="cn('ml-auto shrink-0 tabular-nums', hint.warn && cn('font-medium', usageTextClass.high))">
      {{ hint.text }}
    </span>
  </div>
</template>
