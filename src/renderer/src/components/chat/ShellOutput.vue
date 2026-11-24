<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { cn } from '@/lib/utils'

/**
 * What a shell wrote, in the shell's view over the dock: follows its end while it runs, unless the
 * user scrolled up to read. Without output the slot says why (loading, nothing yet, an error).
 */
const props = defineProps<{ text: string; failed?: boolean }>()

/** More would make the page slow to draw; the end is what matters. */
const MAX_CHARS = 60_000
const shown = computed(() => (props.text.length > MAX_CHARS ? `…\n${props.text.slice(-MAX_CHARS)}` : props.text))

const pre = ref<HTMLElement | null>(null)
let pinned = true

function onScroll(): void {
  const el = pre.value
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

async function toEnd(): Promise<void> {
  await nextTick()
  if (pre.value) pre.value.scrollTop = pre.value.scrollHeight
}

onMounted(() => void toEnd())
watch(shown, () => {
  if (pinned) void toEnd()
})
</script>

<template>
  <pre
    v-if="text"
    ref="pre"
    :class="
      cn(
        'selectable h-full overflow-auto rounded-lg border bg-(--code-bg) px-3 py-2 font-mono text-[0.75rem] leading-relaxed break-words whitespace-pre-wrap text-(--code-fg)',
        failed && 'border-destructive/40',
      )
    "
    @scroll="onScroll"
    >{{ shown }}</pre
  >
  <div v-else class="flex h-full items-center justify-center rounded-lg border border-dashed px-3 text-center text-[0.8rem] text-muted-foreground">
    <slot />
  </div>
</template>
