<script setup lang="ts">
import { ChevronsDownUpIcon, CircleAlertIcon, EraserIcon, InfoIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { NoticeItem } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import { formatDuration, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Something the CLI or Nexa reports between the messages: a compaction, a retry, an error. */
const props = defineProps<{ item: NoticeItem }>()
const icon = computed(() => ({ info: InfoIcon, warning: TriangleAlertIcon, error: CircleAlertIcon })[props.item.level])

// A compaction is a divider across the chat: what is above it, the CLI knows only as a summary.
const compaction = computed(() => props.item.compaction)
const tokens = computed(() => {
  const c = compaction.value
  if (c?.before === undefined) return ''
  return c.after !== undefined ? `${formatTokens(c.before)} → ${formatTokens(c.after)} Tokens` : `${formatTokens(c.before)} Tokens vorher`
})
const hint = computed(() => {
  const c = compaction.value
  if (!c) return ''
  return [
    `Ab hier kennt ${PROVIDERS[props.item.provider].name} den Verlauf davor nur noch als Zusammenfassung.`,
    c.trigger === 'auto' ? 'Automatisch, weil der Kontext voll wurde.' : c.trigger === 'manual' ? 'Mit /compact angestoßen.' : '',
    c.durationMs ? `Dauer: ${formatDuration(c.durationMs)}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
})
</script>

<template>
  <div v-if="compaction" role="separator" class="my-3 flex items-center gap-3 text-[0.78rem] text-muted-foreground">
    <div class="h-px flex-1 bg-border" />
    <span v-tooltip="hint" class="flex min-w-0 items-center gap-1.5">
      <ChevronsDownUpIcon class="size-3.5 shrink-0" />
      <span class="truncate">{{ compaction.trigger === 'auto' ? 'Kontext automatisch zusammengefasst' : 'Kontext zusammengefasst' }}</span>
      <span v-if="tokens" class="shrink-0 tabular-nums opacity-80">· {{ tokens }}</span>
    </span>
    <div class="h-px flex-1 bg-border" />
  </div>
  <!-- Emptied with /clear: a divider as for a compaction, but above it the agent knows nothing at all. -->
  <div v-else-if="item.cleared" role="separator" class="my-3 flex items-center gap-3 text-[0.78rem] text-muted-foreground">
    <div class="h-px flex-1 bg-border" />
    <span v-tooltip="'Ab hier fängt die Unterhaltung neu an. Was darüber steht, kennt der Agent nicht mehr.'" class="flex min-w-0 items-center gap-1.5">
      <EraserIcon class="size-3.5 shrink-0" />
      <span class="truncate">{{ item.text }}</span>
    </span>
    <div class="h-px flex-1 bg-border" />
  </div>
  <div
    v-else
    :class="
      cn(
        'my-1.5 flex items-start gap-2 rounded-lg px-3 py-2 text-[0.82rem]',
        item.level === 'info' && 'text-muted-foreground',
        item.level === 'warning' && 'bg-warning/10 text-warning',
        item.level === 'error' && 'bg-destructive/10 text-destructive',
      )
    "
  >
    <component :is="icon" class="mt-0.5 size-3.5 shrink-0" />
    <div class="min-w-0">
      <div>{{ item.text }}</div>
      <div v-if="item.detail" class="selectable mt-0.5 font-mono text-[0.75rem] whitespace-pre-wrap opacity-80">{{ item.detail }}</div>
    </div>
  </div>
</template>
