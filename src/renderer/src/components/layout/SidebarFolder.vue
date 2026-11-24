<script setup lang="ts">
import { ChevronRightIcon, FolderIcon, FolderOpenIcon, PlusIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { Project } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useSessionDrag } from '@/composables/useSessionDrag'
import { attempt } from '@/lib/errors'
import { chatsIn, type FolderNode } from '@/lib/session-tree'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import SidebarGroupState from './SidebarGroupState.vue'
import SidebarSession from './SidebarSession.vue'

/** A folder in a project that chats work in, with the folders below it and its own chats. */
const props = defineProps<{ node: FolderNode; project: Project; now: number; limit: number }>()
const sessions = useSessionsStore()
const ui = useUiStore()
const drag = useSessionDrag()

const open = computed(() => ui.openFolders.has(props.node.id))
const showAll = ref(false)
const shown = computed(() => (showAll.value ? props.node.sessions : props.node.sessions.slice(0, props.limit)))

const openFolder = () => void window.api.app.openPath(props.node.path)

async function newChat(): Promise<void> {
  const meta = await attempt(() => sessions.create({ projectId: props.project.id, cwd: props.node.path }), 'Neuer Chat ging nicht')
  if (meta) {
    ui.toggleFolder(props.node.id, true)
    ui.view = 'chat'
  }
}
</script>

<template>
  <!-- A chat dropped on the folder or what is in it works in this folder (see Sidebar). -->
  <div :data-drop-folder="node.path" data-list-group :class="cn('flex flex-col gap-px rounded-lg', drag?.isTarget(project.id, node.path) && 'bg-primary/10 ring-1 ring-primary/50')">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div class="group/folder flex items-center rounded-lg hover:bg-sidebar-accent/60">
          <button
            type="button"
            data-list-row
            class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[0.85rem] text-muted-foreground hover:text-foreground"
            :title="node.path"
            :aria-expanded="open"
            @click="ui.toggleFolder(node.id)"
          >
            <ChevronRightIcon :class="cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')" />
            <component :is="open ? FolderOpenIcon : FolderIcon" class="size-3.5 shrink-0" />
            <span class="truncate">{{ node.name }}</span>
            <span class="ml-auto flex shrink-0 items-center gap-1.5 pl-1">
              <SidebarGroupState v-if="!open" :chats="chatsIn(node)" />
              <span class="text-[0.7rem] tabular-nums group-hover/folder:hidden">{{ node.count }}</span>
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            class="mr-1 hidden group-hover/folder:inline-flex focus-visible:inline-flex"
            :aria-label="`Neuer Chat in ${node.name}`"
            @click="newChat"
          >
            <PlusIcon />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-52">
        <ContextMenuItem @select="newChat"><PlusIcon /> Neuer Chat hier</ContextMenuItem>
        <ContextMenuItem @select="openFolder"><FolderOpenIcon /> Ordner öffnen</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <div v-if="open" class="flex flex-col gap-px pl-4">
      <SidebarFolder v-for="folder in node.folders" :key="folder.id" :node="folder" :project="project" :now="now" :limit="limit" />
      <SidebarSession v-for="meta in shown" :key="meta.id" :meta="meta" :now="now" />
      <button
        v-if="node.sessions.length > limit"
        type="button"
        data-list-row
        class="rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Weniger anzeigen' : `${node.sessions.length - limit} weitere` }}
      </button>
    </div>
  </div>
</template>
