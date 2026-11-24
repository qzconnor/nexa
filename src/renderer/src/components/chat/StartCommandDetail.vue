<script setup lang="ts">
import { CircleStopIcon, PlayIcon, RotateCwIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { ShellStatus } from '@shared/chat'
import { relativeDir } from '@shared/start-commands'
import type { StartCommand } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { errorMessage } from '@/lib/errors'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useStartCommandsStore } from '@/stores/start-commands'
import ShellOutput from './ShellOutput.vue'

/**
 * A start command of the chat's project unfolded in the dock, below its line: what its last run
 * wrote, and the buttons to start, restart or end it. Main keeps the output; it is asked for while the command runs.
 */
const props = defineProps<{ projectId: string; command: StartCommand }>()
const projects = useProjectsStore()
const startCommands = useStartCommandsStore()
const now = useClock(1000)

/** While it runs, its output is asked for this often. */
const POLL_MS = 1000
const STATE: Record<ShellStatus, string> = { running: 'läuft', done: 'beendet', error: 'fehlgeschlagen', stopped: 'abgebrochen' }

const run = computed(() => startCommands.runOf(props.projectId, props.command.id))
// Values, not the run: every report from main brings new objects, for other commands too.
const startedAt = computed(() => run.value?.startedAt)
const status = computed(() => run.value?.status ?? null)
const running = computed(() => status.value === 'running')
const elapsed = computed(() => (run.value ? formatDuration(Math.max(0, (run.value.endedAt ?? now.value) - run.value.startedAt)) : ''))
const exitCode = computed(() => (run.value?.exitCode !== undefined && run.value.exitCode !== null && run.value.exitCode !== 0 ? run.value.exitCode : null))
/** Where it runs, in the project: its folder, else the project's own. */
const folder = computed(() => {
  const project = projects.get(props.projectId)
  const cwd = run.value?.cwd
  const inProject = project && cwd ? relativeDir(project.path, cwd) : (props.command.dir ?? '')
  return inProject || 'Projektordner'
})
/** Saved differently from how it runs: the change counts from its next start. */
const edited = computed(() => running.value && run.value!.command !== props.command.command)

// ── Output ──

const output = ref('')
const truncated = ref(false)
const loadError = ref<string | null>(null)
let seq = 0

async function load(): Promise<void> {
  const mine = ++seq
  try {
    const result = await window.api.startCommands.output(props.projectId, props.command.id)
    if (mine !== seq) return
    // Blank lines a program starts with only push the output away from its command.
    output.value = result.text.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '')
    truncated.value = result.truncated
    loadError.value = null
  } catch (error) {
    if (mine === seq) loadError.value = errorMessage(error)
  }
}

// A new run starts with nothing; while it runs it is asked again and again, once more as it ends.
watch(
  () => [startedAt.value, status.value] as const,
  ([started, state], before, onCleanup) => {
    if (started !== before?.[0]) {
      output.value = ''
      truncated.value = false
    }
    if (started === undefined) return
    void load()
    if (state !== 'running') return
    const timer = setInterval(() => void load(), POLL_MS)
    onCleanup(() => clearInterval(timer))
  },
  { immediate: true },
)

// ── Start, restart, stop ──

/** What was asked for, until the run shows it (an end takes a moment: the process and what it started go). */
const pending = ref<'start' | 'stop' | null>(null)
watch(
  () => [startedAt.value, status.value] as const,
  () => (pending.value = null),
)

async function start(): Promise<void> {
  pending.value = 'start'
  await startCommands.start(props.projectId, props.command.id)
  pending.value = null
}

async function restart(): Promise<void> {
  pending.value = 'start'
  if (!(await startCommands.restart(props.projectId, props.command.id))) pending.value = null
}

async function stop(): Promise<void> {
  pending.value = 'stop'
  if (!(await startCommands.stop(props.projectId, props.command.id))) pending.value = null
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <div class="flex min-w-0 items-start gap-3">
      <code
        class="selectable line-clamp-3 min-w-0 flex-1 pt-0.5 font-mono text-[0.76rem] break-all text-muted-foreground"
        :title="run?.command ?? command.command"
        ><span class="text-(--syn-comment) select-none">$ </span>{{ run?.command ?? command.command }}</code
      >
      <div class="flex shrink-0 items-center gap-1">
        <template v-if="running">
          <Button variant="ghost" size="xs" :disabled="!!pending" @click="restart">
            <Spinner v-if="pending === 'start'" />
            <RotateCwIcon v-else />
            Neu starten
          </Button>
          <Button variant="outline" size="xs" :disabled="!!pending" @click="stop">
            <Spinner v-if="pending === 'stop'" />
            <CircleStopIcon v-else />
            Beenden
          </Button>
        </template>
        <Button v-else variant="outline" size="xs" :disabled="!!pending" @click="start">
          <Spinner v-if="pending === 'start'" />
          <PlayIcon v-else />
          Starten
        </Button>
      </div>
    </div>

    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-muted-foreground">
      <span v-if="status" :class="cn(running && 'text-shimmer', status === 'error' && 'text-destructive')">
        {{ STATE[status] }} {{ running ? 'seit' : 'nach' }} {{ elapsed }}
      </span>
      <span v-else>läuft nicht</span>
      <span v-if="exitCode !== null" class="font-mono text-destructive">exit {{ exitCode }}</span>
      <span class="rounded bg-muted px-1.5">Startbefehl</span>
      <span v-if="run?.shell">{{ run.shell }}</span>
      <span class="max-w-[18rem] truncate font-mono" :title="run?.cwd">{{ folder }}</span>
      <span v-if="truncated">nur das Ende der Ausgabe</span>
      <span v-if="edited">· geändert, gilt ab „Neu starten“</span>
    </div>
    <p v-if="run?.error" class="selectable rounded-md bg-destructive/10 px-3 py-1.5 text-[0.78rem] text-destructive">{{ run.error }}</p>

    <div class="h-[min(18rem,36vh)]">
      <ShellOutput :text="output" :failed="status === 'error'">
        <span v-if="loadError">{{ loadError }}</span>
        <span v-else-if="!run">Noch nicht gestartet.</span>
        <span v-else-if="running">Noch keine Ausgabe.</span>
        <span v-else-if="!run.error">Keine Ausgabe.</span>
        <span v-else>Ohne Ausgabe beendet.</span>
      </ShellOutput>
    </div>
  </div>
</template>
