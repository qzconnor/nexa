<script setup lang="ts">
import { ChevronRightIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { ToolItem } from '@shared/chat'
import { toolSummary } from '@/lib/tools'
import { cn } from '@/lib/utils'
import ToolRow from './ToolRow.vue'

/**
 * Tool calls in a row. A few are listed as they are; a long run folds into its summary, with the
 * last calls still visible while it works.
 */
const props = defineProps<{ tools: ToolItem[] }>()

const FOLD_FROM = 6
const SHOWN_WHILE_FOLDED = 3
const open = ref(false)
const running = computed(() => props.tools.some((t) => t.status === 'running' || t.status === 'pending'))
const foldable = computed(() => props.tools.length >= FOLD_FROM)
const hidden = computed(() => (foldable.value && !open.value ? props.tools.length - SHOWN_WHILE_FOLDED : 0))
const shown = computed(() => props.tools.slice(hidden.value))
const summary = computed(() => toolSummary(props.tools))
</script>

<template>
  <div class="relative my-1 flex flex-col border-l-2 border-border/70 pl-1.5">
    <button
      v-if="foldable"
      type="button"
      class="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      @click="open = !open"
    >
      <ChevronRightIcon :class="cn('size-3.5 transition-transform', open && 'rotate-90')" />
      <span :class="running && 'text-shimmer'">{{ summary }}</span>
      <span v-if="hidden" class="opacity-70">· {{ hidden }} weitere</span>
    </button>
    <ToolRow v-for="tool in shown" :key="tool.id" :tool="tool" />
  </div>
</template>
