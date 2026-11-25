<script setup lang="ts">
import { CalendarClockIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldQuestionIcon, Trash2Icon } from '@lucide/vue'
import { computed, nextTick, reactive, ref, toRaw, watch } from 'vue'
import { toast } from 'vue-sonner'
import { PROVIDER_IDS, type PermissionMode, type ProviderId } from '@shared/chat'
import { identityLabel } from '@shared/accounts'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
import {
  HOURLY_STEPS,
  MAX_TASK_NAME,
  MAX_TASK_PROMPT,
  WEEK_ORDER,
  WEEKDAYS_SHORT,
  localDateTime,
  nextRunAfter,
  parseSchedule,
  type ScheduledTask,
  type ScheduledTaskInput,
  type TaskSchedule,
  type TaskScheduleKind,
} from '@shared/scheduled-tasks'
import AccountDot from '@/components/accounts/AccountDot.vue'
import ProjectPicker from '@/components/common/ProjectPicker.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useChatActions } from '@/composables/useChatActions'
import { attempt, errorMessage } from '@/lib/errors'
import { SCHEDULE_KINDS, formatWhen, permissionNote, runDetail, runLabel, taskPermissionMode } from '@/lib/scheduled'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useScheduledStore } from '@/stores/scheduled'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/**
 * A scheduled task to create or change, after Claude Desktop's dialog but in Nexa's terms: the prompt
 * with CLI, account, permissions and model under it as in the composer, the project the chats work in,
 * the schedule with its next run, and what each run does. Opened through `scheduled.dialog`.
 */
const store = useScheduledStore()
const accounts = useAccountsStore()
const providers = useProvidersStore()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const chat = useChatActions()

const open = computed({
  get: () => store.dialog !== null,
  set: (value) => {
    if (!value) store.dialog = null
  },
})

/** The task being changed; null for a new one (also a copy). Kept while the dialog closes. */
const editing = ref<ScheduledTask | null>(null)
const form = reactive<ScheduledTaskInput>(blankInput())
// Each kind of schedule keeps its own values, so switching back and forth loses nothing.
const kind = ref<TaskScheduleKind>('daily')
const time = ref('09:00')
const days = ref<string[]>(['1'])
const monthDay = ref('1')
const hourEvery = ref('1')
const hourMinute = ref(0)
const onceAt = ref('')
const advancedOpen = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const submitted = ref(false)

function defaultProvider(): ProviderId {
  const preferred = settings.settings.defaults.provider
  return providers.available.includes(preferred) ? preferred : (providers.available[0] ?? preferred)
}

function blankInput(): ScheduledTaskInput {
  const provider = defaultProvider()
  return {
    name: '',
    prompt: '',
    enabled: true,
    schedule: { kind: 'daily', time: '09:00' },
    provider,
    model: '',
    effort: '',
    permissionMode: taskPermissionMode(provider, settings.settings.defaults.permissionMode),
    projectId: ui.homeProjectId ?? sessions.active?.projectId ?? projects.projects[0]?.id ?? '',
    reuseChat: false,
    catchUp: true,
  }
}

function loadSchedule(schedule: TaskSchedule): void {
  kind.value = schedule.kind
  const soon = new Date(Date.now() + 3600_000)
  soon.setMinutes(0, 0, 0)
  onceAt.value = localDateTime(soon.getTime())
  if ('time' in schedule) time.value = schedule.time
  if (schedule.kind === 'weekly') days.value = schedule.days.map(String)
  if (schedule.kind === 'monthly') monthDay.value = String(schedule.day)
  if (schedule.kind === 'hourly') {
    hourEvery.value = String(schedule.every)
    hourMinute.value = schedule.minute
  }
  if (schedule.kind === 'once') onceAt.value = schedule.at
}

watch(
  () => store.dialog,
  (request) => {
    if (!request) return
    const task = request.kind === 'new' ? undefined : store.get(request.id)
    if (request.kind !== 'new' && !task) {
      store.dialog = null
      return
    }
    editing.value = request.kind === 'edit' ? task! : null
    const blank = blankInput()
    // Defaults first: a field the task lacks (account) mustn't keep the last dialog's value.
    Object.assign(form, blank, { account: undefined })
    days.value = ['1']
    time.value = '09:00'
    if (task) {
      const { id: _id, createdAt: _c, updatedAt: _u, nextRunAt: _n, runs: _r, ...input } = structuredClone(toRaw(task))
      Object.assign(form, input)
      if (request.kind === 'copy') form.name = `${task.name} (Kopie)`.slice(0, MAX_TASK_NAME)
    } else if (request.kind === 'new' && request.template) {
      form.name = request.template.name
      form.prompt = request.template.prompt
      form.schedule = structuredClone(toRaw(request.template.schedule))
    }
    loadSchedule(form.schedule)
    advancedOpen.value = false
    saving.value = false
    submitted.value = false
    error.value = null
    if (!providers.models[form.provider]?.length) void providers.loadModels(form.provider)
  },
  { immediate: true },
)

// The CLI ------------------------------------------------------------------------------------------

/** The CLIs that are on, and the task's own while it still names one that is off. */
const cliChoices = computed(() => PROVIDER_IDS.filter((id) => providers.offered.includes(id) || id === form.provider))

function pickProvider(id: ProviderId): void {
  if (id === form.provider) return
  form.provider = id
  form.account = undefined
  form.model = ''
  form.effort = ''
  form.permissionMode = taskPermissionMode(id, settings.settings.defaults.permissionMode)
  if (!providers.models[id]?.length) void providers.loadModels(id)
}

const accountChoices = computed(() => accounts.ofProvider(form.provider))
const defaultAccount = computed(() => accounts.get(accounts.defaultId(form.provider)))
const chosenAccount = computed(() => (form.account ? accounts.get(form.account) : undefined))
const accountGone = computed(() => !!form.account && !chosenAccount.value)

const models = computed(() => (providers.models[form.provider] ?? []).filter((m) => m.id))
const modelLabel = computed(() => {
  if (!form.model) return 'Standardmodell'
  return models.value.find((m) => m.id === form.model)?.label ?? form.model
})

const modes = computed(() => PROVIDERS[form.provider].permissionModes)
const note = computed(() => permissionNote(form.permissionMode))
const noteIcon = computed(() => (note.value.tone === 'danger' ? ShieldAlertIcon : note.value.tone === 'warning' ? ShieldQuestionIcon : ShieldCheckIcon))

function pickMode(mode: PermissionMode): void {
  form.permissionMode = mode
}

// Project ------------------------------------------------------------------------------------------

const project = computed(() => projects.get(form.projectId))

async function pickFolder(): Promise<void> {
  const path = await window.api.app.pickDirectory(settings.settings.defaults.projectsFolder || undefined)
  if (!path) return
  const created = await attempt(() => projects.create({ path }), 'Projekt ließ sich nicht anlegen')
  if (created) form.projectId = created.id
}

// Schedule -----------------------------------------------------------------------------------------

/** The schedule as the fields say; null while they don't make one (the error says why). */
const schedule = computed<{ value: TaskSchedule | null; error: string | null }>(() => {
  const raw = {
    kind: kind.value,
    time: time.value,
    days: days.value.map(Number),
    day: Number(monthDay.value),
    every: Number(hourEvery.value),
    minute: Number(hourMinute.value),
    at: onceAt.value,
  }
  try {
    return { value: parseSchedule(raw), error: null }
  } catch (e) {
    return { value: null, error: errorMessage(e) }
  }
})

const nextRun = computed(() => {
  const value = schedule.value.value
  if (!value) return null
  if (value.kind === 'manual') return 'Läuft nur, wenn du sie startest.'
  const next = nextRunAfter(value, Date.now())
  if (next === null) return 'Der Zeitpunkt liegt in der Vergangenheit.'
  return form.enabled ? `Nächster Lauf: ${formatWhen(next)}` : `Ausgeschaltet. Eingeschaltet liefe sie ${formatWhen(next)}.`
})

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1))
const RUN_MODES = [
  { value: 'new' as const, label: 'Neuer Chat' },
  { value: 'reuse' as const, label: 'Im selben Chat weiter' },
]
const runMode = computed({
  get: () => (form.reuseChat ? 'reuse' : 'new'),
  set: (value: 'new' | 'reuse') => (form.reuseChat = value === 'reuse'),
})

// Saving -------------------------------------------------------------------------------------------

const nameError = computed(() => (submitted.value && !form.name.trim() ? 'Gib der Aufgabe einen Namen.' : null))
const promptError = computed(() => (submitted.value && !form.prompt.trim() ? 'Schreib auf, was der Agent tun soll.' : null))

async function save(): Promise<void> {
  submitted.value = true
  error.value = null
  if (saving.value || nameError.value || promptError.value) return
  if (!schedule.value.value) {
    error.value = schedule.value.error
    return
  }
  if (!form.projectId || !project.value) {
    error.value = 'Wähle das Projekt, in dem die Aufgabe arbeitet.'
    return
  }
  saving.value = true
  try {
    const input: ScheduledTaskInput = { ...structuredClone(toRaw(form)), schedule: schedule.value.value }
    const task = await store.save(input, editing.value?.id)
    store.dialog = null
    const when = task.nextRunAt !== null ? `Nächster Lauf: ${formatWhen(task.nextRunAt)}` : undefined
    toast.success(editing.value ? `„${task.name}“ gespeichert` : `„${task.name}“ geplant`, { description: when })
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    saving.value = false
  }
}

async function remove(): Promise<void> {
  const task = editing.value
  if (!task) return
  const ok = await ui.confirm({
    title: `„${task.name}“ löschen?`,
    description: 'Die Aufgabe läuft nicht mehr. Die Chats ihrer bisherigen Läufe bleiben.',
    confirmText: 'Löschen',
    destructive: true,
  })
  if (!ok) return
  if ((await attempt(() => store.remove(task.id), 'Löschen fehlgeschlagen')) !== undefined) store.dialog = null
}

/** Runs of the task being changed, the newest first. */
const runs = computed(() => (editing.value ? (store.get(editing.value.id)?.runs ?? []) : []))

function openRun(sessionId: string): void {
  store.dialog = null
  void chat.open(sessionId)
}

function focusName(event: Event): void {
  event.preventDefault()
  void nextTick(() => document.getElementById(editing.value ? 'task-prompt' : 'task-name')?.focus())
}

const accountDetail = (id: string) => {
  const a = accounts.get(id)
  return a ? (identityLabel(a.identity) ?? '') : ''
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl" @open-auto-focus="focusName">
      <DialogHeader>
        <DialogTitle>{{ editing ? 'Aufgabe bearbeiten' : 'Neue geplante Aufgabe' }}</DialogTitle>
        <DialogDescription>Nexa schickt die Anweisungen nach Zeitplan, jeder Lauf ist ein Chat im gewählten Projekt.</DialogDescription>
      </DialogHeader>

      <form id="task-form" class="-mx-1 flex min-h-0 flex-col gap-5 overflow-y-auto px-1 py-0.5" @submit.prevent="save" @keydown.ctrl.enter.prevent="save">
        <div class="flex flex-col gap-1.5">
          <label for="task-name" class="text-sm font-medium">Name</label>
          <Input
            id="task-name"
            v-model="form.name"
            placeholder="z. B. Überblick am Morgen"
            autocomplete="off"
            :maxlength="MAX_TASK_NAME"
            :disabled="saving"
            :aria-invalid="!!nameError || undefined"
          />
          <p v-if="nameError" class="text-xs text-destructive">{{ nameError }}</p>
        </div>

        <div class="flex flex-col gap-1.5">
          <label for="task-prompt" class="text-sm font-medium">Anweisungen</label>
          <!-- Like the composer: the prompt, and under it who answers it and how. -->
          <div
            :class="
              cn(
                'flex flex-col rounded-xl border bg-card/60 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
                promptError && 'border-destructive',
              )
            "
          >
            <textarea
              id="task-prompt"
              v-model="form.prompt"
              rows="5"
              :maxlength="MAX_TASK_PROMPT"
              :disabled="saving"
              placeholder="Was soll der Agent bei jedem Lauf tun?"
              class="max-h-72 min-h-28 w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none [field-sizing:content] placeholder:text-muted-foreground"
            />
            <div class="flex flex-wrap items-center gap-0.5 border-t px-1.5 py-1">
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button type="button" variant="ghost" size="sm" class="gap-1.5 px-2 text-muted-foreground" :disabled="saving">
                    <ProviderIcon :provider="form.provider" class="size-3.5" />
                    <span class="text-foreground">{{ PROVIDERS[form.provider].short }}</span>
                    <ChevronDownIcon class="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" class="w-60">
                  <DropdownMenuLabel>CLI</DropdownMenuLabel>
                  <DropdownMenuItem v-for="id in cliChoices" :key="id" :disabled="!providers.available.includes(id)" class="gap-2" @select="pickProvider(id)">
                    <ProviderIcon :provider="id" />
                    <span class="flex flex-col">
                      <span>{{ PROVIDERS[id].name }}</span>
                      <span v-if="!providers.available.includes(id)" class="text-xs text-muted-foreground">nicht bereit</span>
                    </span>
                    <CheckIcon v-if="id === form.provider" class="ml-auto" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    :class="cn('gap-1.5 px-2 text-muted-foreground', accountGone && 'text-destructive')"
                    :disabled="saving"
                    v-tooltip="chosenAccount ? 'Account, mit dem die Läufe arbeiten' : `Standard-Account, gerade ${defaultAccount?.name ?? '–'}`"
                  >
                    <AccountDot :color="(chosenAccount ?? defaultAccount)?.color" />
                    <span class="max-w-36 truncate text-foreground">{{ accountGone ? 'Account fehlt' : (chosenAccount?.name ?? 'Standard-Account') }}</span>
                    <ChevronDownIcon class="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" class="w-80">
                  <DropdownMenuLabel>Account</DropdownMenuLabel>
                  <DropdownMenuItem class="items-start gap-2.5" @select="form.account = undefined">
                    <AccountDot :color="defaultAccount?.color" class="mt-1.5" />
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span>Standard-Account</span>
                      <span class="truncate text-xs text-muted-foreground">Gerade {{ defaultAccount?.name ?? '–' }}; folgt der Vorgabe der CLI</span>
                    </span>
                    <CheckIcon v-if="!form.account" class="mt-0.5 shrink-0" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem v-for="a in accountChoices" :key="a.id" class="items-start gap-2.5" @select="form.account = a.id">
                    <AccountDot :color="a.color" class="mt-1.5" />
                    <span class="flex min-w-0 flex-1 flex-col">
                      <span class="truncate">{{ a.name }}</span>
                      <span v-if="accountDetail(a.id)" class="truncate text-xs text-muted-foreground">{{ accountDetail(a.id) }}</span>
                    </span>
                    <CheckIcon v-if="form.account === a.id" class="mt-0.5 shrink-0" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    :class="cn('gap-1.5 px-2 text-muted-foreground', form.permissionMode === 'full' && 'text-destructive')"
                    :disabled="saving"
                  >
                    <component :is="noteIcon" class="size-3.5" />
                    <span :class="form.permissionMode === 'full' ? 'text-destructive' : 'text-foreground'">{{ PERMISSION_MODES[form.permissionMode].label }}</span>
                    <ChevronDownIcon class="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" class="w-72">
                  <DropdownMenuLabel>Freigaben</DropdownMenuLabel>
                  <DropdownMenuItem v-for="m in modes" :key="m" class="items-start" @select="pickMode(m)">
                    <span class="flex flex-col">
                      <span :class="m === 'full' && 'text-destructive'">{{ PERMISSION_MODES[m].label }}</span>
                      <span class="text-xs text-muted-foreground">{{ PERMISSION_MODES[m].description }}</span>
                    </span>
                    <CheckIcon v-if="m === form.permissionMode" class="mt-0.5 ml-auto shrink-0" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu @update:open="(o: boolean) => o && !models.length && providers.loadModels(form.provider)">
                <DropdownMenuTrigger as-child>
                  <Button type="button" variant="ghost" size="sm" class="ml-auto gap-1.5 px-2 text-muted-foreground" :disabled="saving">
                    <span class="max-w-40 truncate text-foreground">{{ modelLabel }}</span>
                    <ChevronDownIcon class="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="max-h-96 w-72 overflow-y-auto">
                  <DropdownMenuLabel>Modell</DropdownMenuLabel>
                  <DropdownMenuItem class="items-start gap-2" @select="form.model = ''">
                    <span class="flex flex-col">
                      <span>Standardmodell</span>
                      <span class="text-xs text-muted-foreground">Wie für neue Chats eingestellt</span>
                    </span>
                    <CheckIcon v-if="!form.model" class="mt-0.5 ml-auto shrink-0" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem v-if="!models.length" disabled>Wird geladen …</DropdownMenuItem>
                  <DropdownMenuItem v-for="m in models" :key="m.id" class="items-start gap-2" @select="form.model = m.id">
                    <span class="flex min-w-0 flex-col">
                      <span>{{ m.label }}</span>
                      <span v-if="m.description" class="line-clamp-2 text-xs text-muted-foreground">{{ m.description }}</span>
                    </span>
                    <CheckIcon v-if="m.id === form.model" class="mt-0.5 ml-auto shrink-0" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <p v-if="promptError" class="text-xs text-destructive">{{ promptError }}</p>
          <div
            :class="
              cn(
                'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[0.8rem] leading-relaxed',
                note.tone === 'danger' ? 'border-destructive/40 text-destructive' : note.tone === 'warning' ? 'border-warning/40' : 'text-muted-foreground',
              )
            "
          >
            <component :is="noteIcon" :class="cn('mt-0.5 size-4 shrink-0', note.tone === 'warning' && 'text-warning')" />
            <span>{{ note.text }}</span>
          </div>
        </div>

        <div class="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-4 text-sm">
          <span class="font-medium">Projekt</span>
          <div class="flex min-w-0 items-center gap-2">
            <ProjectPicker :project="project" @select="(id) => (form.projectId = id)" @pick-folder="pickFolder" />
            <span v-if="form.projectId && !project" class="text-xs text-destructive">Das Projekt gibt es nicht mehr.</span>
          </div>

          <span class="self-start pt-1.5 font-medium">Zeitplan</span>
          <div class="flex min-w-0 flex-col gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <Select v-model="kind" :disabled="saving">
                <SelectTrigger class="w-40" aria-label="Zeitplan"><CalendarClockIcon class="size-3.5 opacity-70" /><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="k in SCHEDULE_KINDS" :key="k.value" :value="k.value">{{ k.label }}</SelectItem>
                </SelectContent>
              </Select>

              <template v-if="kind === 'hourly'">
                <Select v-model="hourEvery" :disabled="saving">
                  <SelectTrigger class="w-36" aria-label="Wie oft"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="h in HOURLY_STEPS" :key="h" :value="String(h)">{{ h === 1 ? 'Jede Stunde' : `Alle ${h} Stunden` }}</SelectItem>
                  </SelectContent>
                </Select>
                <span class="text-muted-foreground">zur Minute</span>
                <Input v-model.number="hourMinute" type="number" min="0" max="59" class="w-20 tabular-nums" aria-label="Minute" :disabled="saving" />
              </template>

              <template v-else-if="kind === 'monthly'">
                <span class="text-muted-foreground">am</span>
                <Select v-model="monthDay" :disabled="saving">
                  <SelectTrigger class="w-20" aria-label="Tag des Monats"><SelectValue /></SelectTrigger>
                  <SelectContent class="max-h-72">
                    <SelectItem v-for="d in MONTH_DAYS" :key="d" :value="d">{{ d }}.</SelectItem>
                  </SelectContent>
                </Select>
              </template>

              <Input v-if="kind === 'once'" v-model="onceAt" type="datetime-local" class="w-56" aria-label="Datum und Uhrzeit" :disabled="saving" />
              <template v-else-if="kind !== 'manual' && kind !== 'hourly'">
                <span class="text-muted-foreground">um</span>
                <Input v-model="time" type="time" class="w-28 tabular-nums" aria-label="Uhrzeit" :disabled="saving" />
              </template>
            </div>
            <ToggleGroup v-if="kind === 'weekly'" v-model="days" type="multiple" variant="outline" size="sm" :spacing="0" class="self-start" aria-label="Wochentage">
              <ToggleGroupItem v-for="d in WEEK_ORDER" :key="d" :value="String(d)" class="w-10">{{ WEEKDAYS_SHORT[d] }}</ToggleGroupItem>
            </ToggleGroup>
            <p v-if="kind === 'monthly' && Number(monthDay) > 28" class="text-xs text-muted-foreground">In kürzeren Monaten am letzten Tag.</p>
            <p :class="cn('text-xs', schedule.error ? 'text-destructive' : 'text-muted-foreground')">{{ schedule.error ?? nextRun }}</p>
          </div>

          <span class="font-medium">Aktiv</span>
          <label class="flex items-center gap-2.5 text-muted-foreground">
            <Switch v-model="form.enabled" :disabled="saving" />
            {{ form.enabled ? 'Läuft nach Zeitplan' : 'Läuft nur von Hand' }}
          </label>
        </div>

        <Collapsible v-model:open="advancedOpen">
          <CollapsibleTrigger as-child>
            <Button type="button" variant="ghost" size="sm" class="-ml-2 self-start">
              <ChevronRightIcon data-icon="inline-start" :class="advancedOpen && 'rotate-90'" class="transition-transform" />
              Erweiterte Einstellungen
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="mt-2 flex flex-col divide-y rounded-xl border text-sm">
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="font-medium">Jeder Lauf</span>
                  <span class="text-xs text-muted-foreground">
                    Im selben Chat kennt der Agent die früheren Läufe und kann vergleichen, was sich geändert hat; der Kontext wächst dabei.
                  </span>
                </div>
                <SegmentedControl v-model="runMode" :options="RUN_MODES" size="sm" :disabled="saving" />
              </div>
              <label class="flex cursor-pointer items-center gap-4 px-4 py-3">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="font-medium">Verpasste Läufe nachholen</span>
                  <span class="text-xs text-muted-foreground">
                    War Nexa zu oder schlief der Computer, läuft die Aufgabe einmal, sobald Nexa wieder läuft, egal wie viele Läufe ausfielen.
                  </span>
                </div>
                <Switch v-model="form.catchUp" :disabled="saving" />
              </label>
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span class="font-medium">Nur, solange Nexa läuft</span>
                  <span class="text-xs text-muted-foreground">
                    {{
                      settings.settings.general.runInTray
                        ? 'Nexa läuft im Infobereich weiter, auch wenn das Fenster zu ist.'
                        : 'Mit „Im Infobereich weiterlaufen“ laufen Aufgaben auch bei geschlossenem Fenster.'
                    }}
                  </span>
                </div>
                <Button
                  v-if="!settings.settings.general.runInTray"
                  type="button"
                  variant="outline"
                  size="sm"
                  @click="ui.openSettings('general', 'general.runInTray')"
                >
                  Einstellungen
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <div v-if="runs.length" class="flex flex-col gap-1.5">
          <span class="text-sm font-medium">Letzte Läufe</span>
          <ul class="flex flex-col divide-y rounded-xl border text-[0.82rem]">
            <li v-for="run in runs.slice(0, 8)" :key="run.at" class="flex items-center gap-3 px-3 py-2">
              <span class="w-28 shrink-0 text-muted-foreground tabular-nums">{{ formatWhen(run.at) }}</span>
              <span
                :class="cn('min-w-0 flex-1 truncate', run.outcome === 'error' && 'text-destructive', run.outcome !== 'started' && run.outcome !== 'error' && 'text-muted-foreground')"
                v-tooltip="runDetail(run)"
              >
                {{ runLabel(run) }}<template v-if="run.error">: {{ run.error }}</template>
              </span>
              <Button v-if="run.sessionId && sessions.get(run.sessionId)" type="button" variant="ghost" size="xs" @click="openRun(run.sessionId)">Chat öffnen</Button>
            </li>
          </ul>
        </div>

        <Alert v-if="error" variant="destructive">
          <AlertTitle>Speichern ging nicht</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </form>

      <DialogFooter class="sm:justify-between">
        <Button v-if="editing" type="button" variant="ghost" class="text-destructive hover:text-destructive" :disabled="saving" @click="remove">
          <Trash2Icon data-icon="inline-start" />
          Löschen
        </Button>
        <span v-else />
        <div class="flex gap-2">
          <Button type="button" variant="outline" @click="open = false">Abbrechen</Button>
          <Button type="submit" form="task-form" :disabled="saving">
            <Spinner v-if="saving" data-icon="inline-start" />
            {{ editing ? 'Speichern' : 'Erstellen' }}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
