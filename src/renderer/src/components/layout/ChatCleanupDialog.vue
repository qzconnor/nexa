<script setup lang="ts">
import { ArchiveIcon, PinIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { SessionMeta } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useChatRemoval } from '@/composables/useChatRemoval'
import { AGE_STEPS, ageLabel, cleanupMatches, SIZE_STEPS, sizeLabel, type CleanupFilter } from '@/lib/chat-cleanup'
import { toastError } from '@/lib/errors'
import { formatAge, formatBytes } from '@/lib/format'
import { useProjectsStore } from '@/stores/projects'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/**
 * Clearing up chats: filtered by project, age, size and archive, several deleted at once (as the
 * Claude Manager's session filter). Sizes count Nexa's history and, if deleting takes them along,
 * the CLIs' conversations.
 */
const ui = useUiStore()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const removal = useChatRemoval()

const ALL = 'all'
const open = computed({
  get: () => ui.cleanupProject !== undefined,
  set: (value) => {
    if (!value) ui.cleanupProject = undefined
  },
})
const filter = ref<CleanupFilter>({ olderThanDays: 0, largerThanMb: 0, projectId: null, archived: 'all' })
const sizes = ref<Map<string, number> | null>(null)
const selected = ref(new Set<string>())
const now = ref(Date.now())
const withCli = computed(() => settings.settings.chat.deleteCliConversations)

watch(
  () => ui.cleanupProject,
  async (projectId) => {
    if (projectId === undefined) return
    filter.value = { olderThanDays: 0, largerThanMb: 0, projectId, archived: 'all' }
    selected.value = new Set()
    now.value = Date.now()
    sizes.value = null
    try {
      const list = await window.api.sessions.storage()
      if (ui.cleanupProject === projectId) sizes.value = new Map(list.map((s) => [s.id, s.bytes]))
    } catch (error) {
      toastError(error, 'Größen ließen sich nicht lesen')
      sizes.value = new Map()
    }
  },
)

const sizeOf = (id: string): number | undefined => sizes.value?.get(id)

/** The biggest first: clearing up is mostly about space; the oldest first among equals. */
const shown = computed<SessionMeta[]>(() =>
  sessions.metas
    .filter((m) => cleanupMatches(m, sizeOf(m.id), filter.value, now.value))
    .sort((a, b) => (sizeOf(b.id) ?? 0) - (sizeOf(a.id) ?? 0) || a.updatedAt - b.updatedAt),
)
const picked = computed(() => shown.value.filter((m) => selected.value.has(m.id)))
const pickedBytes = computed(() => picked.value.reduce((sum, m) => sum + (sizeOf(m.id) ?? 0), 0))
const allPicked = computed<boolean | 'indeterminate'>(() =>
  picked.value.length === 0 ? false : picked.value.length === shown.value.length ? true : 'indeterminate',
)

function toggle(id: string, on: boolean): void {
  const next = new Set(selected.value)
  if (on) next.add(id)
  else next.delete(id)
  selected.value = next
}

function toggleAll(on: boolean): void {
  selected.value = on ? new Set(shown.value.map((m) => m.id)) : new Set()
}

const projectName = (id: string): string => projects.get(id)?.name ?? 'Unbekanntes Projekt'

async function remove(): Promise<void> {
  if (picked.value.length === 0) return
  if (await removal.remove(picked.value)) ui.cleanupProject = undefined
}

const selectClass = 'h-8 min-w-0 flex-1 bg-background/60 text-[0.8rem]'
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[min(85vh,44rem)] flex-col sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Chats aufräumen</DialogTitle>
        <DialogDescription>
          {{
            withCli
              ? 'Gelöschte Chats nehmen ihre Unterhaltungen in Claude Code und Codex mit, in den Papierkorb.'
              : 'Gelöscht wird der Verlauf in Nexa; die Unterhaltungen der CLIs bleiben (Einstellungen → Chat).'
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-wrap gap-2">
        <Select
          :model-value="filter.projectId ?? ALL"
          @update:model-value="(v) => (filter = { ...filter, projectId: v === ALL ? null : String(v) })"
        >
          <SelectTrigger :class="selectClass" aria-label="Projekt"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="ALL">Alle Projekte</SelectItem>
            <SelectItem v-for="p in projects.projects" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          :model-value="String(filter.olderThanDays)"
          @update:model-value="(v) => (filter = { ...filter, olderThanDays: Number(v) })"
        >
          <SelectTrigger :class="selectClass" aria-label="Alter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="days in AGE_STEPS" :key="days" :value="String(days)">{{ ageLabel(days) }}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          :model-value="String(filter.largerThanMb)"
          @update:model-value="(v) => (filter = { ...filter, largerThanMb: Number(v) })"
        >
          <SelectTrigger :class="selectClass" aria-label="Größe"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="mb in SIZE_STEPS" :key="mb" :value="String(mb)">{{ sizeLabel(mb) }}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          :model-value="filter.archived"
          @update:model-value="(v) => (filter = { ...filter, archived: v as CleanupFilter['archived'] })"
        >
          <SelectTrigger :class="selectClass" aria-label="Archiv"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mit archivierten</SelectItem>
            <SelectItem value="only">Nur archivierte</SelectItem>
            <SelectItem value="none">Ohne archivierte</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex min-h-0 flex-1 flex-col rounded-lg border">
        <label class="flex items-center gap-2.5 border-b px-3 py-2 text-[0.8rem] text-muted-foreground">
          <Checkbox :model-value="allPicked" :disabled="!shown.length" aria-label="Alle auswählen" @update:model-value="(v) => toggleAll(v === true)" />
          <span class="flex-1">{{ shown.length === 1 ? '1 Chat' : `${shown.length} Chats` }}</span>
          <Spinner v-if="!sizes" class="size-3.5" />
        </label>
        <div class="min-h-24 flex-1 overflow-y-auto">
          <p v-if="!shown.length" class="px-3 py-8 text-center text-[0.8rem] text-muted-foreground">Keine Chats, auf die das zutrifft.</p>
          <label
            v-for="meta in shown"
            :key="meta.id"
            class="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-accent/50"
          >
            <Checkbox :model-value="selected.has(meta.id)" @update:model-value="(v) => toggle(meta.id, v === true)" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex items-center gap-1.5 truncate text-[0.85rem]">
                <PinIcon v-if="meta.pinned" class="size-3 shrink-0 text-muted-foreground" aria-label="Angeheftet" />
                <ArchiveIcon v-if="meta.archived" class="size-3 shrink-0 text-muted-foreground" aria-label="Archiviert" />
                <span class="truncate">{{ meta.title }}</span>
              </span>
              <span class="truncate text-[0.72rem] text-muted-foreground">{{ projectName(meta.projectId) }} · {{ formatAge(meta.updatedAt, now) }}</span>
            </span>
            <span class="shrink-0 text-[0.75rem] text-muted-foreground tabular-nums">
              {{ sizes ? formatBytes(sizeOf(meta.id) ?? 0) : '…' }}
            </span>
          </label>
        </div>
      </div>

      <DialogFooter class="items-center">
        <span v-if="picked.length" class="mr-auto text-[0.8rem] text-muted-foreground">
          {{ picked.length === 1 ? '1 Chat' : `${picked.length} Chats` }} ausgewählt{{ sizes ? ` · ${formatBytes(pickedBytes)}` : '' }}
        </span>
        <Button variant="outline" @click="open = false">Abbrechen</Button>
        <Button variant="destructive" :disabled="!picked.length" @click="remove">Löschen</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
