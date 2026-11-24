<script setup lang="ts">
import { CheckIcon, FolderIcon, FolderTreeIcon, HistoryIcon } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { PROVIDER_IDS } from '@shared/chat'
import type { CliImportGroup, CliImportPreview, CliImportResult, ImportProgress } from '@shared/import-ipc'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { formatAge } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Taking over the sessions Claude Code and Codex saved in the folders of Nexa's accounts (from the
 * terminal, an IDE, their apps): each becomes a chat in the project of its folder and goes on where it
 * left off. Reads first, shows the folders, takes over what the user leaves ticked.
 */

const step = ref<'idle' | 'scanning' | 'preview' | 'running' | 'done'>('idle')
const progress = ref<ImportProgress>({ done: 0, total: 0 })
const preview = ref<CliImportPreview | null>(null)
const chosen = ref(new Set<string>())
const result = ref<CliImportResult | null>(null)
const now = Date.now()

let off: (() => void) | null = null
onMounted(() => (off = window.api.cliImport.onProgress((next) => (progress.value = next))))
onBeforeUnmount(() => off?.())

const lists = computed(() =>
  [
    { title: 'Projekte in Nexa', hint: '', groups: (preview.value?.groups ?? []).filter((g) => g.kind === 'project') },
    { title: 'Weitere Ordner', hint: 'kommen als Projekte unter „Projekte“', groups: (preview.value?.groups ?? []).filter((g) => g.kind === 'folder') },
  ].filter((list) => list.groups.length),
)
const selected = computed(() => (preview.value?.groups ?? []).filter((g) => g.exists && chosen.value.has(g.path)))
const selectedSessions = computed(() => selected.value.reduce((sum, g) => sum + g.sessions, 0))
const progressValue = computed(() => (progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0))

async function scan(): Promise<void> {
  step.value = 'scanning'
  progress.value = { done: 0, total: 0 }
  const next = await attempt(() => window.api.cliImport.scan(), 'Die Sessions der CLIs ließen sich nicht lesen')
  if (!next) {
    step.value = 'idle'
    return
  }
  preview.value = next
  chosen.value = new Set(next.groups.filter((g) => g.exists).map((g) => g.path))
  step.value = 'preview'
}

function toggle(group: CliImportGroup, on: boolean): void {
  const next = new Set(chosen.value)
  if (on) next.add(group.path)
  else next.delete(group.path)
  chosen.value = next
}

function toggleAll(groups: readonly CliImportGroup[], on: boolean): void {
  const next = new Set(chosen.value)
  for (const g of groups) if (g.exists) on ? next.add(g.path) : next.delete(g.path)
  chosen.value = next
}

async function run(): Promise<void> {
  step.value = 'running'
  const done = await attempt(() => window.api.cliImport.run({ groups: selected.value.map((g) => g.path) }), 'Übernehmen fehlgeschlagen')
  if (!done) {
    step.value = 'preview'
    return
  }
  result.value = done
  step.value = 'done'
}

function sessionsText(count: number): string {
  return count === 1 ? '1 Session' : `${count} Sessions`
}

const resultText = computed(() => {
  const r = result.value
  if (!r) return ''
  const sessions = sessionsText(r.sessions)
  if (!r.projects) return sessions
  return `${sessions}, dafür ${r.projects === 1 ? '1 neues Projekt' : `${r.projects} neue Projekte`}`
})
</script>

<template>
  <section class="flex flex-col gap-3 rounded-xl border bg-card p-4">
    <div class="flex items-start gap-3">
      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <HistoryIcon class="size-4.5" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 class="text-sm font-medium">Sessions der CLIs übernehmen</h2>
        <p v-if="step === 'done' && result" class="text-xs text-muted-foreground">
          Übernommen: {{ resultText }}. Die Chats gehen in ihrer CLI dort weiter, wo sie aufgehört haben.
        </p>
        <p v-else class="text-xs text-muted-foreground">
          Was du mit Claude Code oder Codex außerhalb von Nexa angefangen hast, im Terminal, in der IDE oder in ihren Apps, kommt als Chat
          ins Projekt seines Ordners und geht dort weiter. Nexa liest die Sessions nur, in den CLIs ändert sich nichts.
        </p>
      </div>
      <Button v-if="step === 'idle'" size="sm" variant="outline" @click="scan">Sessions lesen</Button>
      <Button v-else-if="step === 'done'" size="sm" variant="ghost" @click="scan">Erneut lesen</Button>
      <CheckIcon v-if="step === 'done'" class="size-5 shrink-0 text-success" />
    </div>

    <div v-if="step === 'scanning'" class="flex flex-col gap-1.5">
      <Progress :model-value="progressValue" />
      <p class="text-xs text-muted-foreground tabular-nums">
        Lese Sessions … {{ progress.total ? `${progress.done} von ${progress.total}` : '' }}
      </p>
    </div>

    <template v-if="preview && (step === 'preview' || step === 'running')">
      <p v-if="!preview.groups.some((g) => g.exists)" class="text-xs text-muted-foreground">Es gibt nichts Neues zu übernehmen.</p>
      <div class="flex max-h-80 flex-col gap-3 overflow-y-auto">
        <div v-for="section in lists" :key="section.title" class="flex flex-col gap-1">
          <div class="flex items-center justify-between gap-2">
            <h3 class="min-w-0 truncate text-xs text-muted-foreground">
              <span class="font-medium">{{ section.title }}</span>
              <template v-if="section.hint"> · {{ section.hint }}</template>
            </h3>
            <div class="flex gap-1">
              <Button variant="ghost" size="xs" @click="toggleAll(section.groups, true)">Alle</Button>
              <Button variant="ghost" size="xs" @click="toggleAll(section.groups, false)">Keine</Button>
            </div>
          </div>
          <label
            v-for="group in section.groups"
            :key="group.path"
            :class="cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/60', !group.exists && 'opacity-60')"
          >
            <Checkbox :model-value="group.exists && chosen.has(group.path)" :disabled="!group.exists" @update:model-value="toggle(group, $event === true)" />
            <component :is="group.inSubfolders ? FolderTreeIcon : FolderIcon" class="size-4 shrink-0 text-muted-foreground" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm">{{ group.name }}</span>
              <!-- Cut at the start: the end of a path tells it apart. -->
              <span class="truncate text-left text-xs text-muted-foreground" dir="rtl"><bdi dir="ltr">{{ group.path }}</bdi></span>
            </span>
            <span class="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground tabular-nums">
              <span v-if="!group.exists" class="text-destructive">Ordner fehlt</span>
              <span v-else class="flex items-center gap-2">
                <template v-for="provider in PROVIDER_IDS" :key="provider">
                  <span v-if="group.counts[provider]" class="flex items-center gap-1"><ProviderIcon :provider="provider" class="size-3" />{{ group.counts[provider] }}</span>
                </template>
              </span>
              <span v-if="group.exists && group.inSubfolders">{{ group.inSubfolders }} in Unterordnern</span>
              <span v-else-if="group.exists && group.updatedAt">{{ formatAge(group.updatedAt, now) }}</span>
            </span>
          </label>
        </div>
      </div>

      <p v-for="line in preview.failed" :key="line" class="text-xs text-destructive">Nicht gelesen: {{ line }}</p>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-muted-foreground">
          <template v-if="preview.known">{{ sessionsText(preview.known) }} hat Nexa schon. </template>
          <template v-if="preview.skipped">{{ sessionsText(preview.skipped) }} ohne Inhalt oder Ordner {{ preview.skipped === 1 ? 'bleibt' : 'bleiben' }} weg.</template>
        </p>
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" :disabled="step === 'running'" @click="step = 'idle'">Abbrechen</Button>
          <Button size="sm" :disabled="step === 'running' || !selected.length" @click="run">
            <Spinner v-if="step === 'running'" data-icon="inline-start" />
            {{ selectedSessions ? `${sessionsText(selectedSessions)} übernehmen` : 'Übernehmen' }}
          </Button>
        </div>
      </div>
    </template>
  </section>
</template>
