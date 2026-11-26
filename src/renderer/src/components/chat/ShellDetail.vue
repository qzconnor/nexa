<script setup lang="ts">
import { CircleStopIcon, RefreshCwIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { AgentItem, ChatItem, ShellStatus, ToolItem } from '@shared/chat'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { useProjectPath } from '@/composables/useProjectPath'
import { errorMessage, toastError } from '@/lib/errors'
import { formatDuration } from '@/lib/format'
import { plainOutput, shellCommand, shellEnd, shellStatus } from '@/lib/shells'
import { cn } from '@/lib/utils'
import ShellOutput from './ShellOutput.vue'
import { useDeviceApi } from '@/stores/device'

/**
 * A shell of the chat unfolded in the dock, below its line (which says what it is for): its whole
 * command, how it goes and what it wrote, with a way to end it. Claude Code keeps the output of its shells and hands out the end of it on request;
 * Codex and the user's own (`!`) bring it in the item. One that ended stays, so its last words can be read.
 */
const props = defineProps<{ shell: ToolItem; items: ChatItem[]; sessionId: string }>()
/** The chat may be another device's: its CLI and shells run there. */
const api = useDeviceApi()
const now = useClock(1000)
const { shorten } = useProjectPath()

/** While it runs, its output is asked for this often. */
const POLL_MS = 1500
const STATE: Record<ShellStatus, string> = { running: 'läuft', done: 'beendet', error: 'fehlgeschlagen', stopped: 'abgebrochen' }

const status = computed(() => shellStatus(props.shell))
const command = computed(() => shellCommand(props.shell))
const elapsed = computed(() => formatDuration(Math.max(0, (shellEnd(props.shell) ?? now.value) - props.shell.startedAt)))
const exitCode = computed(() => (props.shell.exitCode !== undefined && props.shell.exitCode !== null ? props.shell.exitCode : null))
const cwd = computed(() => {
  const value = (props.shell.input as { cwd?: unknown } | undefined)?.cwd
  return typeof value === 'string' ? value : null
})
const agent = computed(() =>
  props.shell.parentId ? props.items.find((i): i is AgentItem => i.kind === 'agent' && i.id === props.shell.parentId) : undefined,
)

// ── Output ──

/** Claude Code's tasks: asked for (its item only says „runs in the background“). Others: the item's. */
const asksCli = computed(() => !!props.shell.shell && (props.shell.shell.background || status.value === 'running'))
const fetched = ref<{ text: string; truncated: boolean } | null>(null)
const fetchError = ref<string | null>(null)
const loading = ref(false)
let seq = 0

const output = computed(() => {
  const raw = asksCli.value ? (fetched.value?.text ?? '') : (props.shell.output ?? '')
  // Blank lines a program starts with only push the output away from its command.
  return plainOutput(raw).replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '')
})

async function load(): Promise<void> {
  if (!asksCli.value) return
  const mine = ++seq
  loading.value = true
  try {
    const result = await api.sessions.shellOutput(props.sessionId, props.shell.id)
    if (mine !== seq) return
    fetched.value = { text: result.text, truncated: result.truncated }
    fetchError.value = null
  } catch (error) {
    if (mine === seq) fetchError.value = errorMessage(error)
  } finally {
    if (mine === seq) loading.value = false
  }
}

// Asked once, again and again while it runs, and once more as it ends.
watch(
  () => [asksCli.value, status.value] as const,
  ([asks, state], _before, onCleanup) => {
    if (!asks) return
    void load()
    if (state !== 'running') return
    const timer = setInterval(() => void load(), POLL_MS)
    onCleanup(() => clearInterval(timer))
  },
  { immediate: true },
)

// ── Stop ──

const stopping = ref(false)
// The CLI's own shells, and the user's (`!`), which Nexa runs.
const canStop = computed(() => (!!props.shell.shell || !!props.shell.byUser) && status.value === 'running')
async function stop(): Promise<void> {
  stopping.value = true
  try {
    await api.sessions.stopShell(props.sessionId, props.shell.id)
  } catch (error) {
    stopping.value = false
    toastError(error, 'Die Shell ließ sich nicht beenden')
  }
}
watch(status, (state) => {
  if (state !== 'running') stopping.value = false
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <div class="flex min-w-0 items-start gap-3">
      <code class="selectable line-clamp-3 min-w-0 flex-1 pt-0.5 font-mono text-[0.76rem] break-all text-muted-foreground" :title="command"
        ><span class="text-(--syn-comment) select-none">$ </span>{{ command }}</code
      >
      <div class="flex shrink-0 items-center gap-1">
        <Button v-if="asksCli" variant="ghost" size="icon-xs" :disabled="loading" aria-label="Ausgabe neu laden" v-tooltip="'Ausgabe neu laden'" @click="load">
          <RefreshCwIcon :class="cn(loading && status !== 'running' && 'animate-spin')" />
        </Button>
        <Button v-if="canStop" variant="outline" size="xs" :disabled="stopping" @click="stop">
          <Spinner v-if="stopping" />
          <CircleStopIcon v-else />
          Beenden
        </Button>
      </div>
    </div>

    <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.72rem] text-muted-foreground">
      <span :class="cn(status === 'running' && 'text-shimmer', status === 'error' && 'text-destructive')">
        {{ STATE[status] }} {{ status === 'running' ? 'seit' : 'nach' }} {{ elapsed }}
      </span>
      <span v-if="exitCode !== null" :class="cn('font-mono', exitCode !== 0 && 'text-destructive')">exit {{ exitCode }}</span>
      <span v-if="shell.shell?.background" class="rounded bg-muted px-1.5">Hintergrund</span>
      <span v-if="shell.byUser" class="rounded bg-muted px-1.5">{{ shell.title }}</span>
      <span v-if="agent" class="max-w-[16rem] truncate">von {{ agent.description || agent.agentType }}</span>
      <span v-if="cwd" class="max-w-[18rem] truncate font-mono" :title="cwd">{{ shorten(cwd) }}</span>
      <span v-if="asksCli && fetched?.truncated">nur das Ende der Ausgabe</span>
    </div>

    <div class="h-[min(18rem,36vh)]">
      <ShellOutput :text="output" :failed="status === 'error'">
        <span v-if="fetchError">{{ fetchError }}</span>
        <span v-else-if="asksCli && !fetched" class="flex items-center gap-2"><Spinner class="size-3.5" /> Lädt …</span>
        <span v-else-if="status === 'running'">Noch keine Ausgabe.</span>
        <span v-else>Keine Ausgabe.</span>
      </ShellOutput>
    </div>
  </div>
</template>
