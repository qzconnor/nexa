<script setup lang="ts">
import { FolderOpenIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'
import {
  MAX_START_COMMAND_LENGTH,
  MAX_START_COMMAND_NAME,
  MAX_START_COMMANDS,
  normalizeStartDir,
  relativeDir,
  startCommandError,
  startCommandNameError,
} from '@shared/start-commands'
import type { StartCommand } from '@shared/types'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { errorMessage } from '@/lib/errors'
import { useProjectsStore } from '@/stores/projects'
import { useStartCommandsStore } from '@/stores/start-commands'
import { useUiStore } from '@/stores/ui'

/**
 * The start commands of a project, like the shells of the Claude Manager's tab sets with their start
 * command: the command, a name, a folder in the project, and whether it starts by itself. Opened
 * through `ui.startCommandsProject`.
 */
interface Row {
  id: string
  name: string
  command: string
  dir: string
  autoStart: boolean
}

const ui = useUiStore()
const projects = useProjectsStore()
const startCommands = useStartCommandsStore()

const open = computed({
  get: () => ui.startCommandsProject !== null,
  set: (value) => {
    if (!value) ui.startCommandsProject = null
  },
})
/** Kept while the dialog closes, so its words don't change during the animation. */
const project = ref<{ id: string; name: string; path: string } | null>(null)
const rows = ref<Row[]>([])
const submitted = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)

const newRow = (): Row => ({ id: crypto.randomUUID(), name: '', command: '', dir: '', autoStart: false })
/** A row left empty: it goes when saving, without a word. */
const blank = (row: Row) => !row.name.trim() && !row.command.trim() && !row.dir.trim()

watch(
  () => ui.startCommandsProject,
  (id) => {
    if (!id) return
    const found = projects.get(id)
    if (!found) {
      ui.startCommandsProject = null
      return
    }
    project.value = { id: found.id, name: found.name, path: found.path }
    const saved = found.startCommands ?? []
    rows.value = saved.length
      ? saved.map((c) => ({ id: c.id, name: c.name, command: c.command, dir: c.dir ?? '', autoStart: !!c.autoStart }))
      : [newRow()]
    submitted.value = false
    saving.value = false
    error.value = null
  },
  { immediate: true },
)

const DIR_ERROR = 'Der Ordner muss im Projekt liegen, z. B. packages/web.'

function errorsOf(row: Row): { name: string | null; command: string | null; dir: string | null } {
  if (!submitted.value || blank(row)) return { name: null, command: null, dir: null }
  return {
    name: startCommandNameError(row.name),
    command: startCommandError(row.command),
    dir: normalizeStartDir(row.dir) === null ? DIR_ERROR : null,
  }
}

function focusCommand(row: Row | undefined): void {
  if (row) document.getElementById(`start-command-${row.id}`)?.focus()
}

async function add(): Promise<void> {
  rows.value.push(newRow())
  await nextTick()
  focusCommand(rows.value.at(-1))
}

function remove(index: number): void {
  rows.value.splice(index, 1)
}

/** A folder from the system's dialog, as a path in the project; one outside stays as picked and says so. */
async function pickDir(row: Row): Promise<void> {
  const base = project.value?.path
  if (!base) return
  const separator = base.includes('\\') ? '\\' : '/'
  const current = normalizeStartDir(row.dir)
  const picked = await window.api.app.pickDirectory(current ? `${base.replace(/[\\/]+$/, '')}${separator}${current.replaceAll('/', separator)}` : base)
  if (picked) row.dir = relativeDir(base, picked) ?? picked
}

async function save(): Promise<void> {
  submitted.value = true
  error.value = null
  const id = project.value?.id
  if (!id || saving.value) return
  const filled = rows.value.filter((row) => !blank(row))
  if (filled.some((row) => Object.values(errorsOf(row)).some(Boolean))) return
  saving.value = true
  try {
    const commands = filled.map((row): StartCommand => {
      const dir = normalizeStartDir(row.dir)
      return { id: row.id, name: row.name.trim(), command: row.command.trim(), ...(dir ? { dir } : {}), ...(row.autoStart ? { autoStart: true } : {}) }
    })
    await startCommands.save(id, commands)
    ui.startCommandsProject = null
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl"
      @open-auto-focus.prevent="focusCommand(rows[0])"
    >
      <DialogHeader>
        <DialogTitle>Startbefehle von „{{ project?.name ?? '…' }}“</DialogTitle>
        <DialogDescription>
          Shells, die neben den Chats des Projekts laufen, z. B. ein Dev-Server. Gestartet werden sie im Kopf eines Chats, die Ausgabe steht
          daneben. Sie laufen mit der Shell aus den Einstellungen und enden mit Nexa.
        </DialogDescription>
      </DialogHeader>

      <form id="start-commands-form" class="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto px-1 py-0.5" @submit.prevent="save">
        <ul class="flex flex-col gap-2">
          <li v-for="(row, i) in rows" :key="row.id" class="flex flex-col gap-2 rounded-lg border p-3">
            <div class="flex items-start gap-2">
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <Input
                  :id="`start-command-${row.id}`"
                  v-model="row.command"
                  placeholder="Befehl, z. B. npm run dev"
                  aria-label="Befehl"
                  spellcheck="false"
                  autocomplete="off"
                  :maxlength="MAX_START_COMMAND_LENGTH"
                  :disabled="saving"
                  :aria-invalid="!!errorsOf(row).command || undefined"
                  class="font-mono text-[0.82rem]"
                />
                <FieldError v-if="errorsOf(row).command">{{ errorsOf(row).command }}</FieldError>
              </div>
              <div class="flex w-44 shrink-0 flex-col gap-1">
                <Input
                  v-model="row.name"
                  placeholder="Name (optional)"
                  aria-label="Name"
                  autocomplete="off"
                  :maxlength="MAX_START_COMMAND_NAME"
                  :disabled="saving"
                  :aria-invalid="!!errorsOf(row).name || undefined"
                />
                <FieldError v-if="errorsOf(row).name">{{ errorsOf(row).name }}</FieldError>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Startbefehl entfernen" v-tooltip="'Entfernen'" :disabled="saving" @click="remove(i)">
                <Trash2Icon />
              </Button>
            </div>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
              <InputGroup class="min-w-56 flex-1">
                <InputGroupInput
                  v-model="row.dir"
                  placeholder="Ordner im Projekt (leer: Projektordner)"
                  aria-label="Ordner im Projekt"
                  spellcheck="false"
                  autocomplete="off"
                  :disabled="saving"
                  :aria-invalid="!!errorsOf(row).dir || undefined"
                  class="font-mono text-[0.82rem]"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton size="icon-xs" aria-label="Ordner wählen" v-tooltip="'Ordner wählen'" :disabled="saving" @click="pickDir(row)">
                    <FolderOpenIcon />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <label class="flex shrink-0 items-center gap-2 text-[0.8rem]">
                <Switch v-model="row.autoStart" size="sm" :disabled="saving" />
                Automatisch starten
              </label>
              <span v-if="project && startCommands.isRunning(project.id, row.id)" class="shrink-0 text-xs text-(--tool-run)">läuft</span>
            </div>
            <FieldError v-if="errorsOf(row).dir">{{ errorsOf(row).dir }}</FieldError>
          </li>
        </ul>
        <Button v-if="rows.length < MAX_START_COMMANDS" type="button" variant="ghost" size="sm" class="-ml-1 self-start" :disabled="saving" @click="add">
          <PlusIcon data-icon="inline-start" />
          Startbefehl hinzufügen
        </Button>
        <p class="text-[0.75rem] text-muted-foreground">
          „Automatisch starten“: sobald nach dem Start von Nexa der erste Chat des Projekts aufgeht. Ein geänderter Befehl, der gerade läuft,
          gilt ab „Neu starten“; einen entfernten beendet Nexa.
        </p>
        <Alert v-if="error" variant="destructive">
          <AlertTitle>Speichern fehlgeschlagen</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Abbrechen</Button>
        <Button type="submit" form="start-commands-form" :disabled="saving">
          <Spinner v-if="saving" data-icon="inline-start" />
          Speichern
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
