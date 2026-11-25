<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { TerminalInfo } from '@shared/terminals'
import type { TerminalSession } from '@/lib/terminal-session'
import { useTerminalsStore } from '@/stores/terminals'

/**
 * The place of one terminal in the panel: its xterm (kept in the store) is moved in while it shows and
 * fills it, with as many columns and rows as fit.
 */
const props = defineProps<{ terminal: TerminalInfo }>()
const terminals = useTerminalsStore()
const host = ref<HTMLElement | null>(null)
let session: TerminalSession | null = null
let frame = 0
let unmounted = false

onMounted(async () => {
  const made = await terminals.session(props.terminal)
  // Gone while xterm was loading: another view shows it, or none.
  if (unmounted || !host.value) return
  session = made
  await session.attach(host.value)
  session.focus()
})
onBeforeUnmount(() => {
  unmounted = true
  cancelAnimationFrame(frame)
  session?.detach()
})

// Once a frame at most while the panel is dragged wider or narrower.
useResizeObserver(host, () => {
  cancelAnimationFrame(frame)
  frame = requestAnimationFrame(() => session?.fit())
})
watch(
  () => terminals.focusRequest,
  () => session?.focus(),
)
</script>

<template>
  <div ref="host" class="h-full w-full" />
</template>
