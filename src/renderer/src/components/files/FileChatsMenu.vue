<script setup lang="ts">
import { HistoryIcon } from '@lucide/vue'
import { ref } from 'vue'
import type { FileEditHit } from '@shared/types'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { ContextMenuItem, ContextMenuShortcut, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@/components/ui/context-menu'
import { Spinner } from '@/components/ui/spinner'
import { useChatActions } from '@/composables/useChatActions'
import { errorMessage } from '@/lib/errors'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useDeviceApi } from '@/stores/device'
import { useSessionsStore } from '@/stores/sessions'

/**
 * „Von Chats geändert“ in a file's context menu (as the Claude Manager's „Von Sessions geändert“): the
 * chats whose agent wrote the file, asked of the tree's device when the submenu opens. A click opens
 * the chat.
 */
const props = defineProps<{ path: string }>()

const api = useDeviceApi()
const sessions = useSessionsStore()
const chat = useChatActions()

const hits = ref<FileEditHit[] | null>(null)
const error = ref<string | null>(null)
let request = 0

async function load(): Promise<void> {
  const asked = ++request
  hits.value = null
  error.value = null
  try {
    const found = await api.sessions.editedBy(props.path)
    // Only chats this window knows: one deleted a moment ago is gone from the list already.
    if (asked === request) hits.value = found.filter((hit) => sessions.get(hit.sessionId))
  } catch (cause) {
    if (asked === request) error.value = errorMessage(cause)
  }
}

function onOpen(open: boolean): void {
  if (open) void load()
}
</script>

<template>
  <ContextMenuSub @update:open="onOpen">
    <ContextMenuSubTrigger>
      <HistoryIcon />
      Von Chats geändert
    </ContextMenuSubTrigger>
    <ContextMenuSubContent class="w-80 max-w-[calc(100vw-2rem)]">
      <ContextMenuItem v-if="error" disabled class="text-destructive">Suche fehlgeschlagen: {{ error }}</ContextMenuItem>
      <ContextMenuItem v-else-if="!hits" disabled>
        <Spinner class="size-3.5" />
        Wird gesucht …
      </ContextMenuItem>
      <ContextMenuItem v-else-if="!hits.length" disabled>Kein Chat hat die Datei geändert</ContextMenuItem>
      <template v-else>
        <ContextMenuItem
          v-for="hit in hits"
          :key="hit.sessionId"
          :title="`${sessions.get(hit.sessionId)!.title}\nzuletzt geändert ${formatDateTime(hit.at)}`"
          @select="chat.open(hit.sessionId)"
        >
          <ProviderIcon :provider="sessions.get(hit.sessionId)!.provider" class="size-3.5 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ sessions.get(hit.sessionId)!.title }}</span>
          <ContextMenuShortcut class="shrink-0">{{ formatRelative(hit.at) }}</ContextMenuShortcut>
        </ContextMenuItem>
      </template>
    </ContextMenuSubContent>
  </ContextMenuSub>
</template>
