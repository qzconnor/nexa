<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'
import { useSlowLoad } from '@/composables/useSlowLoad'
import { cn } from '@/lib/utils'

/**
 * A chat whose history is still on its way from the main process: the shapes of a few messages, as
 * questions on the right and answers on the left. Only after a moment, so a quick opening doesn't flash it.
 */
const slow = useSlowLoad(() => true)
const MESSAGES = [
  { user: true, widths: ['w-2/5'] },
  { user: false, widths: ['w-full', 'w-11/12', 'w-3/4'] },
  { user: true, widths: ['w-1/3'] },
  { user: false, widths: ['w-full', 'w-5/6', 'w-full', 'w-2/3'] },
]
</script>

<template>
  <div role="status" aria-label="Chat wird geladen" :class="cn('flex flex-col gap-7 py-2', !slow && 'invisible')">
    <template v-for="(message, i) in MESSAGES" :key="i">
      <div v-if="message.user" class="flex justify-end">
        <Skeleton :class="cn('h-10 rounded-2xl', message.widths[0])" />
      </div>
      <div v-else class="flex flex-col gap-2.5">
        <Skeleton v-for="(width, j) in message.widths" :key="j" :class="cn('h-3.5', width)" />
      </div>
    </template>
  </div>
</template>
