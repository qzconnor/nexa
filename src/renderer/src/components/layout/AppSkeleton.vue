<script setup lang="ts">
import { Skeleton } from '@/components/ui/skeleton'
import { isChatWindow } from '@/lib/chat-window'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/stores/ui'

/**
 * The window's frame while the start loads the chats, projects and CLIs: title bar, sidebar and page
 * where they will be, so the app comes up in place instead of after a spinner.
 */
const ui = useUiStore()
const sidebar = ui.sidebarOpen && !isChatWindow
/** Projects of different lengths, so it reads as a list. */
const ROWS = ['w-2/3', 'w-1/2', 'w-3/5', 'w-2/5', 'w-1/2', 'w-1/3']
</script>

<template>
  <div class="flex h-full flex-col" role="status" aria-label="Nexa wird geladen">
    <div class="app-drag h-(--titlebar-height) shrink-0" />
    <div class="flex min-h-0 flex-1">
      <div v-if="sidebar" class="flex w-(--sidebar-width) shrink-0 flex-col gap-1 p-2" aria-hidden="true">
        <div v-for="i in 4" :key="`nav${i}`" class="flex h-9 items-center gap-2 px-2.5">
          <Skeleton class="size-4 rounded" />
          <Skeleton :class="cn('h-3.5', i % 2 ? 'w-24' : 'w-20')" />
        </div>
        <Skeleton class="mx-2.5 mt-4 mb-2 h-3 w-16" />
        <div v-for="(width, i) in ROWS" :key="`row${i}`" class="flex h-8 items-center gap-2 px-2.5">
          <Skeleton class="size-4 rounded" />
          <Skeleton :class="cn('h-3.5', width)" />
        </div>
      </div>
      <!-- Shaped like the start page (HomeView): logo, heading, line under it, composer. -->
      <div
        :class="cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t bg-surface', sidebar && 'rounded-tl-xl border-l')"
        aria-hidden="true"
      >
        <div v-if="!isChatWindow" class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-10">
          <div class="flex flex-col items-center gap-3">
            <Skeleton class="size-12 rounded-xl" />
            <Skeleton class="h-7 w-64" />
            <Skeleton class="h-4 w-80 max-w-full" />
          </div>
          <Skeleton class="h-28 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  </div>
</template>
