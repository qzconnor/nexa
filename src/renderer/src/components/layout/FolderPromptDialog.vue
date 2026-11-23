<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FolderPromptInfo, PromptTarget } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage, toastError } from '@/lib/errors'
import { useUiStore } from '@/stores/ui'

/**
 * The prompt of a project or of a separator for a folder, as the Claude Manager's workspace prompt:
 * every chat in it gets the text in its system prompt, from the next start of its CLI on. It lives as
 * `prompts.md` in the folder, beside the code it is about.
 */
const ui = useUiStore()

const open = computed({
  get: () => ui.promptTarget !== null,
  set: (value) => {
    if (!value) ui.promptTarget = null
  },
})
const info = ref<FolderPromptInfo | null>(null)
const text = ref('')
const loading = ref(false)
const saving = ref(false)
const failed = ref<string | null>(null)
/** Kept while the dialog closes, so its words don't change during the animation. */
const kind = ref<PromptTarget['kind']>('project')

watch(
  () => ui.promptTarget,
  async (target) => {
    if (!target) return
    kind.value = target.kind
    info.value = null
    text.value = ''
    failed.value = null
    saving.value = false
    loading.value = true
    try {
      const read = await window.api.projects.prompt(target)
      if (ui.promptTarget !== target) return
      info.value = read
      text.value = read.text.trimEnd()
    } catch (error) {
      failed.value = errorMessage(error)
    } finally {
      loading.value = false
    }
  },
)

const scope = computed(() => (kind.value === 'section' ? 'Jeder Chat in den Projekten unter diesem Trenner' : 'Jeder Chat in diesem Projekt'))
const outerNote = computed(() => {
  const outer = info.value?.outer ?? []
  if (!outer.length) return ''
  const names = outer.map((n) => `„${n}“`).join(', ')
  return outer.length === 1
    ? `Es liegt im Ordner von ${names}: Chats darin bekommen erst dessen Prompt, dann diesen.`
    : `Es liegt in den Ordnern von ${names}: Chats darin bekommen erst deren Prompts, dann diesen.`
})

async function save(): Promise<void> {
  const target = ui.promptTarget
  if (!target || saving.value || !info.value) return
  saving.value = true
  try {
    await window.api.projects.setPrompt(target, text.value)
    ui.promptTarget = null
  } catch (error) {
    toastError(error, 'Prompt nicht gespeichert')
  } finally {
    saving.value = false
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    void save()
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Prompt von „{{ info?.name ?? '…' }}“</DialogTitle>
        <DialogDescription class="flex flex-col gap-1.5">
          <span>
            {{ scope }} bekommt den Text zusätzlich als System-Prompt. Er gilt ab dem nächsten Start der CLI eines Chats: neue Chats
            sofort, laufende nach „CLI beenden“ oder einem Neustart von Nexa.
          </span>
          <span v-if="outerNote">{{ outerNote }}</span>
        </DialogDescription>
      </DialogHeader>
      <div v-if="loading" class="flex justify-center py-8"><Spinner class="size-5 text-muted-foreground" /></div>
      <p v-else-if="failed" class="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{{ failed }}</p>
      <div v-else-if="info" class="flex flex-col gap-3">
        <div>
          <div class="text-[0.8rem] font-medium">Ordner</div>
          <div class="mt-0.5 font-mono text-[0.78rem] break-all text-muted-foreground">{{ info.path }}</div>
        </div>
        <div class="flex flex-col gap-1.5">
          <label for="folder-prompt" class="text-[0.8rem] font-medium">Prompt</label>
          <Textarea
            id="folder-prompt"
            v-model="text"
            class="max-h-[50vh] min-h-36 font-mono text-[0.82rem]"
            placeholder="z. B. Nutze nur Open-Source-Bibliotheken."
            autofocus
            @keydown="onKeydown"
          />
          <p class="text-[0.75rem] text-muted-foreground">
            Steht als <code class="font-mono">{{ info.file }}</code> im Ordner.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="ui.promptTarget = null">Abbrechen</Button>
        <Button :disabled="!info || saving" @click="save">
          <Spinner v-if="saving" />
          Speichern
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
