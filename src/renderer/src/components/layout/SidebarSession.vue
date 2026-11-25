<script setup lang="ts">
import { ArchiveIcon, CalendarClockIcon, CopyIcon, FileDownIcon, GitForkIcon, PencilIcon, PinIcon, PinOffIcon, SquareArrowOutUpRightIcon, Trash2Icon } from '@lucide/vue'
import { computed } from 'vue'
import type { SessionMeta } from '@shared/types'
import AccountDot from '@/components/accounts/AccountDot.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Spinner } from '@/components/ui/spinner'
import { useChatActions } from '@/composables/useChatActions'
import { useSessionDrag } from '@/composables/useSessionDrag'
import { formatAge } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useChatWindowsStore } from '@/stores/chat-windows'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import SessionMoveMenu from './SessionMoveMenu.vue'

/**
 * A chat in the sidebar: its state at a glance, its name and age; renaming and the like on right-click.
 * Dragged onto another project or a folder in it, it moves there (see Sidebar).
 */
const props = defineProps<{
  meta: SessionMeta
  now: number
  /** Among the pinned on top: the project it is in, as they come from everywhere. */
  place?: string
}>()
const sessions = useSessionsStore()
const ui = useUiStore()
const accounts = useAccountsStore()
const chatWindows = useChatWindowsStore()
/** In a window of its own: a click brings that window to the front. */
const ownWindow = computed(() => chatWindows.hasWindow(props.meta.id))

/** Whose login the chat runs with; only worth a dot while its CLI has more than one account. */
const account = computed(() => (accounts.ofProvider(props.meta.provider).length > 1 ? accounts.get(accounts.sessionAccount(props.meta)) : undefined))

const chat = useChatActions()
const state = () => chat.state(props.meta.id)
const open = () => chat.open(props.meta.id)
const rename = () => chat.rename(props.meta)
const remove = () => chat.remove(props.meta)

const drag = useSessionDrag()

function startDrag(event: DragEvent): void {
  if (!drag || !event.dataTransfer) return
  drag.dragging.value = props.meta.id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-nexa-session', props.meta.id)
}

function endDrag(): void {
  if (!drag) return
  drag.dragging.value = null
  drag.target.value = null
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <!-- While its CLI works, the chat stays where it is: it can't be dragged then. -->
      <!-- A row for the arrow keys (useListKeys); its place counts for Ctrl+1–9 (useShortcuts). -->
      <button
        type="button"
        data-list-row
        data-chat-row
        :data-session-id="meta.id"
        :aria-current="sessions.activeId === meta.id && ui.view === 'chat' ? 'page' : undefined"
        :draggable="!!drag && !chat.working(meta.id)"
        :class="
          cn(
            'group/session flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.85rem] transition-colors hover:bg-sidebar-accent/60',
            sessions.activeId === meta.id && ui.view === 'chat' && 'bg-sidebar-accent font-medium',
            drag?.dragging.value === meta.id && 'opacity-50',
          )
        "
        @click="open"
        @dragstart="startDrag"
        @dragend="endDrag"
      >
        <span class="flex size-3.5 shrink-0 items-center justify-center">
          <Spinner v-if="state() === 'running'" class="size-3 text-primary" />
          <span v-else-if="state() === 'waiting'" class="pulse-ring size-2 rounded-full bg-warning" />
          <span v-else-if="state() === 'unread'" class="size-2 rounded-full bg-primary" />
          <span v-else-if="state() === 'error'" class="size-2 rounded-full bg-destructive" />
          <ProviderIcon v-else :provider="meta.provider" class="size-3 opacity-60" />
        </span>
        <span class="min-w-0 flex-1 truncate">{{ meta.title }}</span>
        <span v-if="place" class="max-w-[30%] shrink truncate text-[0.7rem] text-muted-foreground/80" :title="meta.cwd">{{ place }}</span>
        <!-- Up there under „Angeheftet“ the pin would say it twice. -->
        <PinIcon v-else-if="meta.pinned" class="size-3 shrink-0 text-muted-foreground" />
        <CalendarClockIcon
          v-if="meta.scheduledTask"
          v-tooltip="`Geplante Aufgabe: ${meta.scheduledTask.name}`"
          aria-label="Von einer geplanten Aufgabe"
          class="size-3 shrink-0 text-muted-foreground"
        />
        <SquareArrowOutUpRightIcon
          v-if="ownWindow"
          v-tooltip="'In eigenem Fenster: Klicken holt es nach vorn'"
          aria-label="In eigenem Fenster"
          class="size-3 shrink-0 text-muted-foreground"
        />
        <AccountDot v-if="account" v-tooltip="`Account: ${account.name}`" :color="account.color" class="size-1.5 ring-1" />
        <span class="shrink-0 text-[0.7rem] text-muted-foreground tabular-nums">{{ formatAge(meta.updatedAt, now) }}</span>
      </button>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-56">
      <ContextMenuItem @select="rename"><PencilIcon /> Umbenennen</ContextMenuItem>
      <ContextMenuItem @select="chat.popOut(meta)">
        <SquareArrowOutUpRightIcon /> {{ ownWindow ? 'Fenster des Chats zeigen' : 'In eigenem Fenster öffnen' }}
      </ContextMenuItem>
      <ContextMenuItem @select="sessions.update(meta.id, { pinned: !meta.pinned })">
        <component :is="meta.pinned ? PinOffIcon : PinIcon" /> {{ meta.pinned ? 'Lösen' : 'Anheften' }}
      </ContextMenuItem>
      <SessionMoveMenu :meta="meta" />
      <ContextMenuItem :disabled="chat.working(meta.id)" @select="chat.fork(meta.id)"><GitForkIcon /> Abzweigen</ContextMenuItem>
      <ContextMenuItem @select="sessions.update(meta.id, { archived: true })"><ArchiveIcon /> Archivieren</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="chat.copyLastAnswer(meta.id)"><CopyIcon /> Letzte Antwort kopieren</ContextMenuItem>
      <ContextMenuItem @select="chat.exportMarkdown(meta.id)"><FileDownIcon /> Als Markdown speichern …</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem class="text-destructive" @select="remove"><Trash2Icon /> Löschen</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
