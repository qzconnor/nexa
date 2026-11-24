<script setup lang="ts">
import { ChevronRightIcon, PinIcon } from '@lucide/vue'
import type { SessionMeta } from '@shared/types'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useUiStore } from '@/stores/ui'
import SidebarSession from './SidebarSession.vue'

/**
 * The pinned chats on top of the sidebar, above the separators, the latest first, as in the Claude
 * Manager. They stay in their projects too: here each row names its project.
 */
defineProps<{ chats: SessionMeta[]; now: number }>()
const projects = useProjectsStore()
const ui = useUiStore()
</script>

<template>
  <section data-list-group class="pb-1">
    <!-- Looks like a separator's heading, so the sidebar reads as one list. -->
    <div class="group/pinned flex items-center gap-1 rounded-lg pt-2.5 pr-1 pb-1 pl-2">
      <button
        type="button"
        data-list-row
        :aria-expanded="ui.pinnedOpen"
        class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        @click="ui.pinnedOpen = !ui.pinnedOpen"
      >
        <PinIcon class="size-3 shrink-0 text-muted-foreground" />
        <span class="truncate text-[0.72rem] font-medium tracking-wide text-muted-foreground uppercase">Angeheftet</span>
        <ChevronRightIcon
          :class="
            cn('size-3 shrink-0 text-muted-foreground transition-[transform,opacity]', ui.pinnedOpen && 'rotate-90 opacity-0 group-hover/pinned:opacity-100')
          "
        />
      </button>
      <span class="mr-1.5 text-[0.7rem] text-muted-foreground/70 tabular-nums">{{ chats.length }}</span>
    </div>
    <div v-if="ui.pinnedOpen" class="flex flex-col gap-px">
      <SidebarSession v-for="meta in chats" :key="meta.id" :meta="meta" :now="now" :place="projects.get(meta.projectId)?.name" />
    </div>
  </section>
</template>
