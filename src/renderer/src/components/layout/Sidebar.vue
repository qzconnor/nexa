<script setup lang="ts">
import {
  ArchiveIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
} from '@lucide/vue'
import { computed, ref } from 'vue'
import type { Project, SessionMeta } from '@shared/types'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { attempt } from '@/lib/errors'
import { formatAge } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'

/**
 * Projects with their chats, as in Claude: a new chat, search, every project folded open with its
 * sessions (pinned first, then the latest), their state at a glance.
 */
const projects = useProjectsStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const updates = useUpdatesStore()

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
const query = ref('')
const showAll = ref(new Set<string>())
const LIMIT = 8

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return projects.projects
    .map((project) => {
      let list = sessions.byProject(project.id)
      if (q) list = list.filter((s) => s.title.toLowerCase().includes(q) || s.preview?.toLowerCase().includes(q))
      list = [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt)
      return { project, sessions: list }
    })
    .filter((group) => !q || group.sessions.length > 0 || group.project.name.toLowerCase().includes(q))
})

function state(meta: SessionMeta): 'running' | 'waiting' | 'unread' | 'error' | null {
  const status = sessions.runtime(meta.id).status
  if (status === 'running' || status === 'starting') return 'running'
  if (status === 'waiting') return 'waiting'
  if (status === 'error') return 'error'
  return sessions.unread.has(meta.id) ? 'unread' : null
}

async function openSession(meta: SessionMeta): Promise<void> {
  ui.view = 'chat'
  await attempt(() => sessions.open(meta.id), 'Session ließ sich nicht öffnen')
}

async function newChat(project?: Project): Promise<void> {
  if (!project) {
    ui.homeProjectId = null
    sessions.close()
    ui.view = 'home'
    return
  }
  const meta = await attempt(() => sessions.create({ projectId: project.id }), 'Neuer Chat ging nicht')
  if (meta) ui.view = 'chat'
}

async function addProject(): Promise<void> {
  const path = await window.api.app.pickDirectory(settings.settings.defaults.projectsFolder || undefined)
  if (!path) return
  const project = await attempt(() => projects.create({ path }), 'Projekt ließ sich nicht anlegen')
  if (project) {
    ui.homeProjectId = project.id
    sessions.close()
    ui.view = 'home'
  }
}

function rename(meta: SessionMeta): void {
  const title = prompt('Neuer Name', meta.title)
  if (title?.trim()) void attempt(() => sessions.update(meta.id, { title: title.trim() }))
}

function renameProject(project: Project): void {
  const name = prompt('Neuer Name des Projekts', project.name)
  if (name?.trim()) void attempt(() => projects.update(project.id, { name: name.trim() }))
}

async function removeSession(meta: SessionMeta): Promise<void> {
  if (!(await ui.confirm({ title: `„${meta.title}“ löschen?`, description: 'Der Verlauf in Nexa geht verloren.', confirmText: 'Löschen', destructive: true }))) return
  await attempt(() => sessions.remove(meta.id), 'Löschen fehlgeschlagen')
  if (!sessions.activeId && ui.view === 'chat') ui.view = 'home'
}

async function removeProject(project: Project): Promise<void> {
  const count = sessions.byProject(project.id).length
  if (
    !(await ui.confirm({
      title: `Projekt „${project.name}“ entfernen?`,
      description: `${count ? `Seine ${count} Chats werden gelöscht. ` : ''}Der Ordner auf der Festplatte bleibt.`,
      confirmText: 'Entfernen',
      destructive: true,
    }))
  )
    return
  await attempt(() => projects.remove(project.id), 'Entfernen fehlgeschlagen')
  if (!sessions.activeId && ui.view === 'chat') ui.view = 'home'
}

function toggleShowAll(id: string): void {
  const next = new Set(showAll.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  showAll.value = next
}

const openFolder = (path: string) => void window.api.app.openPath(path)
</script>

<template>
  <aside class="flex h-full w-(--sidebar-width) shrink-0 flex-col">
    <div class="flex flex-col gap-1 p-2">
      <Button variant="ghost" class="justify-start gap-2 px-2.5" @click="newChat()">
        <SquarePenIcon />
        Neuer Chat
      </Button>
      <div class="relative">
        <SearchIcon class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="query"
          placeholder="Chats durchsuchen"
          class="h-8 w-full rounded-lg bg-transparent pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground hover:bg-sidebar-accent/60 focus:bg-sidebar-accent"
        />
      </div>
    </div>

    <div class="flex items-center justify-between px-4 pt-2 pb-1 text-[0.72rem] font-medium tracking-wide text-muted-foreground uppercase">
      Projekte
      <Button variant="ghost" size="icon-xs" aria-label="Projekt hinzufügen" @click="addProject">
        <FolderPlusIcon />
      </Button>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <p v-if="!projects.projects.length" class="px-2 py-3 text-xs text-muted-foreground">
        Noch keine Projekte. Ein Projekt ist ein Ordner, in dem die Agents arbeiten.
      </p>
      <div v-for="group in filtered" :key="group.project.id" class="mb-1">
        <ContextMenu>
          <ContextMenuTrigger as-child>
            <div class="group/project flex items-center rounded-lg hover:bg-sidebar-accent/60">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-[0.85rem]"
                :title="group.project.path"
                @click="projects.update(group.project.id, { collapsed: !group.project.collapsed })"
              >
                <ChevronRightIcon :class="cn('size-3.5 shrink-0 text-muted-foreground transition-transform', !group.project.collapsed && 'rotate-90')" />
                <component :is="group.project.collapsed ? FolderIcon : FolderOpenIcon" class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="truncate font-medium">{{ group.project.name }}</span>
                <PinIcon v-if="group.project.pinned" class="size-3 shrink-0 text-muted-foreground" />
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                class="mr-1 opacity-0 group-hover/project:opacity-100 focus-visible:opacity-100"
                :aria-label="`Neuer Chat in ${group.project.name}`"
                @click="newChat(group.project)"
              >
                <PlusIcon />
              </Button>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent class="w-56">
            <ContextMenuItem @select="newChat(group.project)"><PlusIcon /> Neuer Chat</ContextMenuItem>
            <ContextMenuItem @select="openFolder(group.project.path)"><FolderOpenIcon /> Ordner öffnen</ContextMenuItem>
            <ContextMenuItem @select="renameProject(group.project)"><PencilIcon /> Umbenennen</ContextMenuItem>
            <ContextMenuItem @select="projects.update(group.project.id, { pinned: !group.project.pinned })">
              <component :is="group.project.pinned ? PinOffIcon : PinIcon" /> {{ group.project.pinned ? 'Lösen' : 'Anheften' }}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem class="text-destructive" @select="removeProject(group.project)"><Trash2Icon /> Aus Nexa entfernen</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <div v-if="!group.project.collapsed || query" class="flex flex-col gap-px pl-5">
          <ContextMenu v-for="meta in showAll.has(group.project.id) || query ? group.sessions : group.sessions.slice(0, LIMIT)" :key="meta.id">
            <ContextMenuTrigger as-child>
              <button
                type="button"
                :class="
                  cn(
                    'group/session flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.85rem] transition-colors hover:bg-sidebar-accent/60',
                    sessions.activeId === meta.id && ui.view === 'chat' && 'bg-sidebar-accent font-medium',
                  )
                "
                @click="openSession(meta)"
              >
                <span class="flex size-3.5 shrink-0 items-center justify-center">
                  <Spinner v-if="state(meta) === 'running'" class="size-3 text-primary" />
                  <span v-else-if="state(meta) === 'waiting'" class="pulse-ring size-2 rounded-full bg-warning" />
                  <span v-else-if="state(meta) === 'unread'" class="size-2 rounded-full bg-primary" />
                  <span v-else-if="state(meta) === 'error'" class="size-2 rounded-full bg-destructive" />
                  <ProviderIcon v-else :provider="meta.provider" class="size-3 opacity-60" />
                </span>
                <span class="min-w-0 flex-1 truncate">{{ meta.title }}</span>
                <PinIcon v-if="meta.pinned" class="size-3 shrink-0 text-muted-foreground" />
                <span class="shrink-0 text-[0.7rem] text-muted-foreground tabular-nums">{{ formatAge(meta.updatedAt, now) }}</span>
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent class="w-52">
              <ContextMenuItem @select="rename(meta)"><PencilIcon /> Umbenennen</ContextMenuItem>
              <ContextMenuItem @select="sessions.update(meta.id, { pinned: !meta.pinned })">
                <component :is="meta.pinned ? PinOffIcon : PinIcon" /> {{ meta.pinned ? 'Lösen' : 'Anheften' }}
              </ContextMenuItem>
              <ContextMenuItem @select="sessions.update(meta.id, { archived: true })"><ArchiveIcon /> Archivieren</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem class="text-destructive" @select="removeSession(meta)"><Trash2Icon /> Löschen</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <button
            v-if="!query && group.sessions.length > LIMIT"
            type="button"
            class="rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
            @click="toggleShowAll(group.project.id)"
          >
            {{ showAll.has(group.project.id) ? 'Weniger anzeigen' : `${group.sessions.length - LIMIT} weitere` }}
          </button>
          <p v-if="!group.sessions.length && !query" class="px-2 py-1 text-xs text-muted-foreground">Noch keine Chats</p>
        </div>
      </div>
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
