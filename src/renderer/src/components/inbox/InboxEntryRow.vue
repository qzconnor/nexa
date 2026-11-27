<script setup lang="ts">
import { computed } from 'vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import InteractionCard from '@/components/chat/InteractionCard.vue'
import { useChatActions } from '@/composables/useChatActions'
import { provideProjectPath } from '@/composables/useProjectPath'
import { formatAge, formatAhead } from '@/lib/format'
import type { InboxRow } from '@/lib/inbox'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'

/**
 * A chat of the inbox, inside a `DeviceScope` of its device: a row that opens it, and below it what it
 * waits for, answered right here as in the chat.
 */
const props = defineProps<{ row: InboxRow; now: number; deviceName?: string }>()
const chat = useChatActions()
const projects = useProjectsStore()
const sessions = useSessionsStore()

const entry = computed(() => props.row.entry)
// Paths in a question (a command, a file to edit) shortened as the chat shows them.
provideProjectPath(computed(() => sessions.cwdOf(sessions.get(entry.value.id))))

/** Where it is and what it said last, in one line. */
const place = computed(() =>
  [props.deviceName, projects.get(entry.value.projectId)?.name ?? 'Ohne Projekt', entry.value.preview].filter(Boolean).join(' · '),
)

const resume = computed(() => {
  const at = entry.value.resume?.at
  if (at === undefined) return null
  if (at === null) return 'Am Limit, kein Account, mit dem es weitergehen könnte.'
  return `Am Limit, geht ${entry.value.resume?.estimated ? 'etwa ' : ''}${formatAhead(at, props.now)} weiter.`
})
</script>

<template>
  <li class="flex flex-col">
    <button type="button" class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50" @click="chat.open(entry.id)">
      <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
        <ProviderIcon :provider="entry.provider" class="size-4" />
      </span>
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="flex items-baseline gap-2">
          <span :class="cn('min-w-0 flex-1 truncate text-sm', entry.section === 'unread' ? 'font-semibold' : 'font-medium')">{{ entry.title }}</span>
          <span class="shrink-0 text-xs text-muted-foreground tabular-nums">{{ formatAge(entry.updatedAt, now) }}</span>
        </span>
        <span class="truncate text-xs text-muted-foreground">{{ place }}</span>
        <span v-if="entry.error" class="selectable line-clamp-3 text-xs break-words text-destructive">{{ entry.error }}</span>
        <span v-if="resume" class="text-xs text-warning">{{ resume }}</span>
      </span>
    </button>
    <div v-for="item in entry.pending" :key="item.id" class="px-4 pb-3">
      <InteractionCard :item="item" :session-id="entry.id" />
    </div>
  </li>
</template>
