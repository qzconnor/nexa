<script setup lang="ts">
import { computed } from 'vue'
import type { SessionMeta } from '@shared/types'
import { Spinner } from '@/components/ui/spinner'
import { useChatActions } from '@/composables/useChatActions'
import type { GroupState } from '@/lib/chat-state'
import { cn } from '@/lib/utils'

/**
 * What the chats of a folded project, folder or separator do, with the same marks as a chat's row:
 * the spinner while one works, a dot for what wants a look. Open, the rows show it themselves.
 */
const props = defineProps<{ chats: readonly SessionMeta[] }>()
const chat = useChatActions()
const state = computed(() => chat.group(props.chats))

const SIGNALS: Record<NonNullable<GroupState['signal']>, { class: string; label: string }> = {
  waiting: { class: 'pulse-ring bg-warning', label: 'Ein Chat wartet auf eine Antwort' },
  error: { class: 'bg-destructive', label: 'Ein Chat ist fehlgeschlagen' },
  unread: { class: 'bg-primary', label: 'Neue Antworten' },
}
</script>

<template>
  <span v-if="state.running || state.signal" class="flex shrink-0 items-center gap-1.5">
    <Spinner v-if="state.running" class="size-3 text-primary" aria-label="Ein Chat arbeitet" />
    <span v-if="state.signal" role="img" :aria-label="SIGNALS[state.signal].label" :class="cn('size-2 rounded-full', SIGNALS[state.signal].class)" />
  </span>
</template>
