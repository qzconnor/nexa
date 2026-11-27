<script setup lang="ts">
import {
  ArrowRightIcon,
  BrushCleaningIcon,
  ChevronRightIcon,
  CircleStopIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderTreeIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  ScrollTextIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import { isSectionRoot, layoutOf, moveProject, sectionIdOf } from '@shared/sections'
import { startCommandLabel } from '@shared/start-commands'
import type { StartCommand } from '@shared/types'
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
import { report } from '@/composables/useChatRemoval'
import { useClaudeManager } from '@/composables/useClaudeManager'
import { useSessionDrag } from '@/composables/useSessionDrag'
import { useSidebarFold } from '@/composables/useSidebarFold'
import { worktreeNote } from '@/lib/chat-cleanup'
import { attempt } from '@/lib/errors'
import { chatsIn, type ProjectEntry } from '@/lib/session-tree'
import { cn } from '@/lib/utils'
import { useDevice } from '@/stores/device'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useStartCommandsStore } from '@/stores/start-commands'
import { useUiStore } from '@/stores/ui'
import SidebarFolder from './SidebarFolder.vue'
import SidebarGroupState from './SidebarGroupState.vue'
import SidebarSession from './SidebarSession.vue'

/**
 * A project in the sidebar with its chats, in the folders they work in. `bare`: the chats only, for the
 * project of a separator's own folder, which the separator's heading stands for.
 */
const props = defineProps<{ entry: ProjectEntry; now: number; bare?: boolean; draggable?: boolean }>()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const startCommands = useStartCommandsStore()
const claudeManager = useClaudeManager()
const drag = useSessionDrag()
/** A project of another device: what works on this device's folders, dialogs and commands isn't offered. */
const device = useDevice()

const LIMIT = 8
const showAll = ref(false)
const project = computed(() => props.entry.project)
const fold = useSidebarFold()
const open = computed(() => props.bare || fold.isOpen('project', project.value.id, !project.value.collapsed))
const toggle = () =>
  fold.toggle('project', project.value.id, () => void attempt(() => projects.update(project.value.id, { collapsed: !project.value.collapsed })))
const shown = computed(() => (showAll.value ? props.entry.tree.sessions : props.entry.tree.sessions.slice(0, LIMIT)))
const otherSections = computed(() => projects.sections.filter((s) => s.id !== sectionIdOf(project.value, projects.sections)))
/** A separator for its folder makes sense once, and not for the project a separator stands for already. */
const canBecomeSection = computed(() => !projects.sections.some((s) => isSectionRoot(project.value, s)))
// Start commands run on this device, for its own projects.
const commands = computed(() => (device ? [] : startCommands.commandsOf(project.value.id)))
/** „dev läuft“: start commands keep running while other projects' chats are on screen. */
const runningText = computed(() => (device ? '' : startCommands.runningText(project.value.id)))

function toggleCommand(command: StartCommand): void {
  if (startCommands.isRunning(project.value.id, command.id)) void startCommands.stop(project.value.id, command.id)
  else void startCommands.start(project.value.id, command.id)
}

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
  // Archived ones too: they go with the project.
  const own = sessions.metas.filter((m) => m.projectId === project.value.id)
  const count = own.length
  const chats = count === 1 ? 'Sein Chat wird' : `Seine ${count} Chats werden`
  const cli = settings.settings.chat.deleteCliConversations ? `, ${count === 1 ? 'seine Unterhaltung' : 'ihre Unterhaltungen'} der CLIs ${count === 1 ? 'kommt' : 'kommen'} in den Papierkorb` : ''
  const worktrees = worktreeNote(own.filter((m) => m.worktree).length)
  if (
    !(await ui.confirm({
      title: `Projekt „${project.value.name}“ entfernen?`,
      description: `${count ? `${chats} gelöscht${cli}. ` : ''}Der Ordner auf der Festplatte bleibt.${worktrees ? ` ${worktrees}` : ''}`,
      confirmText: 'Entfernen',
      destructive: true,
    }))
  )
    return
  const result = await attempt(() => projects.remove(project.value.id), 'Entfernen fehlgeschlagen')
  if (!result) return
  sessions.forget(result.removed)
  report(result, !device)
  if (!sessions.activeId && ui.view === 'chat') ui.view = 'home'
}

function moveTo(sectionId: string): void {
  void attempt(() => projects.arrange(moveProject(layoutOf(projects.projects, projects.sections), project.value.id, sectionId, null)), 'Verschieben ging nicht')
}

async function toSection(): Promise<void> {
  if (
    !(await ui.confirm({
      title: `„${project.value.name}“ zum Trenner machen?`,
      description: `Der Ordner wird ein Trenner${claudeManager.installed.value ? ' wie die Workspaces im Claude Manager' : ''}: Seine Unterordner mit Chats werden Projekte darunter, die Chats im Ordner selbst stehen direkt unter dem Trenner. Jeder Chat arbeitet weiter im selben Ordner.`,
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
  <div
    :data-drop-project="project.id"
    :data-list-group="bare ? undefined : ''"
    :class="cn('flex flex-col rounded-lg', !bare && drag?.isTarget(project.id) && 'bg-primary/10 ring-1 ring-primary/50')"
  >
    <ContextMenu v-if="!bare">
      <ContextMenuTrigger as-child>
        <div data-drag-row class="group/project flex items-center rounded-lg hover:bg-sidebar-accent/60" :draggable="draggable">
          <button
            type="button"
            data-list-row
            :aria-expanded="open"
            class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[0.85rem]"
            :title="project.path"
            @click="toggle"
          >
            <ChevronRightIcon :class="cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')" />
            <component :is="open ? FolderOpenIcon : FolderIcon" class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate font-medium">{{ project.name }}</span>
            <SquareTerminalIcon v-if="runningText" v-tooltip="`Startbefehle: ${runningText}`" class="size-3 shrink-0 text-(--tool-run)" />
            <SidebarGroupState v-if="!open" :chats="chatsIn(entry.tree)" class="ml-auto" />
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
        <template v-if="!device">
          <ContextMenuItem @select="newChatInFolder"><FolderInputIcon /> Neuer Chat in Unterordner …</ContextMenuItem>
          <ContextMenuItem @select="ui.worktreeRequest = { projectId: project.id, folder: project.path }">
            <FolderGit2Icon /> Neuer Chat in Worktree …
          </ContextMenuItem>
          <ContextMenuItem @select="openFolder"><FolderOpenIcon /> Ordner öffnen</ContextMenuItem>
        </template>
        <ContextMenuItem @select="rename"><PencilIcon /> Umbenennen</ContextMenuItem>
        <ContextMenuItem v-if="!device" @select="ui.promptTarget = { kind: 'project', id: project.id }"><ScrollTextIcon /> Prompt …</ContextMenuItem>
        <ContextMenuSub v-if="commands.length && !device">
          <ContextMenuSubTrigger><SquareTerminalIcon /> Startbefehle</ContextMenuSubTrigger>
          <ContextMenuSubContent class="w-56">
            <ContextMenuItem v-for="c in commands" :key="c.id" @select="toggleCommand(c)">
              <template v-if="startCommands.isRunning(project.id, c.id)">
                <CircleStopIcon /> <span class="truncate">„{{ startCommandLabel(c) }}“ beenden</span>
              </template>
              <template v-else>
                <PlayIcon /> <span class="truncate">„{{ startCommandLabel(c) }}“ starten</span>
              </template>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem @select="ui.startCommandsProject = project.id"><PencilIcon /> Bearbeiten …</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem v-else-if="!device" @select="ui.startCommandsProject = project.id"><SquareTerminalIcon /> Startbefehle …</ContextMenuItem>
        <ContextMenuSub v-if="otherSections.length">
          <ContextMenuSubTrigger><ArrowRightIcon /> Verschieben nach</ContextMenuSubTrigger>
          <ContextMenuSubContent class="w-48">
            <ContextMenuItem v-for="section in otherSections" :key="section.id" @select="moveTo(section.id)">{{ section.name }}</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem v-if="canBecomeSection && !device" @select="toSection"><FolderTreeIcon /> Zum Trenner machen …</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem v-if="!device" @select="ui.cleanupProject = project.id"><BrushCleaningIcon /> Chats aufräumen …</ContextMenuItem>
        <ContextMenuItem class="text-destructive" @select="remove"><Trash2Icon /> Aus Nexa entfernen</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <div v-if="open" :class="cn('flex flex-col gap-px', !bare && 'pl-5')">
      <SidebarFolder v-for="folder in entry.tree.folders" :key="folder.id" :node="folder" :project="project" :now="now" :limit="LIMIT" />
      <SidebarSession v-for="meta in shown" :key="meta.id" :meta="meta" :now="now" />
      <button
        v-if="entry.tree.sessions.length > LIMIT"
        type="button"
        data-list-row
        class="rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Weniger anzeigen' : `${entry.tree.sessions.length - LIMIT} weitere` }}
      </button>
      <p v-if="!bare && !entry.count" class="px-2 py-1 text-xs text-muted-foreground">Noch keine Chats</p>
    </div>
  </div>
</template>
