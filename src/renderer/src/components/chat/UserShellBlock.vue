<script setup lang="ts">
import { CheckIcon, ChevronRightIcon, CircleSlashIcon, SquareIcon, XIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import type { ToolItem } from '@shared/chat'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * A command the user ran with `!` (Nexa ran it, not the agent), as in Claude Code's bash mode: the
 * command after a pink `!`, its output beneath. Both come with secrets masked already; that is what
 * the agent gets with the next prompt too.
 */
const props = defineProps<{ tool: ToolItem; sessionId: string }>()

const running = computed(() => props.tool.status === 'running')
// Blank lines a program starts with (ping does) only push the output away from its command.
const output = computed(() => (props.tool.output ?? '').replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, ''))
// How long it runs (counting while it does) or ran: always in sight, so the head doesn't shift on hover.
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
watch(
  running,
  (on) => {
    clearInterval(ticker)
    if (!on) return
    now.value = Date.now()
    ticker = setInterval(() => (now.value = Date.now()), 1000)
  },
  { immediate: true },
)
onBeforeUnmount(() => clearInterval(ticker))
const duration = computed(() => {
  const end = props.tool.endedAt ?? (running.value ? now.value : null)
  return end === null ? null : Math.max(0, end - props.tool.startedAt)
})
const exitCode = computed(() => (props.tool.exitCode !== undefined && props.tool.exitCode !== null && props.tool.exitCode !== 0 ? props.tool.exitCode : null))

// Open: it is what the user wanted to see. Long output can be folded away.
const open = ref(true)
const stopping = ref(false)

async function stop(): Promise<void> {
  stopping.value = true
  await attempt(() => window.api.sessions.stopShell(props.sessionId, props.tool.id), 'Der Befehl ließ sich nicht beenden')
  stopping.value = false
}

// While it runs, the output follows its end, unless the user scrolled up to read.
const pre = useTemplateRef<HTMLElement>('pre')
watch(output, async () => {
  const el = pre.value
  if (!el || !running.value) return
  const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  await nextTick()
  if (atEnd) el.scrollTop = el.scrollHeight
})
</script>

<template>
  <div class="my-2 overflow-hidden rounded-lg border border-(--tool-shell)/35 bg-(--code-bg)">
    <div class="flex min-w-0 items-start gap-2 px-3 py-2">
      <span class="shrink-0 font-mono text-[0.85rem] leading-5 font-semibold text-(--tool-shell)">!</span>
      <span class="selectable min-w-0 flex-1 font-mono text-[0.82rem] leading-5 break-all whitespace-pre-wrap text-(--code-fg)">{{ tool.detail }}</span>
      <span class="flex shrink-0 items-center gap-2 pl-2 text-xs leading-5 text-muted-foreground">
        <span>
          {{ tool.title }}<template v-if="duration !== null"><span class="mx-1 opacity-60">·</span><span class="tabular-nums">{{ formatDuration(duration) }}</span></template>
        </span>
        <span v-if="exitCode !== null" class="font-mono text-destructive">exit {{ exitCode }}</span>
        <button
          v-if="running"
          type="button"
          class="-my-0.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground disabled:opacity-50"
          :disabled="stopping"
          aria-label="Befehl beenden"
          v-tooltip="'Befehl beenden'"
          @click="stop"
        >
          <SquareIcon class="size-2.5 fill-current" />
          Beenden
        </button>
        <Spinner v-if="running" class="size-3.5 text-(--tool-shell)" />
        <XIcon v-else-if="tool.status === 'error'" class="size-3.5 text-destructive" />
        <span v-else-if="tool.status === 'denied'" class="flex items-center gap-1" v-tooltip="'Beendet, bevor er fertig war'">
          <CircleSlashIcon class="size-3.5" />
          abgebrochen
        </span>
        <CheckIcon v-else class="size-3.5 text-(--tool-shell) opacity-80" />
        <button
          v-if="output"
          type="button"
          class="rounded p-0.5 hover:bg-muted hover:text-foreground"
          :aria-expanded="open"
          :aria-label="open ? 'Ausgabe einklappen' : 'Ausgabe zeigen'"
          @click="open = !open"
        >
          <ChevronRightIcon :class="cn('size-3.5 transition-transform', open && 'rotate-90')" />
        </button>
        <!-- Its place stays without output too, so the heads of all commands line up. -->
        <span v-else class="w-[1.125rem]" aria-hidden="true" />
      </span>
    </div>
    <pre
      v-if="output && open"
      ref="pre"
      class="selectable max-h-80 overflow-auto border-t border-(--tool-shell)/20 px-3 py-2 font-mono text-[0.78rem] whitespace-pre-wrap text-(--code-fg)"
      >{{ output }}</pre
    >
    <p v-else-if="!output && !running && tool.status === 'done'" class="border-t border-(--tool-shell)/20 px-3 py-1.5 text-[0.75rem] text-muted-foreground italic">Keine Ausgabe</p>
  </div>
</template>
