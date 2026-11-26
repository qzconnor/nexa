<script setup lang="ts">
import { computed } from 'vue'
import type { TurnItem } from '@shared/chat'
import { useChatChanges } from '@/composables/useChatChanges'
import { formatDuration, formatTokens } from '@/lib/format'
import { useProvidersStore } from '@/stores/providers'

/**
 * The end of a turn: how long it took and the tokens, and the model where it differs from the turn
 * before (`showModel`). No price: the CLIs report what the API would charge, which isn't what a
 * subscription costs. What its prompt changed in the files (Nexa's checkpoints) opens those changes.
 */
const props = defineProps<{ item: TurnItem; showModel?: boolean }>()
const providers = useProvidersStore()
const changes = useChatChanges()

const parts = computed(() => {
  const t = props.item
  const out: string[] = []
  if (t.status === 'interrupted') out.push('Abgebrochen')
  else if (t.status === 'error') out.push('Fehlgeschlagen')
  if (props.showModel && t.model) out.push(providers.models[t.provider]?.find((m) => m.id === t.model)?.label ?? t.model)
  if (t.durationMs) out.push(formatDuration(t.durationMs))
  if (t.inputTokens || t.outputTokens) out.push(`${formatTokens(t.inputTokens ?? 0)} ein · ${formatTokens(t.outputTokens ?? 0)} aus`)
  return out
})

const files = computed(() => {
  const n = props.item.fileChanges?.files ?? 0
  return n === 1 ? '1 Datei' : `${n} Dateien`
})
</script>

<template>
  <div class="flex flex-col gap-1 pt-2 pb-5">
    <div v-if="item.error" class="selectable rounded-lg bg-destructive/10 px-3 py-2 text-[0.82rem] text-destructive">{{ item.error }}</div>
    <div v-if="parts.length || item.fileChanges" class="flex flex-wrap items-center gap-x-1.5 text-[0.72rem] text-muted-foreground/80 tabular-nums">
      <span v-if="parts.length">{{ parts.join(' · ') }}</span>
      <template v-if="item.fileChanges">
        <span v-if="parts.length" aria-hidden="true">·</span>
        <button
          type="button"
          class="rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none"
          :disabled="!changes"
          v-tooltip="'Was der Prompt an den Dateien geändert hat'"
          @click="changes?.show({ turnId: item.id })"
        >
          {{ files }}
          <span class="text-(--syn-green)">+{{ item.fileChanges.insertions }}</span>
          <span class="ml-1 text-(--syn-red)">−{{ item.fileChanges.deletions }}</span>
        </button>
      </template>
    </div>
  </div>
</template>
