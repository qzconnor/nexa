<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'
import { useSlowLoad } from '@/composables/useSlowLoad'
import { cn } from '@/lib/utils'

/**
 * Rows of a list that is still being read. Only after a moment, so a quick read doesn't flash them;
 * until then they hold the list's place.
 */
const props = withDefaults(defineProps<{ rows?: number; label?: string }>(), { rows: 3, label: 'Wird geladen' })
const slow = useSlowLoad(() => true)
const WIDTHS = ['w-1/3', 'w-2/5', 'w-1/4']
</script>

<template>
  <div role="status" :aria-label="props.label" :class="cn('flex flex-col divide-y rounded-lg border', !slow && 'invisible')">
    <div v-for="i in props.rows" :key="i" class="flex items-center gap-3 px-3 py-2.5">
      <Skeleton class="size-6 shrink-0 rounded-md" />
      <div class="flex flex-1 flex-col gap-1.5">
        <Skeleton :class="cn('h-3.5', WIDTHS[(i - 1) % WIDTHS.length])" />
        <Skeleton class="h-3 w-1/2" />
      </div>
    </div>
  </div>
</template>
