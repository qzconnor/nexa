<script setup lang="ts">
import { CircleStopIcon, RefreshCwIcon, SquareTerminalIcon, XIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { AgentItem, ChatItem, ShellStatus, ToolItem } from '@shared/chat'
import { startCommandLabel } from '@shared/start-commands'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { useProjectPath } from '@/composables/useProjectPath'
import { attempt, errorMessage } from '@/lib/errors'
import { formatDuration } from '@/lib/format'
import { plainOutput, runningShells, shellCommand, shellEnd, shellPurpose, shellStatus, startCommandOf, startShellId } from '@/lib/shells'
import { cn } from '@/lib/utils'
import { useStartCommandsStore } from '@/stores/start-commands'
import { useUiStore } from '@/stores/ui'
import StartCommandDetail from './StartCommandDetail.vue'

/**
 * The chat's shells at work beside it: what each one wrote, and a way to end one. Claude Code keeps
 * the output of its shells and hands out the end of it; Codex streams it into the item. A finished
 * one shows only when opened from the chat; the panel is for what runs. The start commands of the
 * chat's project that run are listed first; one that ends stays shown, so its last words can be read.
 */
const props = defineProps<{ items: ChatItem[]; sessionId: string; projectId?: string | null }>()
const ui = useUiStore()
const startCommands = useStartCommandsStore()
const now = useClock(1000)
const { shorten } = useProjectPath()

/** While one runs, its output is asked for this often. */
const POLL_MS = 1500

const shells = computed(() => {
  const list = runningShells(props.items)
  // The shown one stays listed when it is through (opened from the chat).
  const shown = props.items.find((i): i is ToolItem => i.kind === 'tool' && i.id === ui.shellId)
  return shown && !list.includes(shown) ? [...list, shown].sort((a, b) => a.startedAt - b.startedAt) : list
})
const shell = computed(() => shells.value.find((s) => s.id === ui.shellId))
const status = computed<ShellStatus>(() => (shell.value ? shellStatus(shell.value) : 'done'))

/** The project's start commands in the list: those that run, and the one shown. */
const starts = computed(() => {
  const shown = startCommandOf(ui.shellId)
  return startCommands.commandsOf(props.projectId).filter((c) => c.id === shown || startCommands.isRunning(props.projectId, c.id))
})
const start = computed(() => starts.value.find((c) => startShellId(c.id) === ui.shellId))
const startStatus = (id: string): ShellStatus | null => startCommands.runOf(props.projectId, id)?.status ?? null
const startElapsed = (id: string) => {
  const run = startCommands.runOf(props.projectId, id)
  return run ? formatDuration(Math.max(0, (run.endedAt ?? now.value) - run.startedAt)) : ''
}
const runningCount = computed(
  () => shells.value.filter((s) => shellStatus(s) === 'running').length + starts.value.filter((c) => startStatus(c.id) === 'running').length,
)

// When the one shown ends, the panel goes on with another that runs, or closes.
watch(
  () => [ui.shellId, shell.value ? shellStatus(shell.value) : null] as const,
  ([id, state], before) => {
    if (!before || id !== before[0] || before[1] !== 'running' || state === 'running') return
    const next = shells.value.find((s) => s.id !== id && shellStatus(s) === 'running')?.id
    ui.shellId = next ?? (starts.value[0] ? startShellId(starts.value[0].id) : null)
  },
)
const purpose = computed(() => (shell.value ? shellPurpose(shell.value) : null))
const agent = computed(() =>
  shell.value?.parentId ? props.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === shell.value!.parentId) : undefined,
)

const elapsed = (tool: ToolItem) => formatDuration(Math.max(0, (shellEnd(tool) ?? now.value) - tool.startedAt))
const STATE: Record<ShellStatus, string> = { running: 'läuft', done: 'beendet', error: 'fehlgeschlagen', stopped: 'abgebrochen' }
const dotClass = (s: ShellStatus) => (s === 'done' ? 'bg-(--tool-run)' : s === 'error' ? 'bg-destructive' : 'bg-muted-foreground')

// ── Output ──

/** Claude Code's tasks: asked for (its item has only „runs in the background“). Others: the item's. */
const asksCli = computed(() => !!shell.value?.shell && (shell.value.shell.background || status.value === 'running'))
const fetched = ref<{ id: string; text: string; truncated: boolean } | null>(null)
const fetchError = ref<string | null>(null)
const loading = ref(false)
const output = computed(() => {
  const s = shell.value
  if (!s) return ''
  const raw = asksCli.value ? (fetched.value?.id === s.id ? fetched.value.text : '') : (s.output ?? '')
  return plainOutput(raw).replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '')
})

let timer: ReturnType<typeof setInterval> | null = null
let seq = 0

async function load(): Promise<void> {
  const s = shell.value
  if (!s || !asksCli.value) return
  const mine = ++seq
  loading.value = true
  try {
    const result = await window.api.sessions.shellOutput(props.sessionId, s.id)
    if (mine !== seq) return
    fetched.value = { id: s.id, text: result.text, truncated: result.truncated }
    fetchError.value = null
  } catch (error) {
    if (mine !== seq) return
    fetchError.value = errorMessage(error)
  } finally {
    if (mine === seq) loading.value = false
  }
}

watch(
  () => [ui.shellId, asksCli.value, status.value] as const,
  ([id, asks, state], before) => {
    if (timer) clearInterval(timer)
    timer = null
    if (id !== before?.[0]) {
      fetched.value = null
      fetchError.value = null
    }
    if (!asks) return
    void load()
    if (state === 'running') timer = setInterval(() => void load(), POLL_MS)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

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
watch(
  () => ui.shellId,
  () => (pinned = true),
)

// ── Stop ──

const stopping = ref<string | null>(null)
// The CLI's own shells, and the user's (`!`), which Nexa runs.
const canStop = computed(() => (!!shell.value?.shell || !!shell.value?.byUser) && status.value === 'running')
async function stop(): Promise<void> {
  const s = shell.value
  if (!s) return
  stopping.value = s.id
  await attempt(() => window.api.sessions.stopShell(props.sessionId, s.id), 'Die Shell ließ sich nicht beenden')
}
watch(status, (state) => {
  if (state !== 'running') stopping.value = null
})
</script>

<template>
  <aside class="flex h-full w-[26rem] shrink-0 flex-col border-l bg-sidebar/60">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <SquareTerminalIcon class="size-4 text-(--tool-run)" />
      <span class="text-sm font-medium">Shells</span>
      <span class="text-xs text-muted-foreground">{{ runningCount }} aktiv</span>
      <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Schließen" @click="ui.shellId = null">
        <XIcon />
      </Button>
    </div>

    <!-- All shells of the chat, the running ones marked, after the project's start commands; the list scrolls once it is long. -->
    <div v-if="shells.length + starts.length > 1" class="flex max-h-48 shrink-0 flex-col overflow-y-auto border-b p-1.5">
      <button
        v-for="c in starts"
        :key="c.id"
        type="button"
        :class="
          cn('flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted', startShellId(c.id) === ui.shellId && 'bg-muted')
        "
        @click="ui.shellId = startShellId(c.id)"
      >
        <Spinner v-if="startStatus(c.id) === 'running'" class="size-3 shrink-0 text-(--tool-run)" />
        <span v-else :class="cn('mx-[3px] size-1.5 shrink-0 rounded-full', dotClass(startStatus(c.id) ?? 'stopped'))" />
        <span :class="cn('min-w-0 flex-1 truncate text-[0.76rem] font-medium', startStatus(c.id) !== 'running' && 'text-muted-foreground')">
          {{ startCommandLabel(c) }}
        </span>
        <span class="shrink-0 text-muted-foreground tabular-nums">{{ startElapsed(c.id) }}</span>
      </button>
      <button
        v-for="s in shells"
        :key="s.id"
        type="button"
        :class="cn('flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted', s.id === ui.shellId && 'bg-muted')"
        @click="ui.shellId = s.id"
      >
        <Spinner v-if="shellStatus(s) === 'running'" class="size-3 shrink-0 text-(--tool-run)" />
        <span v-else :class="cn('mx-[3px] size-1.5 shrink-0 rounded-full', dotClass(shellStatus(s)))" />
        <span :class="cn('min-w-0 flex-1 truncate font-mono text-[0.72rem]', shellStatus(s) !== 'running' && 'text-muted-foreground')">{{ shellCommand(s) }}</span>
        <span class="shrink-0 text-muted-foreground tabular-nums">{{ elapsed(s) }}</span>
      </button>
    </div>

    <StartCommandDetail v-if="start && projectId" :key="start.id" :project-id="projectId" :command="start" />
    <div v-else-if="shell" class="flex min-h-0 flex-1 flex-col gap-3 px-4 py-3">
      <div v-if="purpose" class="text-[0.95rem] font-medium">{{ purpose }}</div>
      <pre
        class="selectable max-h-32 shrink-0 overflow-auto rounded-md border bg-(--code-bg) px-3 py-2 font-mono text-[0.78rem] whitespace-pre-wrap text-(--code-fg)"
      ><span class="text-(--syn-comment) select-none">$ </span>{{ shellCommand(shell) }}</pre>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span v-if="shell.shell?.background" class="rounded bg-muted px-1.5">Hintergrund</span>
        <span v-if="agent" class="truncate">von {{ agent.description || agent.agentType }}</span>
        <span :class="cn(status === 'running' && 'text-shimmer', status === 'error' && 'text-destructive')">
          {{ STATE[status] }}<template v-if="status === 'running'"> seit {{ elapsed(shell) }}</template><template v-else> nach {{ elapsed(shell) }}</template>
        </span>
        <span v-if="shell.exitCode !== undefined && shell.exitCode !== null" :class="cn('font-mono', shell.exitCode !== 0 && 'text-destructive')">exit {{ shell.exitCode }}</span>
        <span v-if="typeof (shell.input as { cwd?: unknown })?.cwd === 'string'" class="truncate font-mono" :title="(shell.input as { cwd: string }).cwd">
          {{ shorten((shell.input as { cwd: string }).cwd) }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <span class="text-xs font-medium text-muted-foreground">Ausgabe</span>
        <span v-if="asksCli && fetched?.truncated" class="text-xs text-muted-foreground">(nur das Ende)</span>
        <div class="ml-auto flex items-center gap-1">
          <Button v-if="asksCli" variant="ghost" size="icon-xs" :disabled="loading" aria-label="Ausgabe neu laden" v-tooltip="'Ausgabe neu laden'" @click="load">
            <RefreshCwIcon :class="cn(loading && status !== 'running' && 'animate-spin')" />
          </Button>
          <Button v-if="canStop" variant="outline" size="xs" :disabled="stopping === shell.id" @click="stop">
            <Spinner v-if="stopping === shell.id" />
            <CircleStopIcon v-else />
            Beenden
          </Button>
        </div>
      </div>
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
        <span v-if="fetchError">{{ fetchError }}</span>
        <span v-else-if="asksCli && !fetched" class="flex items-center gap-2"><Spinner class="size-3.5" /> Lädt …</span>
        <span v-else-if="status === 'running'">Noch keine Ausgabe.</span>
        <span v-else>Keine Ausgabe.</span>
      </div>
    </div>
    <div v-else class="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      Die Shell gibt es in diesem Chat nicht mehr.
    </div>
  </aside>
</template>
