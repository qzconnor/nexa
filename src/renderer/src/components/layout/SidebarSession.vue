<script setup lang="ts">
import { ArchiveIcon, PencilIcon, PinIcon, PinOffIcon, Trash2Icon } from '@lucide/vue'
import type { SessionMeta } from '@shared/types'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Spinner } from '@/components/ui/spinner'
import { useChatActions } from '@/composables/useChatActions'
import { formatAge } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'

/** A chat in the sidebar: its state at a glance, its name and age; renaming and the like on right-click. */
const props = defineProps<{ meta: SessionMeta; now: number }>()
const sessions = useSessionsStore()
const ui = useUiStore()

const chat = useChatActions()
const state = () => chat.state(props.meta.id)
const open = () => chat.open(props.meta.id)
const rename = () => chat.rename(props.meta)
const remove = () => chat.remove(props.meta)
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <button
        type="button"
        :class="
          cn(
            'group/session flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.85rem] transition-colors hover:bg-sidebar-accent/60',
            sessions.activeId === meta.id && ui.view === 'chat' && 'bg-sidebar-accent font-medium',
          )
        "
        @click="open"
      >
        <span class="flex size-3.5 shrink-0 items-center justify-center">
          <Spinner v-if="state() === 'running'" class="size-3 text-primary" />
          <span v-else-if="state() === 'waiting'" class="pulse-ring size-2 rounded-full bg-warning" />
          <span v-else-if="state() === 'unread'" class="size-2 rounded-full bg-primary" />
          <span v-else-if="state() === 'error'" class="size-2 rounded-full bg-destructive" />
          <ProviderIcon v-else :provider="meta.provider" class="size-3 opacity-60" />
        </span>
        <span class="min-w-0 flex-1 truncate">{{ meta.title }}</span>
        <PinIcon v-if="meta.pinned" class="size-3 shrink-0 text-muted-foreground" />
        <span class="shrink-0 text-[0.7rem] text-muted-foreground tabular-nums">{{ formatAge(meta.updatedAt, now) }}</span>
      </button>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-52">
      <ContextMenuItem @select="rename"><PencilIcon /> Umbenennen</ContextMenuItem>
      <ContextMenuItem @select="sessions.update(meta.id, { pinned: !meta.pinned })">
        <component :is="meta.pinned ? PinOffIcon : PinIcon" /> {{ meta.pinned ? 'Lösen' : 'Anheften' }}
      </ContextMenuItem>
      <ContextMenuItem @select="sessions.update(meta.id, { archived: true })"><ArchiveIcon /> Archivieren</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem class="text-destructive" @select="remove"><Trash2Icon /> Löschen</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
