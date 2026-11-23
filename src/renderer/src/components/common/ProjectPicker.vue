<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, FolderIcon, FolderPlusIcon, SearchIcon } from '@lucide/vue'
import { ListboxContent, ListboxFilter, ListboxGroup, ListboxGroupLabel, ListboxItem, ListboxRoot } from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { parentFolder, shortenPath } from '@shared/folders'
import { sectionIdOf } from '@shared/sections'
import type { Project } from '@shared/types'
import { searchTerms } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMatchHighlight } from '@/composables/useMatchHighlight'
import { containsTerms, searchText } from '@/lib/search'
import { useAppStore } from '@/stores/app'
import { useProjectsStore } from '@/stores/projects'

/**
 * The project a new chat goes to, on the start page: a field that searches the projects by name and
 * folder, listed under their separators as in the sidebar, and a folder of the user's choice.
 */
defineProps<{ project: Project | undefined }>()
const emit = defineEmits<{ select: [id: string]; pickFolder: [] }>()

const app = useAppStore()
const projects = useProjectsStore()

const open = ref(false)
const query = ref('')
const terms = computed(() => searchTerms(query.value))

/** Where a project lies, short: `~` for the home folder. Its own name is shown apart. */
function place(project: Project): string {
  const parent = parentFolder(project.path)
  return parent ? shortenPath(parent, app.info?.homeDir) : project.path
}

/** The separators with their projects that match, in the sidebar's order. */
const groups = computed(() =>
  projects.sections
    .map((section) => ({
      section,
      projects: projects.projects.filter(
        (p) => sectionIdOf(p, projects.sections) === section.id && containsTerms(searchText(p.name, p.path), terms.value),
      ),
    }))
    .filter((group) => group.projects.length),
)
/** Headings only help with more than one separator. */
const headed = computed(() => projects.sections.length > 1)

// ListboxRoot is generic, so InstanceType can't describe it: only what is used here.
const listbox = ref<{ highlightFirstItem: () => void } | null>(null)
const results = ref<{ $el: HTMLElement } | null>(null)
useMatchHighlight(
  () => (open.value ? (results.value?.$el ?? null) : null),
  () => terms.value,
)

// Typing narrows the list: Enter takes its first project.
watch(terms, () => void nextTick(() => listbox.value?.highlightFirstItem()))
// A new opening starts without the last search.
watch(open, (now) => now && (query.value = ''))

function choose(id: string): void {
  open.value = false
  emit('select', id)
}

function pickFolder(): void {
  open.value = false
  emit('pickFolder')
}

const rowClass = 'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none select-none data-highlighted:bg-accent'
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="outline" size="sm" class="max-w-full min-w-0 gap-2 bg-card/60">
        <FolderIcon class="text-muted-foreground" />
        <span class="max-w-56 shrink-0 truncate">{{ project?.name ?? 'Projekt wählen' }}</span>
        <!-- Cut at the start: the folders next to the project tell it apart. -->
        <span v-if="project" class="hidden max-w-48 min-w-0 truncate text-xs text-muted-foreground sm:inline" dir="rtl" :title="project.path">
          <bdi dir="ltr">{{ place(project) }}</bdi>
        </span>
        <ChevronDownIcon class="opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-96 p-0">
      <ListboxRoot ref="listbox" :model-value="project?.id" highlight-on-hover class="flex flex-col">
        <div class="flex items-center gap-2 border-b px-3">
          <SearchIcon class="size-4 shrink-0 text-muted-foreground" />
          <ListboxFilter
            v-model="query"
            auto-focus
            placeholder="Projekt suchen"
            aria-label="Projekt suchen"
            spellcheck="false"
            class="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <ListboxContent ref="results" class="max-h-80 overflow-y-auto p-1 outline-none">
          <ListboxGroup v-for="group in groups" :key="group.section.id">
            <ListboxGroupLabel v-if="headed" class="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{{ group.section.name }}</ListboxGroupLabel>
            <ListboxItem v-for="p in group.projects" :key="p.id" :value="p.id" :class="rowClass" @select.prevent="choose(p.id)">
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm">{{ p.name }}</span>
                <span class="truncate text-xs text-muted-foreground" dir="rtl" :title="p.path"><bdi dir="ltr">{{ place(p) }}</bdi></span>
              </span>
              <CheckIcon v-if="p.id === project?.id" class="size-4 shrink-0 text-muted-foreground" />
            </ListboxItem>
          </ListboxGroup>
          <p v-if="!groups.length && terms.length" class="px-2 py-4 text-center text-sm text-muted-foreground">Kein Projekt passt zu „{{ query.trim() }}“.</p>
          <ListboxItem value="pick-folder" :class="[rowClass, 'mt-1 border-t pt-2']" @select.prevent="pickFolder">
            <FolderPlusIcon class="size-4 text-muted-foreground" />
            <span class="text-sm">Ordner wählen …</span>
          </ListboxItem>
        </ListboxContent>
      </ListboxRoot>
    </PopoverContent>
  </Popover>
</template>
