<script setup lang="ts">
import { ArrowUpIcon, FileTextIcon, FolderIcon, PencilLineIcon, SearchIcon, SquarePenIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { ThemeContent } from '@shared/themes/types'
import { useSettingsStore } from '@/stores/settings'
import { themeTokens } from '@/themes/apply'

/**
 * A small Nexa window in the colors of `theme`: its design tokens are set on the preview, so
 * everything in it is colored like the app would be (opaque, as without window material).
 */
const props = defineProps<{ theme: ThemeContent }>()
const settings = useSettingsStore()

const tokens = computed(() => themeTokens(props.theme, settings.settings.appearance, false))
const syn = (name: string) => `var(--syn-${name})`
const tint = (color: string, percent: number) => `color-mix(in oklab, ${color} ${percent}%, transparent)`
</script>

<template>
  <div class="text-foreground" :style="tokens" :data-preview-mode="theme.mode">
    <div class="overflow-hidden rounded-lg border text-[11px] shadow-sm" style="background: var(--background)">
      <!-- Title bar: logo and usage. -->
      <div class="flex h-7 items-center gap-1.5 px-2">
        <span class="size-3 rounded-[4px] bg-primary" />
        <span class="font-semibold">Nexa</span>
        <span class="ml-auto flex items-center gap-1 text-muted-foreground">
          <svg class="size-3.5 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="7" fill="none" class="stroke-muted" stroke-width="3" />
            <circle cx="10" cy="10" r="7" fill="none" class="stroke-usage-medium" stroke-width="3" stroke-dasharray="30 44" stroke-linecap="round" />
          </svg>
          Woche <b class="text-foreground">68 %</b>
        </span>
      </div>

      <div class="flex h-80">
        <!-- Sidebar: same colour as the title bar. -->
        <div class="relative flex w-28 shrink-0 flex-col gap-0.5 px-1.5 pb-2">
          <span class="flex items-center gap-1.5 rounded-md px-1.5 py-1"><SquarePenIcon class="size-3" /> Neuer Chat</span>
          <span class="mt-1.5 px-1.5 text-[9px] tracking-wide text-muted-foreground uppercase">Projekte</span>
          <span class="flex items-center gap-1.5 px-1.5 py-0.5"><FolderIcon class="size-3 text-muted-foreground" /> webapp</span>
          <span class="flex items-center gap-1.5 rounded-md bg-sidebar-accent px-1.5 py-1 font-medium">
            <span class="size-1.5 shrink-0 rounded-full bg-success" />
            <span class="truncate">Login bauen</span>
          </span>
          <span class="flex items-center gap-1.5 px-1.5 py-1 text-muted-foreground">
            <span class="size-1.5 shrink-0 rounded-full bg-warning" />
            <span class="truncate">Tests fixen</span>
          </span>

          <!-- A context menu of a chat, in the free space of the sidebar. -->
          <div class="absolute bottom-2 left-3 z-10 w-24 rounded-md bg-popover p-0.5 text-popover-foreground shadow-md ring-1 ring-foreground/10">
            <div class="rounded px-1.5 py-0.5">Umbenennen</div>
            <div class="rounded bg-accent px-1.5 py-0.5 text-accent-foreground">Ordner öffnen</div>
            <div class="rounded px-1.5 py-0.5 text-destructive">Löschen</div>
          </div>
        </div>

        <!-- The content panel with the chat. -->
        <div class="relative flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden rounded-tl-lg border-t border-l bg-surface p-2.5">
          <div class="ml-auto max-w-[80%] rounded-lg bg-secondary px-2 py-1">Bau das Login-Formular</div>
          <div class="flex flex-col gap-0.5 border-l pl-1.5">
            <span class="flex items-center gap-1.5"><FileTextIcon class="size-3 text-(--tool-read)" /> <b>Datei lesen</b> <span class="font-mono text-muted-foreground">src/App.vue</span></span>
            <span class="flex items-center gap-1.5"><SearchIcon class="size-3 text-(--tool-search)" /> <b>Suchen</b> <span class="font-mono text-muted-foreground">useAuth</span></span>
            <span class="flex items-center gap-1.5"><PencilLineIcon class="size-3 text-(--tool-write)" /> <b>Bearbeiten</b> <span class="font-mono text-muted-foreground">Login.vue</span></span>
          </div>
          <!-- A diff in the code colours. -->
          <div class="overflow-hidden rounded-md border font-mono text-[10px] leading-[1.5]" style="background: var(--code-bg); color: var(--code-fg)">
            <div class="flex justify-between border-b px-2 py-0.5 text-muted-foreground">
              <span>Login.vue</span><span><span :style="{ color: syn('green') }">+2</span> <span :style="{ color: syn('red') }">−1</span></span>
            </div>
            <div class="px-2" :style="{ background: tint(syn('red'), 14) }"><span :style="{ color: syn('magenta') }">const</span> user = <span :style="{ color: syn('green') }">'gast'</span></div>
            <div class="px-2" :style="{ background: tint(syn('green'), 14) }"><span :style="{ color: syn('magenta') }">const</span> { user } = <span :style="{ color: syn('blue') }">useAuth</span>()</div>
            <div class="px-2" :style="{ background: tint(syn('green'), 14) }"><span :style="{ color: syn('magenta') }">const</span> tries = <span :style="{ color: syn('yellow') }">3</span> <span style="color: var(--syn-comment)">// Limit</span></div>
          </div>
          <div>Fertig: Das Formular prüft die Eingaben und meldet <span class="text-destructive">Fehler</span> direkt am Feld.</div>
          <div class="text-[10px] text-muted-foreground">12 s · 8,4 k ein · 0,02 $</div>

          <!-- Composer. -->
          <div class="mt-auto flex items-center gap-1.5 rounded-lg border bg-card px-2 py-1.5">
            <span class="text-muted-foreground">Nachricht an Claude …</span>
            <span class="ml-auto flex h-3.5 w-6 items-center rounded-full bg-primary p-0.5"><span class="ml-auto size-2.5 rounded-full" style="background: var(--background)" /></span>
            <span class="flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><ArrowUpIcon class="size-3" /></span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
