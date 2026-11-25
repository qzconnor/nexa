<script setup lang="ts">
import { CheckIcon, CopyIcon } from '@lucide/vue'
import { onBeforeUnmount, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { formatClock, formatDateTime } from '@/lib/format'

/**
 * Beside a prompt or an answer: when it came (the date in the tooltip) and copying its text as it
 * was written (markdown). Shown on hover and while it has the keyboard.
 */
const props = defineProps<{ text: string; ts: number; label: string }>()

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
async function copy(): Promise<void> {
  await navigator.clipboard.writeText(props.text)
  copied.value = true
  clearTimeout(timer)
  timer = setTimeout(() => (copied.value = false), 1200)
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <span class="flex items-center gap-0.5 text-[0.7rem] text-muted-foreground">
    <span class="px-1 tabular-nums" v-tooltip="formatDateTime(ts)">{{ formatClock(ts) }}</span>
    <Button variant="ghost" size="icon-xs" :aria-label="label" v-tooltip="copied ? 'Kopiert' : label" @click="copy">
      <CheckIcon v-if="copied" />
      <CopyIcon v-else />
    </Button>
  </span>
</template>
