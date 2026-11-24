<script setup lang="ts">
import { BrainIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { ThinkingItem } from '@shared/chat'
import Markdown from './Markdown.vue'

/**
 * What the model thought, open in the timeline as it comes (the label shimmers meanwhile). Always
 * open: the setting „Gedanken anzeigen“ hides them all. Thoughts in a row show as one: the newest
 * fades in over the one before.
 */
const props = defineProps<{ items: ThinkingItem[] }>()
const item = computed(() => props.items.at(-1)!)
</script>

<template>
  <div class="my-1.5">
    <div class="flex items-center gap-1.5 py-1 text-[0.85rem] text-muted-foreground">
      <BrainIcon class="size-3.5" />
      <span :class="item.streaming && 'text-shimmer'">{{ item.streaming ? 'Denkt nach …' : 'Gedanken' }}</span>
    </div>
    <div class="mt-1 ml-1.5 border-l-2 border-border/70 pl-4 text-[0.88rem] text-muted-foreground">
      <Transition
        mode="out-in"
        enter-active-class="transition-opacity duration-300 ease-out"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-150 ease-in"
        leave-to-class="opacity-0"
      >
        <Markdown :key="item.id" :text="item.text" :streaming="item.streaming" />
      </Transition>
    </div>
  </div>
</template>
