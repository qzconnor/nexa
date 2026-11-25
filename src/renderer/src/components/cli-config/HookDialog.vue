<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { HookEventInfo, HookHandler } from '@shared/cli-config'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { HookDraft } from '@/lib/cli-hooks'
import { errorMessage } from '@/lib/errors'

/**
 * Adds a command hook or edits one. The event stays while editing: moving a hook to another event
 * is removing it and adding a new one.
 */
const props = defineProps<{ draft: HookDraft | null; events: HookEventInfo[]; save: (event: string, matcher: string | null, handler: HookHandler) => Promise<void> }>()
const open = defineModel<boolean>('open', { required: true })

const form = reactive({ event: '', matcher: '', command: '', timeout: '' })
const saving = ref(false)
const error = ref<string | null>(null)

const editing = computed(() => !!props.draft?.handler)
const info = computed(() => props.events.find((e) => e.name === form.event))

watch(open, (isOpen) => {
  if (!isOpen) return
  const d = props.draft
  Object.assign(form, {
    event: d?.event ?? props.events[0]?.name ?? '',
    matcher: d?.matcher ?? '',
    command: d?.handler?.command ?? '',
    timeout: d?.handler?.timeout ? String(d.handler.timeout) : '',
  })
  error.value = null
})

async function submit(): Promise<void> {
  error.value = null
  const command = form.command.trim()
  if (!form.event) error.value = 'Bitte wähle ein Ereignis.'
  else if (!command) error.value = 'Der Befehl fehlt.'
  const timeout = form.timeout.trim() ? Number(form.timeout.replace(',', '.')) : undefined
  if (!error.value && timeout !== undefined && !(Number.isFinite(timeout) && timeout > 0)) error.value = 'Die Zeitgrenze muss eine positive Zahl (Sekunden) sein.'
  if (error.value) return
  saving.value = true
  try {
    const handler: HookHandler = { ...(props.draft?.handler ?? {}), type: 'command', command, timeout }
    await props.save(form.event, info.value?.matcher ? form.matcher.trim() || null : null, handler)
    open.value = false
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ editing ? 'Hook bearbeiten' : 'Hook hinzufügen' }}</DialogTitle>
        <DialogDescription>Ein Befehl, den die CLI bei einem Ereignis in der Shell ausführt, mit deinen Rechten.</DialogDescription>
      </DialogHeader>

      <form id="hook-form" class="flex flex-col gap-5" @submit.prevent="submit">
        <FieldGroup>
          <Field>
            <FieldLabel>Ereignis</FieldLabel>
            <Select v-model="form.event" :disabled="editing">
              <SelectTrigger class="w-full" aria-label="Ereignis"><SelectValue placeholder="Ereignis wählen" /></SelectTrigger>
              <SelectContent class="max-h-80">
                <SelectItem v-for="e in events" :key="e.name" :value="e.name">
                  <span class="font-mono text-xs">{{ e.name }}</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription v-if="info?.description">{{ info.description }}</FieldDescription>
          </Field>

          <Field v-if="info?.matcher">
            <FieldLabel for="hook-matcher">Matcher</FieldLabel>
            <Input id="hook-matcher" v-model="form.matcher" placeholder="z. B. Bash oder Edit|Write, leer: alle" spellcheck="false" autocomplete="off" class="font-mono" />
            <FieldDescription>Wofür der Hook gilt, als regulärer Ausdruck; leer gilt er für alles.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel for="hook-command">Befehl</FieldLabel>
            <Textarea id="hook-command" v-model="form.command" rows="3" placeholder="z. B. npm run lint" spellcheck="false" class="font-mono text-xs" autofocus />
            <FieldDescription>Bekommt die Daten des Ereignisses als JSON auf stdin.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel for="hook-timeout">Zeitgrenze</FieldLabel>
            <div class="flex items-center gap-2">
              <Input id="hook-timeout" v-model="form.timeout" inputmode="decimal" placeholder="Standard" class="w-28" />
              <span class="text-sm text-muted-foreground">Sekunden</span>
            </div>
          </Field>
        </FieldGroup>

        <Alert v-if="error" variant="destructive">
          <AlertTitle>Nicht gespeichert</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Abbrechen</Button>
        <Button type="submit" form="hook-form" :disabled="saving">
          <Spinner v-if="saving" data-icon="inline-start" />
          {{ editing ? 'Speichern' : 'Hinzufügen' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
