<script setup lang="ts">
import { ChevronRightIcon, FolderOpenIcon, FolderPlusIcon, PencilIcon, PlusIcon, SettingsIcon, SquarePenIcon, Trash2Icon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { folderKey } from '@shared/folders'
import { DEFAULT_SECTION_ID, isSectionRoot, layoutOf, moveProject, moveSection, sectionIdOf } from '@shared/sections'
import type { ProjectSection } from '@shared/types'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useChatActions } from '@/composables/useChatActions'
import { useClock } from '@/composables/useClock'
import { provideSessionDrag } from '@/composables/useSessionDrag'
import { attempt } from '@/lib/errors'
import { foldersOf, projectTree, type ProjectEntry } from '@/lib/session-tree'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import SidebarProject from './SidebarProject.vue'

/**
 * Projects with their chats, as in Claude, under separators like the workspaces of the Claude Manager:
 * a new chat, the separators with their projects in the order the user dragged them into, every
 * project with its sessions (pinned first, then the latest) and their state at a glance.
 */
const projects = useProjectsStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const updates = useUpdatesStore()
const chat = useChatActions()

/**
 * The updates are a section of the settings: a waiting update pulses on their button, release notes
 * still unread after an update get a dot. Either way the button then opens the updates.
 */
const settingsHint = computed(() =>
  updates.hasUpdate
    ? `Version ${updates.state.next} ist verfügbar`
    : updates.unseen
      ? `Neu in Version ${updates.state.current}`
      : null,
)
const openSettings = () => ui.openSettings(updates.hasUpdate || updates.unseen ? 'updates' : undefined)
const now = useClock(60_000)

interface SectionGroup {
  section: ProjectSection
  /** The project of the separator's own folder: its chats show right below the heading. */
  root: ProjectEntry | null
  projects: ProjectEntry[]
  /** The chats under the separator. */
  count: number
}

/** Every separator with its projects and their chats, in the folders they work in (lib/session-tree.ts). */
const groups = computed<SectionGroup[]>(() => {
  const entries = projects.projects.map((project): ProjectEntry => {
    const list = sessions.byProject(project.id)
    return { project, count: list.length, tree: projectTree(project.id, project.path, list) }
  })
  return projects.sections.map((section) => {
    const own = entries.filter((e) => sectionIdOf(e.project, projects.sections) === section.id)
    const root = own.find((e) => isSectionRoot(e.project, section)) ?? null
    return { section, root, projects: own.filter((e) => e !== root), count: own.reduce((sum, e) => sum + e.count, 0) }
  })
})

// The folders of the chat on screen open, so it shows where it is (also when opened from elsewhere).
watch(
  () => sessions.active,
  (meta) => {
    const project = meta?.cwd ? projects.get(meta.projectId) : undefined
    if (!meta || !project) return
    for (const id of foldersOf(projectTree(project.id, project.path, sessions.byProject(project.id)), meta.id)) ui.toggleFolder(id, true)
  },
)

const newChat = () => chat.newChat()
/** The start page is where a new chat begins: its button shows it as the page on screen, as a chat's row does. */
const onStartPage = computed(() => !(ui.view === 'chat' && sessions.active) && settings.settings.setup.done)

/** The folder a separator stands for, as the Claude Manager shows a workspace: where it lies. */
function parentOf(section: ProjectSection): string | null {
  return section.path ? section.path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '') || null : null
}

async function addProject(section: ProjectSection): Promise<void> {
  const path = await window.api.app.pickDirectory(section.path ?? (settings.settings.defaults.projectsFolder || undefined))
  if (!path) return
  const project = await attempt(() => projects.create({ path, sectionId: section.id }), 'Projekt ließ sich nicht anlegen')
  if (project) {
    ui.homeProjectId = project.id
    sessions.close()
    ui.view = 'home'
  }
}

/** A chat in the separator's own folder, whose project comes about with it. */
async function newChatInSection(section: ProjectSection): Promise<void> {
  if (!section.path) return
  const root = projects.projects.find((p) => isSectionRoot(p, section))
  const meta = await attempt(async () => {
    const project = root ?? (await projects.create({ path: section.path!, sectionId: section.id }))
    return sessions.create({ projectId: project.id })
  }, 'Neuer Chat ging nicht')
  if (meta) ui.view = 'chat'
}

async function newSection(after?: ProjectSection): Promise<void> {
  const name = await ui.ask({ title: 'Neuer Trenner', input: { placeholder: 'Name, z. B. Kunden' }, confirmText: 'Anlegen' })
  if (name) await attempt(() => projects.createSection({ name, after: after?.id }), 'Trenner ließ sich nicht anlegen')
}

async function renameSection(section: ProjectSection): Promise<void> {
  const name = await ui.ask({ title: 'Trenner umbenennen', input: { value: section.name }, confirmText: 'Umbenennen' })
  if (name && name !== section.name) await attempt(() => projects.updateSection(section.id, { name }))
}

async function removeSection(section: ProjectSection): Promise<void> {
  const count = projects.projects.filter((p) => sectionIdOf(p, projects.sections) === section.id).length
  const fallback = projects.sections.find((s) => s.id === DEFAULT_SECTION_ID)?.name ?? 'Projekte'
  if (
    !(await ui.confirm({
      title: `Trenner „${section.name}“ entfernen?`,
      description: count ? `Seine Projekte kommen unter „${fallback}“, ihre Chats bleiben.` : undefined,
      confirmText: 'Entfernen',
      destructive: true,
    }))
  )
    return
  await attempt(() => projects.removeSection(section.id), 'Entfernen fehlgeschlagen')
}

const openFolder = (path: string) => void window.api.app.openPath(path)

// Drag and drop ------------------------------------------------------------------------------
// Projects move within and between separators, separators among themselves. The line shows where.
// A chat moves into another project or a folder in it, which lights up.

const sessionDrag = provideSessionDrag()

type Drag = { kind: 'project' | 'section'; id: string }
type Drop = { kind: 'project'; section: string; before: string | null } | { kind: 'section'; before: string | null }

const drag = ref<Drag | null>(null)
const drop = ref<Drop | null>(null)
const nav = ref<HTMLElement | null>(null)

function startDrag(event: DragEvent, kind: Drag['kind'], id: string): void {
  if (!event.dataTransfer) return
  // A project moves by its row only, not by a chat or folder below it.
  if (kind === 'project' && !(event.target as HTMLElement).closest?.('[data-drag-row]')) return
  drag.value = { kind, id }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', id)
}

function endDrag(): void {
  drag.value = null
  drop.value = null
}

/** Accepts the drop here; a target that would change nothing shows no line. */
function target(event: DragEvent, next: Drop): void {
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  drop.value = next.before === drag.value?.id ? null : next
}

/** Over a project: before it in its upper half, else after it. */
function overProject(event: DragEvent, group: SectionGroup, index: number): void {
  if (drag.value?.kind !== 'project') return
  const row = (event.currentTarget as HTMLElement).querySelector('[data-drag-row]') ?? (event.currentTarget as HTMLElement)
  const rect = row.getBoundingClientRect()
  const upper = event.clientY < rect.top + rect.height / 2
  const before = upper ? group.projects[index]!.project.id : (group.projects[index + 1]?.project.id ?? null)
  target(event, { kind: 'project', section: group.section.id, before })
}

/** Over a separator's heading or its own chats: first under it. */
function overTop(event: DragEvent, group: SectionGroup): void {
  if (drag.value?.kind !== 'project') return
  target(event, { kind: 'project', section: group.section.id, before: group.projects[0]?.project.id ?? null })
}

/** Over a separator with a separator: before it in the upper half of its heading, else after it. */
function overSection(event: DragEvent, index: number): void {
  if (drag.value?.kind === 'project') {
    // Somewhere under the separator but not on a project (an empty one, the gap at its end): last under it.
    target(event, { kind: 'project', section: groups.value[index]!.section.id, before: null })
    return
  }
  if (drag.value?.kind !== 'section') return
  const head = (event.currentTarget as HTMLElement).querySelector('[data-section-head]')!.getBoundingClientRect()
  const upper = event.clientY < head.top + head.height / 2
  target(event, { kind: 'section', before: upper ? groups.value[index]!.section.id : (groups.value[index + 1]?.section.id ?? null) })
}

function leaveNav(event: DragEvent): void {
  if (nav.value?.contains(event.relatedTarget as Node | null)) return
  drop.value = null
  sessionDrag.target.value = null
}

/**
 * A chat over a project (its row, its chats) goes to the project's own folder, over a folder in it
 * to that folder. Where it is already, it can't be dropped.
 */
function overChatTarget(event: DragEvent): void {
  const id = sessionDrag.dragging.value
  if (!id) return
  const at = event.target as HTMLElement
  const projectId = at.closest?.<HTMLElement>('[data-drop-project]')?.dataset.dropProject
  const cwd = at.closest?.<HTMLElement>('[data-drop-folder]')?.dataset.dropFolder
  const meta = sessions.get(id)
  const here = !!meta && meta.projectId === projectId && folderKey(meta.cwd ?? '') === folderKey(cwd ?? '')
  sessionDrag.target.value = projectId && !here ? { projectId, ...(cwd ? { cwd } : {}) } : null
  if (!sessionDrag.target.value) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
}

function dropHere(event: DragEvent): void {
  event.preventDefault()
  const chatId = sessionDrag.dragging.value
  if (chatId) {
    const to = sessionDrag.target.value
    sessionDrag.dragging.value = null
    sessionDrag.target.value = null
    const meta = sessions.get(chatId)
    if (meta && to) void chat.move(meta, { ...to })
    return
  }
  const moving = drag.value
  const where = drop.value
  endDrag()
  if (!moving || !where || where.before === moving.id) return
  const layout = layoutOf(projects.projects, projects.sections)
  const next =
    moving.kind === 'project' && where.kind === 'project'
      ? moveProject(layout, moving.id, where.section, where.before)
      : moving.kind === 'section' && where.kind === 'section'
        ? moveSection(layout, moving.id, where.before)
        : null
  if (next) void attempt(() => projects.arrange(next), 'Verschieben ging nicht')
}

/** Where the line shows: before a project (or at the end of a separator), before a separator (or after the last). */
const lineBeforeProject = (section: string, id: string | null) =>
  drop.value?.kind === 'project' && drop.value.section === section && drop.value.before === id
const lineBeforeSection = (id: string | null) => drop.value?.kind === 'section' && drop.value.before === id
</script>

<template>
  <aside class="flex h-full w-(--sidebar-width) shrink-0 flex-col">
    <div class="flex flex-col gap-1 p-2">
      <Button
        variant="ghost"
        :class="cn('justify-start gap-2 px-2.5', onStartPage && 'bg-sidebar-accent')"
        :aria-current="onStartPage ? 'page' : undefined"
        @click="newChat"
      >
        <SquarePenIcon />
        Neuer Chat
      </Button>
    </div>

    <nav ref="nav" class="min-h-0 flex-1 overflow-y-auto px-2 pb-2" @dragover="overChatTarget" @dragleave="leaveNav" @drop="dropHere">
      <section
        v-for="(group, index) in groups"
        :key="group.section.id"
        :class="cn('relative pb-1', drag?.id === group.section.id && 'opacity-50')"
        @dragover="overSection($event, index)"
      >
        <div v-if="lineBeforeSection(group.section.id)" class="pointer-events-none absolute inset-x-1 top-0.5 h-0.5 rounded-full bg-primary" />
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <!-- Stands for the project of the separator's own folder: a chat dropped here goes there. -->
            <div
              data-section-head
              :data-drop-project="group.root?.project.id"
              :class="
                cn(
                  'group/section flex items-center gap-1 rounded-lg pt-2.5 pr-1 pb-1 pl-2',
                  group.root && sessionDrag.isTarget(group.root.project.id) && 'bg-primary/10 ring-1 ring-primary/50',
                )
              "
              draggable="true"
              @dragstart="startDrag($event, 'section', group.section.id)"
              @dragend="endDrag"
              @dragover="drag?.kind === 'project' && overTop($event, group)"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                :title="group.section.path"
                @click="projects.updateSection(group.section.id, { collapsed: !group.section.collapsed })"
              >
                <span class="shrink-0 truncate text-[0.72rem] font-medium tracking-wide text-muted-foreground uppercase">{{ group.section.name }}</span>
                <!-- Cut at the start: the end of a path tells it apart. -->
                <span v-if="parentOf(group.section)" class="min-w-0 truncate text-[0.7rem] text-muted-foreground/70" dir="rtl">
                  <bdi dir="ltr">{{ parentOf(group.section) }}</bdi>
                </span>
                <ChevronRightIcon
                  :class="
                    cn(
                      'size-3 shrink-0 text-muted-foreground transition-[transform,opacity]',
                      !group.section.collapsed && 'rotate-90 opacity-0 group-hover/section:opacity-100',
                    )
                  "
                />
              </button>
              <span v-if="group.count" class="text-[0.7rem] text-muted-foreground/70 tabular-nums">{{ group.count }}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                :class="group.section.id !== DEFAULT_SECTION_ID && 'opacity-0 group-hover/section:opacity-100 focus-visible:opacity-100'"
                :aria-label="`Projekt zu ${group.section.name} hinzufügen`"
                v-tooltip="'Projekt hinzufügen'"
                @click="addProject(group.section)"
              >
                <FolderPlusIcon />
              </Button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent class="w-56">
            <ContextMenuItem @select="addProject(group.section)"><FolderPlusIcon /> Projekt hinzufügen …</ContextMenuItem>
            <template v-if="group.section.path">
              <ContextMenuItem @select="newChatInSection(group.section)"><PlusIcon /> Neuer Chat im Ordner</ContextMenuItem>
              <ContextMenuItem @select="openFolder(group.section.path)"><FolderOpenIcon /> Ordner öffnen</ContextMenuItem>
            </template>
            <ContextMenuItem @select="renameSection(group.section)"><PencilIcon /> Umbenennen</ContextMenuItem>
            <ContextMenuItem @select="newSection(group.section)"><PlusIcon /> Neuer Trenner</ContextMenuItem>
            <template v-if="group.section.id !== DEFAULT_SECTION_ID">
              <ContextMenuSeparator />
              <ContextMenuItem class="text-destructive" @select="removeSection(group.section)"><Trash2Icon /> Trenner entfernen</ContextMenuItem>
            </template>
          </ContextMenuContent>
        </ContextMenu>

        <div v-if="!group.section.collapsed" class="flex flex-col gap-px">
          <div v-if="group.root" @dragover="overTop($event, group)">
            <SidebarProject :entry="group.root" :now="now" bare />
          </div>
          <div
            v-for="(entry, i) in group.projects"
            :key="entry.project.id"
            :class="cn('relative', drag?.id === entry.project.id && 'opacity-50')"
            @dragstart="startDrag($event, 'project', entry.project.id)"
            @dragend="endDrag"
            @dragover="overProject($event, group, i)"
          >
            <div v-if="lineBeforeProject(group.section.id, entry.project.id)" class="pointer-events-none absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" />
            <SidebarProject :entry="entry" :now="now" draggable />
          </div>
          <div v-if="lineBeforeProject(group.section.id, null)" class="pointer-events-none mx-1 h-0.5 rounded-full bg-primary" />
          <p v-if="!group.root && !group.projects.length" class="px-2 py-1 text-xs text-muted-foreground">
            {{
              group.section.id === DEFAULT_SECTION_ID && !projects.projects.length
                ? 'Noch keine Projekte. Ein Projekt ist ein Ordner, in dem die Agents arbeiten.'
                : 'Noch keine Projekte. Zieh eins hierher.'
            }}
          </p>
        </div>
        <div v-if="index === groups.length - 1 && lineBeforeSection(null)" class="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-primary" />
      </section>

      <button
        type="button"
        class="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
        @click="newSection()"
      >
        <PlusIcon class="size-3.5" />
        Neuer Trenner
      </button>
    </nav>

    <div class="flex flex-col gap-0.5 p-2">
      <Button
        variant="ghost"
        :class="cn('justify-start gap-2 px-2.5', ui.settingsOpen && 'bg-sidebar-accent')"
        v-tooltip.right="settingsHint"
        @click="openSettings"
      >
        <SettingsIcon />
        <span class="flex-1 text-left">Einstellungen</span>
        <span v-if="updates.hasUpdate" class="relative mr-1 flex size-2" aria-hidden="true">
          <span class="absolute size-full animate-ping rounded-full bg-success opacity-75" />
          <span class="relative size-2 rounded-full bg-success" />
        </span>
        <span v-else-if="updates.unseen" class="mr-1 size-2 rounded-full bg-success" aria-hidden="true" />
      </Button>
    </div>
  </aside>
</template>
