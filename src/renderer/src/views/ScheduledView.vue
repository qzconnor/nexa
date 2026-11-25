<script setup lang="ts">
import { CalendarClockIcon, CopyIcon, EllipsisIcon, MessageSquareIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon } from '@lucide/vue'
import { computed, reactive } from 'vue'
import { toast } from 'vue-sonner'
import { PROVIDERS } from '@shared/providers'
import { describeSchedule, type ScheduledTask } from '@shared/scheduled-tasks'
import AccountDot from '@/components/accounts/AccountDot.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { TASK_TEMPLATES, type TaskTemplate } from '@/components/scheduled/task-templates'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useChatActions } from '@/composables/useChatActions'
import { useClock } from '@/composables/useClock'
import { attempt, errorMessage } from '@/lib/errors'
import { formatWhen, runDetail, runLabel, sortTasks } from '@/lib/scheduled'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProjectsStore } from '@/stores/projects'
import { useScheduledStore } from '@/stores/scheduled'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/**
 * Tasks an agent does on a schedule, each run a chat in its project: the list with what runs next and
 * how the last run went, and templates to start from. The dialog (ScheduledTaskDialog) does the rest.
 */
const store = useScheduledStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const chat = useChatActions()
const now = useClock(30_000)

void attempt(() => store.load(), 'Geplante Aufgaben ließen sich nicht laden')

const tasks = computed(() => sortTasks(store.tasks))
/** Tasks whose „Jetzt ausführen“ is under way. */
const starting = reactive(new Set<string>())

function accountOf(task: ScheduledTask) {
  return accounts.get(task.account ?? accounts.defaultId(task.provider))
}

/** The chat of the task's last run, while Nexa still has it. */
function lastChat(task: ScheduledTask): string | null {
  const id = task.runs.find((r) => r.sessionId)?.sessionId
  return id && sessions.get(id) ? id : null
}

function nextLabel(task: ScheduledTask): string {
  if (task.schedule.kind === 'manual') return 'Nur von Hand'
  if (!task.enabled) return 'Ausgeschaltet'
  if (task.nextRunAt === null) return task.schedule.kind === 'once' ? 'Gelaufen' : 'Kein weiterer Lauf'
  return formatWhen(task.nextRunAt, now.value)
}

function edit(task: ScheduledTask): void {
  store.dialog = { kind: 'edit', id: task.id }
}

function create(template?: TaskTemplate): void {
  store.dialog = { kind: 'new', template }
}

async function runNow(task: ScheduledTask): Promise<void> {
  if (starting.has(task.id)) return
  starting.add(task.id)
  try {
    const run = await store.runNow(task.id)
    const sessionId = run.sessionId
    const open = sessionId ? { label: 'Öffnen', onClick: () => void chat.open(sessionId) } : undefined
    if (run.outcome === 'started') toast.success(`„${task.name}“ läuft`, { action: open })
    else if (run.outcome === 'skipped') toast.info(`„${task.name}“ übersprungen`, { description: run.error, action: open })
    else toast.error(`„${task.name}“ ließ sich nicht starten`, { description: run.error, action: open })
  } catch (e) {
    toast.error(`„${task.name}“ ließ sich nicht starten`, { description: errorMessage(e) })
  } finally {
    starting.delete(task.id)
  }
}

function setEnabled(task: ScheduledTask, enabled: boolean): void {
  void attempt(() => store.setEnabled(task.id, enabled), enabled ? 'Einschalten fehlgeschlagen' : 'Ausschalten fehlgeschlagen')
}

async function remove(task: ScheduledTask): Promise<void> {
  const ok = await ui.confirm({
    title: `„${task.name}“ löschen?`,
    description: 'Die Aufgabe läuft nicht mehr. Die Chats ihrer bisherigen Läufe bleiben.',
    confirmText: 'Löschen',
    destructive: true,
  })
  if (ok) await attempt(() => store.remove(task.id), 'Löschen fehlgeschlagen')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header class="flex flex-wrap items-end gap-3">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h1 class="text-xl font-semibold tracking-tight">Geplante Aufgaben</h1>
          <p class="text-sm text-muted-foreground">Ein Agent erledigt sie nach Zeitplan in einem Projekt, jeder Lauf ist ein Chat.</p>
        </div>
        <Button @click="create()">
          <PlusIcon data-icon="inline-start" />
          Neue Aufgabe
        </Button>
      </header>

      <div v-if="!store.loaded" class="flex flex-col divide-y rounded-xl border">
        <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-4 py-3.5">
          <Skeleton class="size-8 rounded-lg" />
          <div class="flex flex-1 flex-col gap-2">
            <Skeleton class="h-4 w-1/3" />
            <Skeleton class="h-3 w-1/2" />
          </div>
        </div>
      </div>

      <Empty v-else-if="!tasks.length" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><CalendarClockIcon /></EmptyMedia>
          <EmptyTitle>Noch keine geplanten Aufgaben</EmptyTitle>
          <EmptyDescription>
            Ein Überblick am Morgen, die offenen Pull Requests, ein Testlauf in der Nacht: Beschreib, was ein Agent regelmäßig tun soll, und Nexa startet
            ihn zur gewählten Zeit.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" @click="create()">
            <PlusIcon data-icon="inline-start" />
            Aufgabe anlegen
          </Button>
        </EmptyContent>
      </Empty>

      <ul v-else class="flex flex-col divide-y overflow-hidden rounded-xl border bg-card/40">
        <li
          v-for="task in tasks"
          :key="task.id"
          class="group/task flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
          @click="edit(task)"
        >
          <div :class="cn('flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background', !task.enabled && 'opacity-50')">
            <ProviderIcon :provider="task.provider" class="size-4" />
          </div>
          <div :class="cn('flex min-w-0 flex-1 flex-col gap-0.5', !task.enabled && task.schedule.kind !== 'manual' && 'opacity-60')">
            <span class="truncate text-sm font-medium">{{ task.name }}</span>
            <span class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span class="shrink-0">{{ describeSchedule(task.schedule) }}</span>
              <span aria-hidden="true">·</span>
              <span class="truncate">{{ projects.get(task.projectId)?.name ?? 'Projekt fehlt' }}</span>
              <span aria-hidden="true">·</span>
              <span class="flex min-w-0 items-center gap-1" v-tooltip="`${PROVIDERS[task.provider].name}${task.account ? '' : ', Standard-Account'}`">
                <AccountDot :color="accountOf(task)?.color" />
                <span class="truncate">{{ accountOf(task)?.name ?? (task.account ? 'Account fehlt' : PROVIDERS[task.provider].short) }}</span>
              </span>
            </span>
          </div>

          <div class="hidden w-40 shrink-0 flex-col items-end gap-0.5 text-xs sm:flex">
            <span class="text-muted-foreground">{{ task.enabled && task.nextRunAt !== null ? 'Nächster Lauf' : '' }}</span>
            <span class="tabular-nums">{{ nextLabel(task) }}</span>
          </div>

          <div class="hidden w-44 shrink-0 flex-col items-end gap-0.5 text-xs md:flex">
            <template v-if="task.runs[0]">
              <span class="text-muted-foreground tabular-nums">{{ formatWhen(task.runs[0].at, now) }}</span>
              <span
                :class="cn('flex items-center gap-1.5', task.runs[0].outcome === 'error' ? 'text-destructive' : 'text-muted-foreground')"
                v-tooltip="runDetail(task.runs[0])"
              >
                <Spinner v-if="lastChat(task) && chat.working(lastChat(task)!)" class="size-3" />
                <template v-if="lastChat(task) && chat.working(lastChat(task)!)">arbeitet</template>
                <template v-else>{{ runLabel(task.runs[0]) }}</template>
              </span>
            </template>
            <span v-else class="text-muted-foreground">Noch nicht gelaufen</span>
          </div>

          <div class="flex shrink-0 items-center gap-1" @click.stop>
            <Button
              variant="ghost"
              size="icon-sm"
              :disabled="starting.has(task.id)"
              :aria-label="`„${task.name}“ jetzt ausführen`"
              v-tooltip="'Jetzt ausführen'"
              @click="runNow(task)"
            >
              <Spinner v-if="starting.has(task.id)" />
              <PlayIcon v-else />
            </Button>
            <Switch
              v-if="task.schedule.kind !== 'manual'"
              :model-value="task.enabled"
              :aria-label="task.enabled ? 'Ausschalten' : 'Einschalten'"
              v-tooltip="task.enabled ? 'Läuft nach Zeitplan' : 'Ausgeschaltet'"
              class="mx-1"
              @update:model-value="(v: boolean) => setEnabled(task, v)"
            />
            <!-- Keeps the columns of the rows in line where a task has no schedule to switch. -->
            <span v-else aria-hidden="true" class="mx-1 w-8" />
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon-sm" aria-label="Mehr"><EllipsisIcon /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-56">
                <DropdownMenuItem @select="edit(task)"><PencilIcon />Bearbeiten</DropdownMenuItem>
                <DropdownMenuItem @select="store.dialog = { kind: 'copy', id: task.id }"><CopyIcon />Duplizieren</DropdownMenuItem>
                <DropdownMenuItem v-if="lastChat(task)" @select="chat.open(lastChat(task)!)"><MessageSquareIcon />Chat des letzten Laufs</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" @select="remove(task)"><Trash2Icon />Löschen</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </li>
      </ul>

      <p v-if="store.loaded && tasks.length && !settings.settings.general.runInTray" class="-mt-3 text-xs text-muted-foreground">
        Aufgaben laufen nur, solange Nexa läuft.
        <button type="button" class="underline underline-offset-2 hover:text-foreground" @click="ui.openSettings('general', 'general.runInTray')">
          Im Infobereich weiterlaufen
        </button>
        lässt sie auch bei geschlossenem Fenster laufen.
      </p>

      <section class="flex flex-col gap-3">
        <div class="flex flex-col gap-0.5">
          <h2 class="text-sm font-semibold">Vorlagen</h2>
          <p class="text-xs text-muted-foreground">Ein Anfang zum Anpassen: CLI, Account, Freigaben und Projekt wählst du im Dialog.</p>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
          <button
            v-for="template in TASK_TEMPLATES"
            :key="template.id"
            type="button"
            class="flex flex-col gap-2 rounded-xl border bg-card/40 p-3.5 text-left transition-colors hover:border-ring/60 hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            @click="create(template)"
          >
            <span class="flex items-center gap-2">
              <component :is="template.icon" class="size-4 text-muted-foreground" />
              <span class="text-sm font-medium">{{ template.name }}</span>
            </span>
            <span class="line-clamp-2 text-xs text-muted-foreground">{{ template.description }}</span>
            <span class="mt-auto text-[0.7rem] text-muted-foreground/80">{{ describeSchedule(template.schedule) }}</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
