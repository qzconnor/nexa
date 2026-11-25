<script setup lang="ts">
import { ChevronRightIcon, EyeIcon, EyeOffIcon, FolderOpenIcon } from '@lucide/vue'
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { ACCOUNT_COLORS, ACCOUNT_KINDS, accountKindLabel, canLogin, usesSecret, type CreatableAccountKind } from '@shared/accounts'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { formatArgs, parseArgs } from '@/lib/args'
import { errorMessage } from '@/lib/errors'
import { isWindows } from '@/lib/platform'
import { useAccountsStore } from '@/stores/accounts'
import AccountColorPicker from './AccountColorPicker.vue'

/** Adds an account to a CLI or edits one; opened through `accounts.formRequest`. */
const accounts = useAccountsStore()

const KIND_INFO: Record<ProviderId, Partial<Record<CreatableAccountKind, string>>> = {
  claude: {
    oauth: 'Eigener Konfigurationsordner, Anmeldung im Browser über „claude auth login“. Claude Code erneuert den Token selbst; die Limits zeigt Nexa live.',
    token: 'Long-lived Token aus „claude setup-token“, Claude Code bekommt ihn als CLAUDE_CODE_OAUTH_TOKEN. Ein Jahr gültig; die Limits kommen mit der nächsten Antwort.',
    apiKey: 'Anthropic-API-Key aus der Console, Claude Code bekommt ihn als ANTHROPIC_API_KEY. Abrechnung nach Verbrauch.',
  },
  codex: {
    oauth: 'Eigener Codex-Ordner (CODEX_HOME), Anmeldung im Browser über „codex login“ mit einem ChatGPT-Konto. Codex erneuert den Token selbst.',
  },
  gemini: {
    oauth: 'Eigener Ordner (GEMINI_CLI_HOME), Anmeldung im Browser mit einem Google-Konto. Gemini CLI erneuert den Token selbst.',
    apiKey: 'API-Key aus Google AI Studio (beginnt meist mit „AIza“), Gemini CLI bekommt ihn als GEMINI_API_KEY. Kostenlos mit Tageslimits oder nach Verbrauch.',
  },
}
/** What the advanced fields say for each CLI. */
const CLI_TEXT: Record<ProviderId, { args: string; dirEnv: string; system: string; copies: string }> = {
  claude: {
    args: 'z. B. --add-dir ../shared',
    dirEnv: 'CLAUDE_CONFIG_DIR',
    system: '~/.claude',
    copies: 'Kopiert settings.json, CLAUDE.md, Skills, Commands und Agents – keine Anmeldedaten.',
  },
  codex: {
    args: 'z. B. -c model_reasoning_effort=high',
    dirEnv: 'CODEX_HOME',
    system: '~/.codex',
    copies: 'Kopiert config.toml, AGENTS.md, Prompts, Skills und Rules – keine Anmeldedaten.',
  },
  gemini: {
    args: 'z. B. --sandbox',
    // GEMINI_CLI_HOME stands for the home folder: Gemini CLI keeps its files in `.gemini` below it.
    dirEnv: 'GEMINI_CLI_HOME, darin .gemini',
    system: '~/.gemini',
    copies: 'Kopiert settings.json, GEMINI.md, Commands, Skills, Agents und Policies – keine Anmeldedaten.',
  },
}
/** Where secrets go, in the words of the system. */
const SECRET_STORE = isWindows ? 'mit der Windows-Datenverschlüsselung' : window.api.platform === 'darwin' ? 'im Schlüsselbund' : 'im Schlüsselbund des Systems'

const open = computed({
  get: () => !!accounts.formRequest,
  set: (value) => {
    if (!value) accounts.formRequest = null
  },
})
const editing = computed(() => accounts.formRequest?.account ?? null)

const form = reactive({
  provider: 'claude' as ProviderId,
  kind: 'oauth' as CreatableAccountKind,
  name: '',
  color: ACCOUNT_COLORS[0],
  secret: '',
  useCustomDir: false,
  configDir: '',
  extraArgs: '',
  importSettings: true,
})
const showSecret = ref(false)
const advancedOpen = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const submitted = ref(false)

const provider = computed<ProviderId>(() => editing.value?.provider ?? form.provider)
const kind = computed(() => editing.value?.kind ?? form.kind)
const needsSecret = computed(() => usesSecret(kind.value))
const kindOptions = computed(() => ACCOUNT_KINDS[form.provider].map((value) => ({ value, label: accountKindLabel(value, form.provider) })))
const providerOptions = PROVIDER_IDS.map((id) => ({ value: id, label: PROVIDERS[id].name }))

const nameError = computed(() => (submitted.value && !form.name.trim() ? 'Bitte gib einen Namen an.' : null))
const secretError = computed(() => {
  if (!submitted.value || !needsSecret.value) return null
  const secret = form.secret.trim()
  if (!secret) return editing.value ? null : kind.value === 'token' ? 'Bitte trage den Token ein.' : 'Bitte trage den API-Key ein.'
  return secret.startsWith('sk-ant-') ? null : 'Muss mit „sk-ant-“ beginnen.'
})
const dirError = computed(() => (submitted.value && form.useCustomDir && !form.configDir.trim() ? 'Bitte wähle einen Ordner.' : null))

function nextColor(): string {
  const used = new Set(accounts.accounts.map((a) => a.color.toLowerCase()))
  return ACCOUNT_COLORS.find((c) => !used.has(c)) ?? ACCOUNT_COLORS[accounts.accounts.length % ACCOUNT_COLORS.length]
}

watch(
  () => accounts.formRequest,
  (request) => {
    if (!request) return
    const a = request.account
    Object.assign(form, {
      provider: a?.provider ?? request.provider,
      kind: a && a.kind !== 'system' ? a.kind : 'oauth',
      name: a?.name ?? '',
      color: a?.color ?? nextColor(),
      secret: '',
      useCustomDir: false,
      configDir: '',
      extraArgs: formatArgs(a?.extraArgs ?? []),
      importSettings: true,
    })
    showSecret.value = false
    advancedOpen.value = !!a?.extraArgs.length
    error.value = null
    submitted.value = false
  },
)

function onProvider(value: ProviderId): void {
  form.provider = value
  if (!ACCOUNT_KINDS[value].includes(form.kind)) form.kind = ACCOUNT_KINDS[value][0]
}

async function pickDir(): Promise<void> {
  const dir = await window.api.app.pickDirectory(form.configDir || undefined)
  if (dir) form.configDir = dir
}

async function submit(): Promise<void> {
  submitted.value = true
  error.value = null
  if (nameError.value || secretError.value || dirError.value) return
  saving.value = true
  try {
    const common = { name: form.name.trim(), color: form.color, extraArgs: parseArgs(form.extraArgs) }
    const secret = form.secret.trim()
    if (editing.value) {
      await accounts.update(editing.value.id, { ...common, ...(secret ? { secret } : {}) })
      toast.success('Account gespeichert')
    } else {
      const created = await accounts.create({
        ...common,
        provider: form.provider,
        kind: form.kind,
        secret: needsSecret.value ? secret : undefined,
        configDir: form.useCustomDir ? form.configDir.trim() : null,
        importSettings: form.importSettings && !form.useCustomDir,
      })
      toast.success(`Account „${created.name}“ angelegt`)
      // A browser login starts right away; the dialog for it follows this one.
      if (canLogin(created.kind) && created.authState === 'missing') void accounts.login(created.id).catch((e) => toast.error(errorMessage(e)))
    }
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
        <DialogTitle>{{ editing ? 'Account bearbeiten' : 'Account hinzufügen' }}</DialogTitle>
        <DialogDescription>
          {{ editing ? `${PROVIDERS[provider].name} · ${accountKindLabel(kind, provider)}` : 'Jeder Account startet die CLI mit eigener Anmeldung und eigenem Konfigurationsordner.' }}
        </DialogDescription>
      </DialogHeader>

      <form id="account-form" class="flex flex-col gap-5" @submit.prevent="submit">
        <FieldGroup>
          <Field v-if="!editing">
            <FieldLabel>CLI</FieldLabel>
            <SegmentedControl block :model-value="form.provider" :options="providerOptions" aria-label="CLI" @update:model-value="onProvider" />
          </Field>

          <Field v-if="!editing">
            <FieldLabel>Anmeldeart</FieldLabel>
            <SegmentedControl
              v-if="kindOptions.length > 1"
              block
              :model-value="form.kind"
              :options="kindOptions"
              aria-label="Anmeldeart"
              @update:model-value="(value) => (form.kind = value)"
            />
            <FieldDescription>{{ KIND_INFO[form.provider][form.kind] }}</FieldDescription>
          </Field>

          <Field :data-invalid="!!nameError || undefined">
            <FieldLabel for="account-name">Name</FieldLabel>
            <Input id="account-name" v-model="form.name" placeholder="z. B. Privat, Firma, Max-Abo" :aria-invalid="!!nameError || undefined" autofocus />
            <FieldError v-if="nameError">{{ nameError }}</FieldError>
          </Field>

          <Field v-if="needsSecret" :data-invalid="!!secretError || undefined">
            <FieldLabel for="account-secret">{{ kind === 'token' ? 'Token' : 'API-Key' }}</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id="account-secret"
                v-model="form.secret"
                :type="showSecret ? 'text' : 'password'"
                :placeholder="
                  editing?.secretHint ? `${editing.secretHint} (leer lassen = unverändert)` : kind === 'token' ? 'sk-ant-oat01-…' : 'sk-ant-api03-…'
                "
                autocomplete="off"
                spellcheck="false"
                class="font-mono"
                :aria-invalid="!!secretError || undefined"
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton size="icon-xs" :aria-label="showSecret ? 'Verbergen' : 'Anzeigen'" @click="showSecret = !showSecret">
                  <EyeOffIcon v-if="showSecret" />
                  <EyeIcon v-else />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              <template v-if="kind === 'token'">Erzeugen mit <code class="font-mono">claude setup-token</code>. </template>
              Wird {{ SECRET_STORE }} gespeichert, nie im Klartext.
            </FieldDescription>
            <FieldError v-if="secretError">{{ secretError }}</FieldError>
          </Field>

          <Field>
            <FieldLabel>Farbe</FieldLabel>
            <AccountColorPicker v-model="form.color" />
          </Field>
        </FieldGroup>

        <Collapsible v-model:open="advancedOpen">
          <CollapsibleTrigger as-child>
            <Button type="button" variant="ghost" size="sm" class="-ml-2 self-start">
              <ChevronRightIcon data-icon="inline-start" :class="advancedOpen && 'rotate-90'" class="transition-transform" />
              Erweitert
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <FieldGroup class="pt-3">
              <Field>
                <FieldLabel for="account-args">Zusätzliche Argumente</FieldLabel>
                <Input
                  id="account-args"
                  v-model="form.extraArgs"
                  :placeholder="CLI_TEXT[provider].args"
                  spellcheck="false"
                  class="font-mono"
                />
                <FieldDescription>Hängt Nexa an jeden Start von {{ PROVIDERS[provider].name }} mit diesem Account.</FieldDescription>
              </Field>
              <template v-if="!editing">
                <Field orientation="horizontal">
                  <Checkbox id="account-custom-dir" v-model="form.useCustomDir" />
                  <FieldContent>
                    <FieldLabel for="account-custom-dir">Vorhandenen Konfigurationsordner verwenden</FieldLabel>
                    <FieldDescription>
                      Statt eines neuen Profils einen bestehenden Ordner ({{ CLI_TEXT[provider].dirEnv }}) mit Login und Verlauf.
                    </FieldDescription>
                  </FieldContent>
                </Field>
                <Field v-if="form.useCustomDir" :data-invalid="!!dirError || undefined">
                  <FieldLabel for="account-config-dir">Konfigurationsordner</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="account-config-dir"
                      v-model="form.configDir"
                      :placeholder="isWindows ? `C:\\Users\\…\\.${PROVIDERS[provider].command}-arbeit` : `~/.${PROVIDERS[provider].command}-arbeit`"
                      spellcheck="false"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton size="xs" @click="pickDir"><FolderOpenIcon /> Durchsuchen</InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldError v-if="dirError">{{ dirError }}</FieldError>
                </Field>
                <Field v-else orientation="horizontal">
                  <Checkbox id="account-import" v-model="form.importSettings" />
                  <FieldContent>
                    <FieldLabel for="account-import">Einstellungen aus {{ CLI_TEXT[provider].system }} übernehmen</FieldLabel>
                    <FieldDescription>{{ CLI_TEXT[provider].copies }}</FieldDescription>
                  </FieldContent>
                </Field>
              </template>
            </FieldGroup>
          </CollapsibleContent>
        </Collapsible>

        <Alert v-if="error" variant="destructive">
          <AlertTitle>Speichern fehlgeschlagen</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </form>

      <DialogFooter>
        <Button variant="outline" @click="open = false">Abbrechen</Button>
        <Button type="submit" form="account-form" :disabled="saving">
          <Spinner v-if="saving" data-icon="inline-start" />
          {{ editing ? 'Speichern' : canLogin(form.kind) ? 'Hinzufügen und anmelden' : 'Hinzufügen' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
