<script setup lang="ts">
import { CircleStopIcon, PlayIcon, RotateCwIcon } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'
import type { ShellStatus } from '@shared/chat'
import { relativeDir, startCommandLabel } from '@shared/start-commands'
import type { StartCommand } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { errorMessage } from '@/lib/errors'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/stores/projects'
import { useStartCommandsStore } from '@/stores/start-commands'

/**
 * A start command of the chat's project in the shell panel: what its last run wrote, and the buttons
 * to start, restart or end it. Main keeps the output; it is asked for while the command runs.
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

// The output follows its end, unless the user scrolled up to read.
const pre = ref<HTMLElement | null>(null)
let pinned = true
function onScroll(): void {
  const el = pre.value
  if (el) pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}
watch(output, async () => {
  if (!pinned) return
  await nextTick()
  if (pre.value) pre.value.scrollTop = pre.value.scrollHeight
})

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
      pinned = true
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
  <div class="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
    <div class="truncate text-[0.95rem] font-medium" :title="startCommandLabel(command)">{{ startCommandLabel(command) }}</div>
    <pre
      class="selectable max-h-32 shrink-0 overflow-auto rounded-md border bg-(--code-bg) px-3 py-2 font-mono text-[0.78rem] whitespace-pre-wrap text-(--code-fg)"
    ><span class="text-(--syn-comment) select-none">$ </span>{{ run?.command ?? command.command }}</pre>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span class="rounded bg-muted px-1.5">Startbefehl</span>
      <span v-if="run?.shell">{{ run.shell }}</span>
      <span v-if="status" :class="cn(running && 'text-shimmer', status === 'error' && 'text-destructive')">
        {{ STATE[status] }}<template v-if="running"> seit {{ elapsed }}</template><template v-else> nach {{ elapsed }}</template>
      </span>
      <span v-else>Läuft nicht</span>
      <span v-if="exitCode !== null" class="font-mono text-destructive">exit {{ exitCode }}</span>
      <span class="truncate font-mono" :title="run?.cwd">{{ folder }}</span>
    </div>
    <p v-if="edited" class="text-xs text-muted-foreground">Geändert: Der neue Befehl gilt ab „Neu starten“.</p>

    <div class="flex items-center gap-2">
      <span class="text-xs font-medium text-muted-foreground">Ausgabe</span>
      <span v-if="truncated" class="text-xs text-muted-foreground">(nur das Ende)</span>
      <div class="ml-auto flex items-center gap-1">
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
    <p v-if="run?.error" class="selectable shrink-0 rounded-md bg-destructive/10 px-3 py-2 text-[0.8rem] text-destructive">{{ run.error }}</p>
    <pre
      v-if="output"
      ref="pre"
      :class="
        cn(
          'selectable min-h-0 flex-1 overflow-auto rounded-md border bg-(--code-bg) px-3 py-2 font-mono text-[0.75rem] whitespace-pre-wrap text-(--code-fg)',
          status === 'error' && 'border-destructive/40',
        )
      "
      @scroll="onScroll"
      >{{ output.length > 60000 ? '…\n' + output.slice(-60000) : output }}</pre
    >
    <div v-else class="flex flex-1 items-start text-[0.82rem] text-muted-foreground">
      <span v-if="loadError">{{ loadError }}</span>
      <span v-else-if="!run">Noch nicht gestartet.</span>
      <span v-else-if="running">Noch keine Ausgabe.</span>
      <span v-else-if="!run.error">Keine Ausgabe.</span>
    </div>
  </div>
</template>
