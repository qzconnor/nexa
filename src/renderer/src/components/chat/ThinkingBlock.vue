<script setup lang="ts">
import { BrainIcon, ChevronRightIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { ThinkingItem } from '@shared/chat'
import { cn } from '@/lib/utils'
import Markdown from './Markdown.vue'

/**
 * What the model thought, open in the timeline as it comes (the label shimmers meanwhile); the label
 * folds it away. Thoughts in a row show as one: the newest fades in over the one before.
 */
const props = defineProps<{ items: ThinkingItem[] }>()
const open = ref(true)
const item = computed(() => props.items.at(-1)!)
</script>

<template>
  <div class="my-1.5">
    <button
      type="button"
      class="-ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.85rem] text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      :aria-expanded="open"
      @click="open = !open"
    >
      <BrainIcon class="size-3.5" />
      <span :class="item.streaming && 'text-shimmer'">{{ item.streaming ? 'Denkt nach …' : 'Gedanken' }}</span>
      <ChevronRightIcon :class="cn('size-3.5 transition-transform', open && 'rotate-90')" />
    </button>
    <div v-if="open" class="mt-1 ml-1.5 border-l-2 border-border/70 pl-4 text-[0.88rem] text-muted-foreground">
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
