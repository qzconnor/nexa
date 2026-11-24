<script setup lang="ts">
import { CircleAlertIcon, FolderGit2Icon, FolderOpenIcon, GitBranchIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { WorktreeCheck } from '@shared/files'
import { folderKey } from '@shared/folders'
import { randomWorktreeName, worktreeBranch, worktreeFolder, worktreeNameError } from '@shared/worktree'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { useChatActions } from '@/composables/useChatActions'
import { errorMessage } from '@/lib/errors'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'

/**
 * A new chat in a worktree of its own, as the Claude Manager starts `claude --worktree <name>`: a second
 * checkout of the repository on a branch of its own, so several chats work on it at once without getting
 * in each other's way. Nexa makes it with git (SessionService.create), so Codex works in it as well.
 */
const ui = useUiStore()
const sessions = useSessionsStore()
const chat = useChatActions()
/** Where `Login` and `login` are one folder. */
const caseInsensitive = window.api.platform === 'win32' || window.api.platform === 'darwin'

const open = computed({
  get: () => ui.worktreeRequest !== null,
  set: (value) => {
    if (!value) ui.worktreeRequest = null
  },
})
const folder = ref('')
const name = ref('')
const starting = ref(false)
/** What creating it refused, until something changes. */
const failed = ref<string | null>(null)

watch(
  () => ui.worktreeRequest,
  (request) => {
    if (!request) return
    folder.value = request.folder
    // A name ready to take, as Claude Code makes one up; typing replaces it (see `focusName`).
    name.value = randomWorktreeName()
    starting.value = false
    failed.value = null
  },
  { immediate: true },
)

const check = ref<WorktreeCheck | null>(null)
/** Counts the checks: the answer to an older one is dropped. */
let asked = 0
let timer: ReturnType<typeof setTimeout> | undefined

/** Checks the folder after `delay` (typing stops); what shows always belongs to the folder as it is now. */
function scheduleCheck(delay: number): void {
  const current = ++asked
  clearTimeout(timer)
  check.value = null
  const dir = folder.value.trim()
  if (!open.value || !dir) return
  if (!/^(?:[a-z]:[\\/]|[\\/])/i.test(dir)) {
    check.value = { ok: false, reason: 'Gib den ganzen Pfad an, oder wähle den Ordner über „Durchsuchen“.' }
    return
  }
  timer = setTimeout(async () => {
    const result = await window.api.git.worktreeCheck(dir).catch((error: unknown): WorktreeCheck => ({ ok: false, reason: errorMessage(error) }))
    if (current === asked) check.value = result
  }, delay)
}
watch(folder, () => {
  failed.value = null
  scheduleCheck(300)
})
watch(open, () => scheduleCheck(0), { immediate: true })
watch(name, () => (failed.value = null))
const checking = computed(() => open.value && !!folder.value.trim() && check.value === null)
const ready = computed(() => (check.value?.ok ? check.value : null))

const trimmed = computed(() => name.value.trim())
const nameError = computed(() => worktreeNameError(name.value))
const sameName = (a: string, b: string) => (caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b)
const existing = computed(() => ready.value?.existing ?? [])
/** The name of a worktree there already: the chat works in it. */
const reused = computed(() => !!trimmed.value && existing.value.some((n) => sameName(n, trimmed.value)))
/** The name of a branch `worktree-<name>` without its worktree: the new one goes on with it. */
const continued = computed(() => !reused.value && !!trimmed.value && !!ready.value?.branches.some((n) => sameName(n, trimmed.value)))
const shownName = computed(() => (trimmed.value && !nameError.value ? trimmed.value : '<zufällig>'))
/** The folder asked about lies below the main checkout, where the worktree goes. */
const elsewhere = computed(() => !!ready.value && folderKey(ready.value.root) !== folderKey(folder.value))
const canStart = computed(() => !!ready.value && !nameError.value && !starting.value)

async function pickFolder(): Promise<void> {
  const dir = await window.api.app.pickDirectory(folder.value.trim() || undefined)
  if (dir) folder.value = dir
}

/** The name gets the keyboard, all of it selected: typing replaces the one made up. */
function focusName(event: Event): void {
  const input = document.getElementById('worktree-name')
  if (!(input instanceof HTMLInputElement)) return
  event.preventDefault()
  input.focus()
  input.select()
}

async function start(): Promise<void> {
  const request = ui.worktreeRequest
  if (!request || !canStart.value) return
  starting.value = true
  failed.value = null
  try {
    const meta = await sessions.create({ projectId: request.projectId, cwd: folder.value.trim(), worktree: trimmed.value })
    ui.worktreeRequest = null
    ui.view = 'chat'
    chat.reveal(meta)
  } catch (error) {
    failed.value = errorMessage(error)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-lg" @open-auto-focus="focusName">
      <DialogHeader>
        <DialogTitle>Neuer Chat in einem Worktree</DialogTitle>
        <DialogDescription>
          Nexa legt einen zweiten Arbeitsordner des Repositorys mit eigenem Branch an, wie
          <code class="font-mono">claude --worktree</code>. So kommen sich mehrere Chats im selben Projekt nicht in die Quere, mit Claude
          Code wie mit Codex.
        </DialogDescription>
      </DialogHeader>

      <form id="worktree-form" class="flex flex-col gap-5" @submit.prevent="start">
        <FieldGroup>
          <Field :data-invalid="check?.ok === false || undefined">
            <FieldLabel for="worktree-folder">Repository</FieldLabel>
            <InputGroup>
              <InputGroupInput id="worktree-folder" v-model="folder" spellcheck="false" autocomplete="off" :disabled="starting" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="xs" :disabled="starting" @click="pickFolder"><FolderOpenIcon /> Durchsuchen</InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldError v-if="check?.ok === false" class="flex items-start gap-1.5">
              <CircleAlertIcon class="mt-px size-3.5 shrink-0" />
              {{ check.reason }}
            </FieldError>
            <FieldDescription v-else-if="checking" class="flex items-center gap-1.5">
              <Spinner class="size-3.5" />
              Wird geprüft …
            </FieldDescription>
            <template v-else-if="ready">
              <FieldDescription v-if="ready.base && !reused && !continued" class="flex items-center gap-1.5">
                <GitBranchIcon class="size-3.5 shrink-0" />
                <span class="min-w-0 truncate">Zweigt von {{ ready.base.detached ? 'Commit ' : '' }}„{{ ready.base.name }}“ ab</span>
              </FieldDescription>
              <FieldDescription v-if="elsewhere" class="[overflow-wrap:anywhere]">
                Der Worktree kommt in den Hauptordner des Repositorys, <span class="font-mono text-xs">{{ ready.root }}</span>.
              </FieldDescription>
            </template>
          </Field>

          <Field :data-invalid="!!nameError || undefined">
            <FieldLabel for="worktree-name">Name</FieldLabel>
            <Input
              id="worktree-name"
              v-model="name"
              placeholder="leer für einen zufälligen Namen"
              spellcheck="false"
              autocomplete="off"
              class="font-mono"
              :aria-invalid="!!nameError || undefined"
              :disabled="starting"
            />
            <FieldError v-if="nameError">{{ nameError }}</FieldError>
            <FieldDescription v-else-if="reused">Den Worktree „{{ trimmed }}“ gibt es schon: Der Chat arbeitet darin weiter.</FieldDescription>
            <FieldDescription v-else-if="continued">
              Den Branch „{{ worktreeBranch(trimmed) }}“ gibt es schon: Der Worktree macht auf ihm weiter.
            </FieldDescription>
            <FieldDescription v-else class="font-mono text-xs">{{ worktreeFolder(shownName) }} · Branch {{ worktreeBranch(shownName) }}</FieldDescription>
            <div v-if="existing.length" class="flex flex-wrap items-center gap-1.5 pt-1">
              <span class="text-xs text-muted-foreground">Vorhanden:</span>
              <Badge
                v-for="item in existing"
                :key="item"
                as="button"
                type="button"
                variant="outline"
                class="cursor-pointer font-mono hover:bg-muted"
                :disabled="starting"
                @click="name = item"
              >
                <FolderGit2Icon />
                {{ item }}
              </Badge>
            </div>
          </Field>
        </FieldGroup>

        <p class="text-xs text-muted-foreground">
          Löschst du den Chat, entfernt Nexa den Worktree mit seinem Branch, sofern darin keine Änderungen und keine eigenen Commits sind; sonst
          bleibt er.
          <template v-if="ready && !ready.ignored">
            Damit Git die Worktrees nicht als neue Dateien zeigt, gehört <code class="font-mono">.claude/worktrees/</code> in die
            <code class="font-mono">.gitignore</code>.
          </template>
        </p>
        <p v-if="failed" class="rounded-md bg-destructive/10 px-3 py-2 text-sm [overflow-wrap:anywhere] text-destructive">{{ failed }}</p>
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Abbrechen</Button>
        <Button type="submit" form="worktree-form" :disabled="!canStart">
          <Spinner v-if="starting" data-icon="inline-start" />
          <FolderGit2Icon v-else data-icon="inline-start" />
          Chat anlegen
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
