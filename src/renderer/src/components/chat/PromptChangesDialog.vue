<script setup lang="ts">
import { ChevronRightIcon, ClockIcon, ImageIcon, RotateCcwIcon, TriangleAlertIcon, Undo2Icon } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { ChangedFile, ChatChanges, PromptChanges, RewindFile, RewindPreview } from '@shared/checkpoints'
import type { ChatItem, FileChange } from '@shared/chat'
import type { FileDiff } from '@shared/files'
import { firstLine } from '@shared/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { attempt, errorMessage } from '@/lib/errors'
import { fileIcon } from '@/lib/file-icons'
import { formatClock, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDeviceApi } from '@/stores/device'
import DiffView from './DiffView.vue'

/**
 * What each prompt of the chat changed in its files, from Nexa's checkpoints (one for every CLI): the
 * prompts, newest first, with their files and each file's change. Rewinding to before a prompt shows
 * first what it would do: which files go back, come back or go, and which of them were changed since
 * by someone else, whose changes go too. The chat itself stays as it is; a rewind can be taken back.
 */
const props = defineProps<{
  sessionId: string
  items: readonly ChatItem[]
  state: ChatChanges | null
  /** The prompt to open at. */
  focus: string | null
  /** The prompt to rewind to: the dialog opens with what that would do. */
  rewindTo: string | null
  /** The chat works: no rewinding meanwhile. */
  busy: boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ changed: [] }>()
const api = useDeviceApi()

const prompts = computed(() => [...(props.state?.prompts ?? [])].reverse())
const expanded = reactive(new Set<string>())
const fileOpen = reactive(new Set<string>())
const diffs = reactive(new Map<string, FileDiff | string>())

const preview = ref<RewindPreview | null>(null)
const previewError = ref<string | null>(null)
const previewing = ref<string | null>(null)
const rewinding = ref(false)

watch(open, (now) => {
  if (!now) return
  expanded.clear()
  fileOpen.clear()
  diffs.clear()
  preview.value = null
  previewError.value = null
  const first = props.focus ?? prompts.value[0]?.promptId
  if (first) expanded.add(first)
  if (props.rewindTo) void startRewind(props.rewindTo)
})
// Opened before the list came: its prompt opens once it is there.
watch(
  () => props.state,
  () => {
    if (!open.value || expanded.size) return
    const first = props.focus ?? prompts.value[0]?.promptId
    if (first) expanded.add(first)
  },
)

function promptText(promptId: string): { text: string; image: boolean } {
  const item = props.items.find((i) => i.id === promptId)
  if (item?.kind !== 'user') return { text: 'Prompt', image: false }
  return { text: firstLine(item.text, 120) || 'Bild', image: !item.text.trim() && !!item.images?.length }
}

function totals(p: PromptChanges): { insertions: number; deletions: number } {
  return {
    insertions: p.files.reduce((n, f) => n + (f.insertions ?? 0), 0),
    deletions: p.files.reduce((n, f) => n + (f.deletions ?? 0), 0),
  }
}

function filesLabel(n: number): string {
  return n === 1 ? '1 Datei' : `${n} Dateien`
}

function toggle(promptId: string): void {
  if (expanded.has(promptId)) expanded.delete(promptId)
  else expanded.add(promptId)
}

function fileKey(promptId: string, file: ChangedFile): string {
  return `${promptId}\0${file.path}`
}

async function toggleFile(promptId: string, file: ChangedFile): Promise<void> {
  const key = fileKey(promptId, file)
  if (fileOpen.has(key)) {
    fileOpen.delete(key)
    return
  }
  fileOpen.add(key)
  if (diffs.has(key)) return
  try {
    diffs.set(key, await api.sessions.changeDiff(props.sessionId, promptId, file.path, false))
  } catch (error) {
    diffs.set(key, errorMessage(error))
  }
}

/** The patch as the chat's own diff of a file shows it. */
function asChange(file: ChangedFile, diff: FileDiff): FileChange {
  return { path: file.path, type: file.status === 'added' ? 'add' : file.status === 'deleted' ? 'delete' : 'update', diff: diff.patch }
}

const STATUS: Record<ChangedFile['status'], { short: string; label: string; class: string }> = {
  added: { short: 'N', label: 'Neu', class: 'text-(--syn-green)' },
  modified: { short: 'G', label: 'Geändert', class: 'text-(--syn-yellow)' },
  deleted: { short: 'L', label: 'Gelöscht', class: 'text-(--syn-red)' },
}

/** What a rewind does to a file as it is now (`RewindFile.status` says that, not what the prompt did). */
const REWIND: Record<RewindFile['status'], { label: string; class: string }> = {
  modified: { label: 'wird zurückgesetzt', class: 'text-(--syn-yellow)' },
  added: { label: 'kommt wieder', class: 'text-(--syn-green)' },
  deleted: { label: 'wird gelöscht', class: 'text-(--syn-red)' },
}

function dirOf(rel: string): string {
  const at = rel.lastIndexOf('/')
  return at < 0 ? '' : rel.slice(0, at + 1)
}

function nameOf(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1)
}

async function startRewind(promptId: string): Promise<void> {
  previewing.value = promptId
  preview.value = null
  previewError.value = null
  try {
    preview.value = await api.sessions.rewindPreview(props.sessionId, promptId)
  } catch (error) {
    previewError.value = errorMessage(error)
  }
}

function cancelRewind(): void {
  previewing.value = null
  preview.value = null
  previewError.value = null
  // Opened right at the rewind (from a prompt): back is closing.
  if (props.rewindTo) open.value = false
}

async function confirmRewind(): Promise<void> {
  const promptId = previewing.value
  if (!promptId) return
  rewinding.value = true
  const result = await attempt(() => api.sessions.rewind(props.sessionId, promptId), 'Dateien ließen sich nicht zurückspulen')
  rewinding.value = false
  if (!result) return
  emit('changed')
  open.value = false
  if (result.failed.length) {
    toast.warning(`${result.failed.length} von ${result.files + result.failed.length} Dateien ließen sich nicht schreiben`, {
      description: result.failed.map((f) => `${f.path}: ${f.error}`).join('\n'),
    })
  } else {
    toast('Dateien zurückgespult', {
      description: `${filesLabel(result.files)} auf dem Stand vor „${promptText(promptId).text}“`,
      action: { label: 'Rückgängig', onClick: () => void undo() },
    })
  }
}

async function undo(): Promise<void> {
  const result = await attempt(() => api.sessions.rewindUndo(props.sessionId), 'Zurückspulen ließ sich nicht zurücknehmen')
  if (!result) return
  emit('changed')
  toast(result.failed.length ? `${result.failed.length} Dateien ließen sich nicht schreiben` : 'Zurückspulen zurückgenommen', {
    description: result.failed.length ? result.failed.map((f) => `${f.path}: ${f.error}`).join('\n') : filesLabel(result.files),
  })
}

const outsideCount = computed(() => preview.value?.files.filter((f) => f.outside).length ?? 0)
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
      <!-- Rewinding: what it would do, before it does it. -->
      <template v-if="previewing">
        <DialogHeader>
          <DialogTitle>Dateien zurückspulen</DialogTitle>
          <DialogDescription>
            Auf den Stand vor „{{ promptText(previewing).text }}“. Der Chat bleibt, wie er ist; der Agent erfährt es mit dem nächsten Prompt.
          </DialogDescription>
        </DialogHeader>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="previewError" class="rounded-lg bg-destructive/10 px-3 py-2 text-[0.82rem] text-destructive">{{ previewError }}</div>
          <div v-else-if="!preview" class="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Spinner class="size-4" /> Wird verglichen …</div>
          <template v-else>
            <p v-if="preview.unavailable" class="mb-3 rounded-lg bg-muted px-3 py-2 text-[0.82rem] text-muted-foreground">{{ preview.unavailable }}</p>
            <p v-if="preview.files.length === 0" class="py-4 text-sm text-muted-foreground">Die Dateien sind schon auf diesem Stand: Es gibt nichts zurückzuspulen.</p>
            <ul v-else class="flex flex-col">
              <li v-for="file in preview.files" :key="file.path" class="flex items-center gap-2 rounded-md px-2 py-1 text-[0.82rem]">
                <component :is="fileIcon(file.rel, { dir: false, link: false, broken: false }).icon" :class="cn('size-3.5 shrink-0', fileIcon(file.rel, { dir: false, link: false, broken: false }).class)" />
                <span class="min-w-0 truncate font-mono text-[0.78rem]" :title="file.path">
                  <span class="text-muted-foreground">{{ dirOf(file.rel) }}</span>{{ nameOf(file.rel) }}
                </span>
                <TriangleAlertIcon
                  v-if="file.outside"
                  class="size-3.5 shrink-0 text-(--syn-yellow)"
                  v-tooltip="'Seit dem letzten Turn auch außerhalb geändert: Diese Änderungen gehen ebenfalls verloren.'"
                />
                <span :class="cn('ml-auto shrink-0 text-[0.75rem]', REWIND[file.status].class)">{{ REWIND[file.status].label }}</span>
              </li>
            </ul>
            <p v-if="outsideCount" class="mt-3 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-[0.8rem] text-muted-foreground">
              <TriangleAlertIcon class="mt-0.5 size-3.5 shrink-0 text-(--syn-yellow)" />
              {{ outsideCount === 1 ? 'Eine Datei wurde' : `${outsideCount} Dateien wurden` }} seit dem letzten Turn auch außerhalb des Agenten geändert. Was dort
              geändert wurde, geht beim Zurückspulen ebenfalls verloren.
            </p>
            <div v-if="preview.skipped.length" class="mt-3 rounded-lg bg-muted px-3 py-2 text-[0.8rem] text-muted-foreground">
              Nicht gesichert und bleiben, wie sie sind (zu groß oder Verknüpfungen):
              <span class="font-mono text-[0.75rem] break-all">{{ preview.skipped.join(', ') }}</span>
            </div>
          </template>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="cancelRewind">{{ rewindTo ? 'Abbrechen' : 'Zurück' }}</Button>
          <Button variant="destructive" :disabled="!preview || preview.files.length === 0 || rewinding || busy" @click="confirmRewind">
            <Spinner v-if="rewinding" class="size-3.5" />
            <RotateCcwIcon v-else />
            {{ preview?.files.length ? `${filesLabel(preview.files.length)} zurückspulen` : 'Zurückspulen' }}
          </Button>
        </DialogFooter>
      </template>

      <template v-else>
        <DialogHeader>
          <DialogTitle>Änderungen je Prompt</DialogTitle>
          <DialogDescription>Was die Prompts dieses Chats an den Dateien geändert haben, mit jeder CLI. Zurückspulen setzt die Dateien auf den Stand vor einem Prompt.</DialogDescription>
        </DialogHeader>
        <div class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          <p v-if="state?.disabled" class="mb-3 rounded-lg bg-muted px-3 py-2 text-[0.82rem] text-muted-foreground">
            Checkpoints sind in den Einstellungen unter „Chat“ aus: Neue Prompts bekommen keine.
          </p>
          <div v-if="state?.undo" class="mb-3 flex items-center gap-3 rounded-lg bg-muted px-3 py-2 text-[0.82rem]">
            <Undo2Icon class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1">
              Zurückgespult auf vor „{{ promptText(state.undo.promptId).text }}“ · {{ filesLabel(state.undo.files) }} ·
              <span class="tabular-nums" v-tooltip="formatDateTime(state.undo.at)">{{ formatClock(state.undo.at) }}</span>
            </span>
            <Button variant="outline" size="xs" :disabled="busy" @click="undo">Zurücknehmen</Button>
          </div>
          <p v-if="prompts.length === 0" class="py-6 text-center text-sm text-muted-foreground">
            Noch keine Checkpoints: Nexa legt sie ab dem nächsten Prompt an.
          </p>
          <ul class="flex flex-col gap-1">
            <li v-for="p in prompts" :key="p.promptId" class="rounded-lg">
              <div class="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-accent/50">
                <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left outline-none" :aria-expanded="expanded.has(p.promptId)" @click="toggle(p.promptId)">
                  <ChevronRightIcon :class="cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded.has(p.promptId) && 'rotate-90')" />
                  <ImageIcon v-if="promptText(p.promptId).image" class="size-3.5 shrink-0 text-muted-foreground" />
                  <span class="min-w-0 truncate text-[0.85rem]">{{ promptText(p.promptId).text }}</span>
                  <span class="shrink-0 text-[0.72rem] text-muted-foreground tabular-nums" v-tooltip="formatDateTime(p.at)">{{ formatClock(p.at) }}</span>
                  <span v-if="p.open" class="flex shrink-0 items-center gap-1 text-[0.72rem] text-muted-foreground"><ClockIcon class="size-3" /> läuft</span>
                  <span class="ml-auto shrink-0 text-[0.72rem] tabular-nums text-muted-foreground">
                    <template v-if="p.files.length">
                      {{ filesLabel(p.files.length) }}
                      <span class="ml-1 font-mono text-(--syn-green)">+{{ totals(p).insertions }}</span>
                      <span class="ml-1 font-mono text-(--syn-red)">−{{ totals(p).deletions }}</span>
                    </template>
                    <template v-else-if="p.unavailable">kein Checkpoint</template>
                    <template v-else>keine Änderungen</template>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  class="shrink-0 text-muted-foreground"
                  :disabled="busy || !!p.unavailable"
                  aria-label="Bis vor diesen Prompt zurückspulen"
                  v-tooltip="busy ? 'Der Chat arbeitet gerade' : 'Dateien auf den Stand vor diesem Prompt zurückspulen'"
                  @click="startRewind(p.promptId)"
                >
                  <RotateCcwIcon />
                </Button>
              </div>
              <div v-if="expanded.has(p.promptId)" class="mb-2 ml-5 flex flex-col gap-0.5">
                <p v-if="p.unavailable" class="px-2 py-1 text-[0.8rem] text-muted-foreground">{{ p.unavailable }}</p>
                <template v-for="file in p.files" :key="file.path">
                  <button
                    type="button"
                    class="flex items-center gap-2 rounded-md px-2 py-1 text-left text-[0.82rem] outline-none hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                    :aria-expanded="fileOpen.has(fileKey(p.promptId, file))"
                    @click="toggleFile(p.promptId, file)"
                  >
                    <span :class="cn('w-3 shrink-0 text-center font-mono text-[0.72rem] font-semibold', STATUS[file.status].class)" v-tooltip="STATUS[file.status].label">{{ STATUS[file.status].short }}</span>
                    <component :is="fileIcon(file.rel, { dir: false, link: false, broken: false }).icon" :class="cn('size-3.5 shrink-0', fileIcon(file.rel, { dir: false, link: false, broken: false }).class)" />
                    <span class="min-w-0 truncate font-mono text-[0.78rem]" :title="file.path">
                      <span class="text-muted-foreground">{{ dirOf(file.rel) }}</span>{{ nameOf(file.rel) }}
                    </span>
                    <span class="ml-auto shrink-0 font-mono text-[0.72rem] tabular-nums">
                      <span v-if="file.insertions === null" class="font-sans text-muted-foreground">binär</span>
                      <template v-else>
                        <span class="text-(--syn-green)">+{{ file.insertions }}</span>
                        <span class="ml-1 text-(--syn-red)">−{{ file.deletions }}</span>
                      </template>
                    </span>
                  </button>
                  <div v-if="fileOpen.has(fileKey(p.promptId, file))" class="mb-1.5 ml-5">
                    <div v-if="!diffs.has(fileKey(p.promptId, file))" class="flex items-center gap-2 px-2 py-1 text-[0.8rem] text-muted-foreground"><Spinner class="size-3.5" /> Wird geladen …</div>
                    <p v-else-if="typeof diffs.get(fileKey(p.promptId, file)) === 'string'" class="px-2 py-1 text-[0.8rem] text-destructive">{{ diffs.get(fileKey(p.promptId, file)) }}</p>
                    <template v-else>
                      <div v-if="(diffs.get(fileKey(p.promptId, file)) as FileDiff).image" class="flex flex-wrap gap-3 p-2">
                        <figure v-for="side in (['before', 'after'] as const)" :key="side" class="flex flex-col gap-1">
                          <img v-if="(diffs.get(fileKey(p.promptId, file)) as FileDiff).image![side]" :src="(diffs.get(fileKey(p.promptId, file)) as FileDiff).image![side]!" alt="" class="max-h-48 max-w-72 rounded border object-contain" />
                          <figcaption class="text-[0.72rem] text-muted-foreground">{{ side === 'before' ? 'Vorher' : 'Nachher' }}</figcaption>
                        </figure>
                      </div>
                      <p v-else-if="(diffs.get(fileKey(p.promptId, file)) as FileDiff).tooLarge" class="px-2 py-1 text-[0.8rem] text-muted-foreground">Zu groß, um sie hier zu zeigen.</p>
                      <p v-else-if="(diffs.get(fileKey(p.promptId, file)) as FileDiff).binary" class="px-2 py-1 text-[0.8rem] text-muted-foreground">Keine Textdatei.</p>
                      <DiffView v-else :change="asChange(file, diffs.get(fileKey(p.promptId, file)) as FileDiff)" bare max-height="24rem" />
                    </template>
                  </div>
                </template>
                <p v-if="p.skipped.length" class="px-2 py-1 text-[0.75rem] text-muted-foreground">
                  Nicht gesichert (zu groß oder Verknüpfungen): <span class="font-mono break-all">{{ p.skipped.join(', ') }}</span>
                </p>
              </div>
            </li>
          </ul>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>
