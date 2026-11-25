<script setup lang="ts">
import { PlusIcon, XIcon } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { MCP_TRANSPORT_LABELS, mcpServerProblem, type McpEntry, type McpServerConfig, type McpTransport } from '@shared/cli-config'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/errors'
import { useCliConfigStore } from '@/stores/cli-config'

/**
 * Adds an MCP server to the scope shown or edits one. Values main withheld as secrets come back
 * empty and marked: left alone they keep what the file has; typing replaces them.
 */
const props = defineProps<{ server: McpServerConfig | null; transports: McpTransport[]; bearerTokenEnvVar: boolean }>()
const open = defineModel<boolean>('open', { required: true })
const store = useCliConfigStore()

const form = reactive({
  name: '',
  transport: 'stdio' as McpTransport,
  command: '',
  args: '',
  env: [] as McpEntry[],
  url: '',
  headers: [] as McpEntry[],
  bearerTokenEnvVar: '',
})
const saving = ref(false)
const error = ref<string | null>(null)

const transportOptions = computed(() => props.transports.map((value) => ({ value, label: MCP_TRANSPORT_LABELS[value] })))
const remote = computed(() => form.transport !== 'stdio')
const entries = computed(() => (remote.value ? form.headers : form.env))

watch(open, (isOpen) => {
  if (!isOpen) return
  const s = props.server
  Object.assign(form, {
    name: s?.name ?? '',
    transport: s?.transport ?? props.transports[0] ?? 'stdio',
    command: s?.command ?? '',
    args: (s?.args ?? []).join('\n'),
    env: (s?.env ?? []).map((e) => ({ ...e })),
    url: s?.url ?? '',
    headers: (s?.headers ?? []).map((e) => ({ ...e })),
    bearerTokenEnvVar: s?.bearerTokenEnvVar ?? '',
  })
  error.value = null
})

function addEntry(): void {
  entries.value.push({ name: '', value: '' })
}
function removeEntry(index: number): void {
  entries.value.splice(index, 1)
}
/** Typing a value replaces the withheld one. */
function setValue(entry: McpEntry, value: string): void {
  entry.value = value
  entry.masked = entry.masked && !value ? true : undefined
}

function cleanEntries(list: McpEntry[]): McpEntry[] | undefined {
  const kept = list.map((e) => ({ ...e, name: e.name.trim() })).filter((e) => e.name || e.value)
  return kept.length ? kept : undefined
}

function build(): McpServerConfig {
  const base = { name: form.name.trim(), transport: form.transport, enabled: props.server?.enabled }
  if (!remote.value) {
    const args = form.args
      .split(/\r?\n/)
      .map((a) => a.trim())
      .filter(Boolean)
    return { ...base, command: form.command.trim(), args: args.length ? args : undefined, env: cleanEntries(form.env) }
  }
  return {
    ...base,
    url: form.url.trim(),
    headers: cleanEntries(form.headers),
    bearerTokenEnvVar: props.bearerTokenEnvVar ? form.bearerTokenEnvVar.trim() || undefined : undefined,
  }
}

async function submit(): Promise<void> {
  const server = build()
  error.value = mcpServerProblem(server, props.transports)
  if (error.value) return
  saving.value = true
  try {
    await store.saveMcp(server, props.server?.name ?? null)
    toast.success(props.server ? `„${server.name}“ gespeichert` : `„${server.name}“ hinzugefügt`)
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
        <DialogTitle>{{ server ? 'MCP-Server bearbeiten' : 'MCP-Server hinzufügen' }}</DialogTitle>
        <DialogDescription>Die CLI startet ihn mit jedem Chat dieser Ebene und bietet seine Werkzeuge an.</DialogDescription>
      </DialogHeader>

      <form id="mcp-server-form" class="flex flex-col gap-5" @submit.prevent="submit">
        <FieldGroup>
          <Field>
            <FieldLabel for="mcp-name">Name</FieldLabel>
            <Input id="mcp-name" v-model="form.name" placeholder="z. B. github" spellcheck="false" autocomplete="off" autofocus />
            <FieldDescription>Buchstaben, Ziffern, „-“ und „_“.</FieldDescription>
          </Field>

          <Field v-if="transportOptions.length > 1">
            <FieldLabel>Art</FieldLabel>
            <SegmentedControl block :model-value="form.transport" :options="transportOptions" aria-label="Art des Servers" @update:model-value="(t) => (form.transport = t)" />
          </Field>

          <template v-if="!remote">
            <Field>
              <FieldLabel for="mcp-command">Befehl</FieldLabel>
              <Input id="mcp-command" v-model="form.command" placeholder="z. B. npx" spellcheck="false" autocomplete="off" class="font-mono" />
            </Field>
            <Field>
              <FieldLabel for="mcp-args">Argumente</FieldLabel>
              <Textarea id="mcp-args" v-model="form.args" rows="3" placeholder="-y&#10;@modelcontextprotocol/server-github" spellcheck="false" class="font-mono text-xs" />
              <FieldDescription>Eins pro Zeile.</FieldDescription>
            </Field>
          </template>
          <template v-else>
            <Field>
              <FieldLabel for="mcp-url">Adresse</FieldLabel>
              <Input id="mcp-url" v-model="form.url" placeholder="https://…/mcp" spellcheck="false" autocomplete="off" class="font-mono" />
            </Field>
            <Field v-if="bearerTokenEnvVar">
              <FieldLabel for="mcp-bearer">Variable mit dem Token</FieldLabel>
              <Input id="mcp-bearer" v-model="form.bearerTokenEnvVar" placeholder="z. B. GITHUB_TOKEN" spellcheck="false" autocomplete="off" class="font-mono" />
              <FieldDescription>Die CLI schickt ihren Wert als „Authorization: Bearer …“.</FieldDescription>
            </Field>
          </template>

          <Field>
            <FieldLabel>{{ remote ? 'Header' : 'Umgebungsvariablen' }}</FieldLabel>
            <div class="flex flex-col gap-1.5">
              <div v-for="(entry, index) in entries" :key="index" class="flex items-center gap-1.5">
                <Input
                  v-model="entry.name"
                  :placeholder="remote ? 'Name' : 'NAME'"
                  :aria-label="remote ? 'Name des Headers' : 'Name der Variable'"
                  spellcheck="false"
                  autocomplete="off"
                  class="h-8 w-2/5 font-mono text-xs"
                />
                <Input
                  :model-value="entry.value"
                  :placeholder="entry.masked ? '•••• unverändert' : 'Wert'"
                  :type="entry.masked ? 'password' : 'text'"
                  aria-label="Wert"
                  spellcheck="false"
                  autocomplete="off"
                  class="h-8 flex-1 font-mono text-xs"
                  @update:model-value="(v) => setValue(entry, String(v))"
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Entfernen" @click="removeEntry(index)"><XIcon /></Button>
              </div>
              <Button type="button" variant="ghost" size="sm" class="-ml-2 self-start" @click="addEntry">
                <PlusIcon data-icon="inline-start" />
                {{ remote ? 'Header hinzufügen' : 'Variable hinzufügen' }}
              </Button>
            </div>
            <FieldDescription>Verborgene Werte bleiben, wie sie sind, solange du nichts einträgst.</FieldDescription>
          </Field>

          <p v-if="server?.other" class="text-xs text-muted-foreground">Bleibt erhalten: {{ server.other.join(', ') }}</p>
        </FieldGroup>

        <Alert v-if="error" variant="destructive">
          <AlertTitle>Nicht gespeichert</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Abbrechen</Button>
        <Button type="submit" form="mcp-server-form" :disabled="saving">
          <Spinner v-if="saving" data-icon="inline-start" />
          {{ server ? 'Speichern' : 'Hinzufügen' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
