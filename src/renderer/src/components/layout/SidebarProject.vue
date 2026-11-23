<script setup lang="ts">
import {
  ArrowRightIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { isSectionRoot, layoutOf, moveProject, sectionIdOf } from '@shared/sections'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useSessionDrag } from '@/composables/useSessionDrag'
import { attempt } from '@/lib/errors'
import type { ProjectEntry } from '@/lib/session-tree'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import SidebarFolder from './SidebarFolder.vue'
import SidebarSession from './SidebarSession.vue'

/**
 * A project in the sidebar with its chats, in the folders they work in. `bare`: the chats only, for the
 * project of a separator's own folder, which the separator's heading stands for.
 */
const props = defineProps<{ entry: ProjectEntry; now: number; bare?: boolean; draggable?: boolean }>()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const drag = useSessionDrag()

const LIMIT = 8
const showAll = ref(false)
const project = computed(() => props.entry.project)
const open = computed(() => props.bare || !project.value.collapsed)
const shown = computed(() => (showAll.value ? props.entry.tree.sessions : props.entry.tree.sessions.slice(0, LIMIT)))
const otherSections = computed(() => projects.sections.filter((s) => s.id !== sectionIdOf(project.value, projects.sections)))
/** A separator for its folder makes sense once, and not for the project a separator stands for already. */
const canBecomeSection = computed(() => !projects.sections.some((s) => isSectionRoot(project.value, s)))

async function newChat(cwd?: string): Promise<void> {
  const meta = await attempt(() => sessions.create({ projectId: project.value.id, cwd }), 'Neuer Chat ging nicht')
  if (meta) ui.view = 'chat'
}

/** A new chat in a folder of the project, which the user picks. */
async function newChatInFolder(): Promise<void> {
  const path = await window.api.app.pickDirectory(project.value.path)
  if (path) await newChat(path)
}

async function rename(): Promise<void> {
  const name = await ui.ask({ title: 'Projekt umbenennen', input: { value: project.value.name }, confirmText: 'Umbenennen' })
  if (name && name !== project.value.name) await attempt(() => projects.update(project.value.id, { name }))
}

async function remove(): Promise<void> {
  const count = sessions.byProject(project.value.id).length
  if (
    !(await ui.confirm({
      title: `Projekt „${project.value.name}“ entfernen?`,
      description: `${count ? `Seine ${count} Chats werden gelöscht. ` : ''}Der Ordner auf der Festplatte bleibt.`,
      confirmText: 'Entfernen',
      destructive: true,
    }))
  )
    return
  await attempt(() => projects.remove(project.value.id), 'Entfernen fehlgeschlagen')
  if (!sessions.activeId && ui.view === 'chat') ui.view = 'home'
}

function moveTo(sectionId: string): void {
  void attempt(() => projects.arrange(moveProject(layoutOf(projects.projects, projects.sections), project.value.id, sectionId, null)), 'Verschieben ging nicht')
}

async function toSection(): Promise<void> {
  if (
    !(await ui.confirm({
      title: `„${project.value.name}“ zum Trenner machen?`,
      description:
        'Der Ordner wird ein Trenner wie die Workspaces im Claude Manager: Seine Unterordner mit Chats werden Projekte darunter, die Chats im Ordner selbst stehen direkt unter dem Trenner. Jeder Chat arbeitet weiter im selben Ordner.',
      confirmText: 'Zum Trenner machen',
    }))
  )
    return
  await attempt(() => projects.toSection(project.value.id), 'Umwandeln ging nicht')
}

const openFolder = () => void window.api.app.openPath(project.value.path)
</script>

<template>
  <!-- A chat dropped anywhere on the project goes to its own folder (see Sidebar); bare, the separator's heading lights up for it. -->
  <div :data-drop-project="project.id" :class="cn('flex flex-col rounded-lg', !bare && drag?.isTarget(project.id) && 'bg-primary/10 ring-1 ring-primary/50')">
    <ContextMenu v-if="!bare">
      <ContextMenuTrigger as-child>
        <div data-drag-row class="group/project flex items-center rounded-lg hover:bg-sidebar-accent/60" :draggable="draggable">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[0.85rem]"
            :title="project.path"
            @click="projects.update(project.id, { collapsed: !project.collapsed })"
          >
            <ChevronRightIcon :class="cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')" />
            <component :is="open ? FolderOpenIcon : FolderIcon" class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate font-medium">{{ project.name }}</span>
          </button>
          <!-- The number of chats, and on hover in its place the button for a new one. -->
          <span class="relative mr-1 flex size-6 shrink-0 items-center justify-center">
            <span v-if="entry.count" class="text-[0.7rem] text-muted-foreground tabular-nums transition-opacity group-hover/project:opacity-0">
              {{ entry.count }}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              class="absolute inset-0 opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100"
              :aria-label="`Neuer Chat in ${project.name}`"
              @click="newChat()"
            >
              <PlusIcon />
            </Button>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-60">
        <ContextMenuItem @select="newChat()"><PlusIcon /> Neuer Chat</ContextMenuItem>
        <ContextMenuItem @select="newChatInFolder"><FolderInputIcon /> Neuer Chat in Unterordner …</ContextMenuItem>
        <ContextMenuItem @select="openFolder"><FolderOpenIcon /> Ordner öffnen</ContextMenuItem>
        <ContextMenuItem @select="rename"><PencilIcon /> Umbenennen</ContextMenuItem>
        <ContextMenuSub v-if="otherSections.length">
          <ContextMenuSubTrigger><ArrowRightIcon /> Verschieben nach</ContextMenuSubTrigger>
          <ContextMenuSubContent class="w-48">
            <ContextMenuItem v-for="section in otherSections" :key="section.id" @select="moveTo(section.id)">{{ section.name }}</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem v-if="canBecomeSection" @select="toSection"><FolderTreeIcon /> Zum Trenner machen …</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem class="text-destructive" @select="remove"><Trash2Icon /> Aus Nexa entfernen</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <div v-if="open" :class="cn('flex flex-col gap-px', !bare && 'pl-5')">
      <SidebarFolder v-for="folder in entry.tree.folders" :key="folder.id" :node="folder" :project="project" :now="now" :limit="LIMIT" />
      <SidebarSession v-for="meta in shown" :key="meta.id" :meta="meta" :now="now" />
      <button
        v-if="entry.tree.sessions.length > LIMIT"
        type="button"
        class="rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Weniger anzeigen' : `${entry.tree.sessions.length - LIMIT} weitere` }}
      </button>
      <p v-if="!bare && !entry.count" class="px-2 py-1 text-xs text-muted-foreground">Noch keine Chats</p>
    </div>
  </div>
</template>
