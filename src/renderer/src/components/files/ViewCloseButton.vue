<script setup lang="ts">
import { XIcon } from '@lucide/vue'
import { Kbd } from '@/components/ui/kbd'

/**
 * Closes a file's changes (or all of them) over the chat. In words and with its key rather than a bare
 * cross among the view's icons: it is the way back to the chat, so it has to be found at a glance.
 */
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <span aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-border" />
  <button
    type="button"
    aria-keyshortcuts="Escape"
    class="flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border bg-muted/60 pr-1 pl-2 text-xs font-medium text-foreground transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
    @click="emit('close')"
  >
    <XIcon class="size-[14px]" />
    Schließen
    <Kbd class="h-[18px] bg-background/60">Esc</Kbd>
  </button>
</template>
