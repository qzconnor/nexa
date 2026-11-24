<script setup lang="ts">
import { ArrowRightLeftIcon, CheckIcon, FolderIcon, FolderTreeIcon, MessageSquareTextIcon, PaletteIcon, PencilLineIcon, PinIcon } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ClaudeManagerFound, ImportAccount, ImportExtra, ImportGroup, ImportPreview, ImportProgress, ImportResult } from '@shared/import-ipc'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { formatAge } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Taking over from the Claude Manager: its workspaces as separators with their subfolders as projects,
 * other folders as projects under the default separator, its accounts with the same config folders, and
 * the Claude Code sessions in them as chats that go on; besides, workspace prompts, themes and the names
 * and pins of sessions. Reads first, shows what would come, takes over what the user leaves ticked; run
 * again, it offers only what Nexa doesn't have yet. Shown only when the Claude Manager's data is there
 * (`always`: also say when it isn't, as in the settings).
 */
const props = defineProps<{ always?: boolean }>()

const found = ref<ClaudeManagerFound | null>(null)
const detected = ref(false)
const step = ref<'idle' | 'scanning' | 'preview' | 'running' | 'done'>('idle')
const progress = ref<ImportProgress>({ done: 0, total: 0 })
const preview = ref<ImportPreview | null>(null)
const chosen = ref(new Set<string>())
const chosenExtras = ref(new Set<string>())
const result = ref<ImportResult | null>(null)
const now = Date.now()

let off: (() => void) | null = null
onMounted(async () => {
  off = window.api.claudeManager.onProgress((next) => (progress.value = next))
  found.value = await window.api.claudeManager.detect().catch(() => null)
  detected.value = true
})
onBeforeUnmount(() => off?.())

const visible = computed(() => detected.value && (found.value || props.always))
const ofKind = (kind: ImportGroup['kind']) => (preview.value?.groups ?? []).filter((g) => g.kind === kind)
const lists = computed(() =>
  [
    { title: 'Workspaces', hint: 'werden Trenner, ihre Ordner Projekte darunter', groups: ofKind('workspace') },
    { title: 'Projekte in Nexa', hint: '', groups: ofKind('project') },
    { title: 'Weitere Ordner', hint: 'kommen als Projekte unter „Projekte“', groups: ofKind('folder') },
  ].filter((list) => list.groups.length),
)
const selected = computed(() => (preview.value?.groups ?? []).filter((g) => g.exists && chosen.value.has(g.path)))
const selectedSessions = computed(() => selected.value.reduce((sum, g) => sum + g.sessions, 0))
const extras = computed(() => preview.value?.extras ?? [])
const selectedExtras = computed(() => extras.value.filter((e) => !e.blocked && chosenExtras.value.has(e.id)))
const nothingNew = computed(() => !preview.value?.groups.some((g) => g.exists && (g.sessions || g.kind === 'workspace')) && !extras.value.some((e) => !e.blocked))

const EXTRA_ICONS = { prompt: MessageSquareTextIcon, theme: PaletteIcon, names: PencilLineIcon, pins: PinIcon } as const
const EXTRA_KINDS = { prompt: 'Prompt', theme: 'Theme', names: 'Namen', pins: 'Pins' } as const

function toggleExtra(extra: ImportExtra, on: boolean): void {
  const next = new Set(chosenExtras.value)
  if (on) next.add(extra.id)
  else next.delete(extra.id)
  chosenExtras.value = next
}

function toggleAllExtras(on: boolean): void {
  chosenExtras.value = new Set(on ? extras.value.filter((e) => !e.blocked).map((e) => e.id) : [])
}
const progressValue = computed(() => (progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0))

const ACCOUNT_ACTIONS = { create: 'wird übernommen', exists: 'hat Nexa schon', merge: 'hat Nexa schon', standard: 'Standard', skip: 'nicht übertragbar' } as const

/** What becomes of an account, as the chip under the preview says it. */
function accountAction(account: ImportAccount): string {
  return account.action === 'merge' && account.into ? `wird mit „${account.into}“ zusammengefasst` : ACCOUNT_ACTIONS[account.action]
}

function accountHint(account: ImportAccount): string | undefined {
  if (account.action === 'skip') return 'Token und API-Keys sind für den Claude Manager verschlüsselt. Lege den Account in Nexa neu an.'
  if (account.action === 'merge') return 'Derselbe Login ist in Nexa schon da. Kein zweiter Account: Die Chats laufen mit diesem weiter.'
  return undefined
}

async function scan(): Promise<void> {
  step.value = 'scanning'
  progress.value = { done: 0, total: 0 }
  const next = await attempt(() => window.api.claudeManager.scan(), 'Die Daten des Claude Managers ließen sich nicht lesen')
  if (!next) {
    step.value = 'idle'
    return
  }
  preview.value = next
  chosen.value = new Set(next.groups.filter((g) => g.exists).map((g) => g.path))
  chosenExtras.value = new Set(next.extras.filter((e) => !e.blocked).map((e) => e.id))
  step.value = 'preview'
}

function toggle(group: ImportGroup, on: boolean): void {
  const next = new Set(chosen.value)
  if (on) next.add(group.path)
  else next.delete(group.path)
  chosen.value = next
}

function toggleAll(groups: readonly ImportGroup[], on: boolean): void {
  const next = new Set(chosen.value)
  for (const g of groups) if (g.exists) on ? next.add(g.path) : next.delete(g.path)
  chosen.value = next
}

async function run(): Promise<void> {
  step.value = 'running'
  const done = await attempt(
    () => window.api.claudeManager.run({ groups: selected.value.map((g) => g.path), extras: selectedExtras.value.map((e) => e.id) }),
    'Übernehmen fehlgeschlagen',
  )
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

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

/** What was taken over, in a sentence: only what there was. */
const resultText = computed(() => {
  const r = result.value
  if (!r) return ''
  const parts = [
    r.sections ? count(r.sections, 'Trenner', 'Trenner') : '',
    r.projects ? count(r.projects, 'Projekt', 'Projekte') : '',
    r.sessions ? sessionsText(r.sessions) : '',
    r.accounts ? count(r.accounts, 'Account', 'Accounts') : '',
    r.prompts ? count(r.prompts, 'Workspace-Prompt', 'Workspace-Prompts') : '',
    r.themes ? count(r.themes, 'Theme', 'Themes') : '',
    r.names ? count(r.names, 'Name', 'Namen') : '',
    r.pins ? count(r.pins, 'angeheftete Session', 'angeheftete Sessions') : '',
  ].filter(Boolean)
  if (!parts.length) return 'nichts'
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} und ${parts.at(-1)}` : parts[0]!
})
</script>

<template>
  <section v-if="visible" class="flex flex-col gap-3 rounded-xl border bg-card p-4">
    <div class="flex items-start gap-3">
      <div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <ArrowRightLeftIcon class="size-4.5" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 class="text-sm font-medium">Vom Claude Manager übernehmen</h2>
        <p v-if="!found" class="text-xs text-muted-foreground">Auf diesem Rechner hat Nexa keine Daten des Claude Managers gefunden.</p>
        <p v-else-if="step === 'done' && result" class="text-xs text-muted-foreground">
          Übernommen: {{ resultText }}.<template v-if="result.sessions"> Die Chats gehen mit Claude Code dort weiter, wo sie aufgehört haben.</template>
        </p>
        <p v-else class="text-xs text-muted-foreground">
          Workspaces werden Trenner mit ihren Ordnern als Projekten, weitere Ordner kommen unter „Projekte“. Accounts nutzen weiter
          ihre Ordner, und die Sessions von Claude Code gehen als Chats weiter, dazu Workspace-Prompts, eigene Themes sowie Namen und
          Pins von Sessions. Erneut gelesen, bietet Nexa nur an, was noch fehlt. Nexa liest die Daten des Claude Managers nur, dort
          ändert sich nichts.
        </p>
      </div>
      <Button v-if="found && step === 'idle'" size="sm" variant="outline" @click="scan">Sessions lesen</Button>
      <CheckIcon v-else-if="step === 'done'" class="size-5 shrink-0 text-success" />
    </div>

    <div v-if="step === 'scanning'" class="flex flex-col gap-1.5">
      <Progress :model-value="progressValue" />
      <p class="text-xs text-muted-foreground tabular-nums">
        Lese Sessions … {{ progress.total ? `${progress.done} von ${progress.total}` : '' }}
      </p>
    </div>

    <template v-if="preview && (step === 'preview' || step === 'running')">
      <div v-if="preview.accounts.length" class="flex flex-col gap-1.5">
        <h3 class="text-xs font-medium text-muted-foreground">Accounts</h3>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="(account, i) in preview.accounts"
            :key="i"
            :class="cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs', account.action === 'skip' && 'opacity-60')"
            v-tooltip="accountHint(account)"
          >
            <span class="size-2 rounded-full" :style="{ background: account.color }" />
            {{ account.name }}
            <span class="text-muted-foreground">· {{ accountAction(account) }}</span>
          </span>
        </div>
      </div>

      <p v-if="nothingNew" class="text-xs text-muted-foreground">Es gibt nichts Neues zu übernehmen.</p>
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
            <component :is="group.kind === 'workspace' || group.inSubfolders ? FolderTreeIcon : FolderIcon" class="size-4 shrink-0 text-muted-foreground" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm">{{ group.name }}</span>
              <!-- Cut at the start: the end of a path tells it apart. -->
              <span class="truncate text-left text-xs text-muted-foreground" dir="rtl"><bdi dir="ltr">{{ group.path }}</bdi></span>
            </span>
            <span class="flex shrink-0 flex-col items-end text-xs text-muted-foreground tabular-nums">
              <span v-if="!group.exists" class="text-destructive">Ordner fehlt</span>
              <span v-else>{{ sessionsText(group.sessions) }}</span>
              <span v-if="group.exists && group.kind === 'workspace' && group.projects">{{ group.projects === 1 ? 'in 1 Projekt' : `in ${group.projects} Projekten` }}</span>
              <span v-else-if="group.exists && group.inSubfolders">{{ group.inSubfolders }} in Unterordnern</span>
              <span v-else-if="group.exists && group.updatedAt">{{ formatAge(group.updatedAt, now) }}</span>
            </span>
          </label>
        </div>

        <div v-if="extras.length" class="flex flex-col gap-1">
          <div class="flex items-center justify-between gap-2">
            <h3 class="min-w-0 truncate text-xs text-muted-foreground"><span class="font-medium">Weiteres</span> · was Nexa davon noch nicht hat</h3>
            <div class="flex gap-1">
              <Button variant="ghost" size="xs" @click="toggleAllExtras(true)">Alle</Button>
              <Button variant="ghost" size="xs" @click="toggleAllExtras(false)">Keine</Button>
            </div>
          </div>
          <label
            v-for="extra in extras"
            :key="extra.id"
            :class="cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-muted/60', extra.blocked && 'opacity-60')"
            v-tooltip="extra.blocked"
          >
            <Checkbox :model-value="!extra.blocked && chosenExtras.has(extra.id)" :disabled="!!extra.blocked" @update:model-value="toggleExtra(extra, $event === true)" />
            <component :is="EXTRA_ICONS[extra.kind]" class="size-4 shrink-0 text-muted-foreground" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-sm">{{ extra.label }}</span>
              <span v-if="extra.blocked || extra.detail" class="truncate text-xs text-muted-foreground">{{ extra.blocked ?? extra.detail }}</span>
            </span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ EXTRA_KINDS[extra.kind] }}</span>
          </label>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-muted-foreground">
          <template v-if="preview.known">{{ sessionsText(preview.known) }} hat Nexa schon. </template>
          <template v-if="preview.skipped">{{ sessionsText(preview.skipped) }} ohne Inhalt oder Ordner {{ preview.skipped === 1 ? 'bleibt' : 'bleiben' }} weg.</template>
        </p>
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" :disabled="step === 'running'" @click="step = 'idle'">Abbrechen</Button>
          <Button size="sm" :disabled="step === 'running' || (!selected.length && !selectedExtras.length)" @click="run">
            <Spinner v-if="step === 'running'" data-icon="inline-start" />
            {{ selectedSessions ? `${sessionsText(selectedSessions)} übernehmen` : 'Übernehmen' }}
          </Button>
        </div>
      </div>
    </template>
  </section>
</template>
