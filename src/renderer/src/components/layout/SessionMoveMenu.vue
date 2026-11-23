<script setup lang="ts">
import { FolderIcon, FolderInputIcon, FolderSearchIcon, LayersIcon } from '@lucide/vue'
import { computed } from 'vue'
import { isSectionRoot, sectionIdOf } from '@shared/sections'
import type { Project, SessionMeta } from '@shared/types'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import { useChatActions } from '@/composables/useChatActions'
import { useProjectsStore } from '@/stores/projects'

/**
 * „Verschieben nach“ in the context menu of a chat, as in the Claude Manager: the projects under their
 * separators, or any folder. The chat goes on there with its conversation. Greyed out while it works.
 */
const props = defineProps<{ meta: SessionMeta }>()
const projects = useProjectsStore()
const chat = useChatActions()
const working = computed(() => chat.working(props.meta.id))

/** The separators with their projects in the sidebar's order, the one of the separator's own folder first. */
const groups = computed(() =>
  projects.sections
    .map((section) => {
      const own = projects.projects.filter((p) => sectionIdOf(p, projects.sections) === section.id)
      return { section, projects: [...own.filter((p) => isSectionRoot(p, section)), ...own.filter((p) => !isSectionRoot(p, section))] }
    })
    .filter((group) => group.projects.length),
)
/** With one separator its level would only be another click. */
const flat = computed(() => groups.value.length === 1)

/** The project's own folder is where the chat is already; from a folder in it, it can still go there. */
const here = (project: Project) => project.id === props.meta.projectId && !props.meta.cwd
const moveTo = (project: Project) => void chat.move(props.meta, { projectId: project.id })
</script>

<template>
  <ContextMenuSub>
    <ContextMenuSubTrigger :disabled="working">
      <FolderInputIcon />
      Verschieben nach
      <ContextMenuShortcut v-if="working" class="tracking-normal">arbeitet</ContextMenuShortcut>
    </ContextMenuSubTrigger>
    <ContextMenuSubContent class="max-h-[min(24rem,var(--reka-context-menu-content-available-height))] w-60 overflow-y-auto">
      <template v-if="flat">
        <ContextMenuItem v-for="project in groups[0]!.projects" :key="project.id" :disabled="here(project)" @select="moveTo(project)">
          <FolderIcon />
          <span class="min-w-0 truncate">{{ project.name }}</span>
          <ContextMenuShortcut v-if="here(project)" class="tracking-normal">hier</ContextMenuShortcut>
        </ContextMenuItem>
      </template>
      <template v-else>
        <ContextMenuSub v-for="group in groups" :key="group.section.id">
          <ContextMenuSubTrigger>
            <LayersIcon />
            <span class="min-w-0 truncate">{{ group.section.name }}</span>
          </ContextMenuSubTrigger>
          <ContextMenuSubContent class="max-h-[min(24rem,var(--reka-context-menu-content-available-height))] w-60 overflow-y-auto">
            <ContextMenuItem v-for="project in group.projects" :key="project.id" :disabled="here(project)" @select="moveTo(project)">
              <FolderIcon />
              <span class="min-w-0 truncate">{{ project.name }}</span>
              <ContextMenuShortcut v-if="here(project)" class="tracking-normal">hier</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </template>
      <ContextMenuSeparator v-if="groups.length" />
      <ContextMenuItem @select="chat.moveElsewhere(meta)">
        <FolderSearchIcon />
        Anderer Ordner …
      </ContextMenuItem>
    </ContextMenuSubContent>
  </ContextMenuSub>
</template>
