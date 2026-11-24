<script setup lang="ts">
import { CheckIcon, ChevronRightIcon, CircleSlashIcon, XIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { ToolItem } from '@shared/chat'
import { Spinner } from '@/components/ui/spinner'
import { changeLines, changeStats } from '@/lib/diff'
import { formatDuration } from '@/lib/format'
import AppLogo from '@/components/common/AppLogo.vue'
import { numberedLines } from '@/lib/read-output'
import { nexaToolView, TOOL_META } from '@/lib/tools'
import { cn } from '@/lib/utils'
import { useProjectPath } from '@/composables/useProjectPath'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import DiffView from './DiffView.vue'

/**
 * One tool call: icon in the colour of what it does, its title and main argument, its state. Opened,
 * it shows what it changed (diff), ran (command and output) or found.
 */
const props = defineProps<{ tool: ToolItem }>()
const settings = useSettingsStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const { shorten, relative } = useProjectPath()
/** Nexa's own tools are the app, not a server like any other: its mark, and what they do in words. */
const nexa = computed(() => nexaToolView(props.tool, (id) => sessions.get(id)?.title))
const title = computed(() => nexa.value?.title ?? props.tool.title)
const detail = computed(() => {
  const text = nexa.value ? nexa.value.detail : props.tool.detail
  return text ? shorten(text) : ''
})

const meta = computed(() => TOOL_META[props.tool.tool])
const running = computed(() => props.tool.status === 'running' || props.tool.status === 'pending')
const failed = computed(() => props.tool.status === 'error')
const hasChanges = computed(() => !!props.tool.changes?.length)
const output = computed(() => (props.tool.output ?? '').replace(/\s+$/, ''))
const inputText = computed(() => {
  const input = props.tool.input
  if (input === undefined || input === null) return ''
  if (props.tool.tool === 'bash') return detail.value
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
})
const expandable = computed(
  () => !(nexa.value?.plumbing && !failed.value) && (hasChanges.value || !!output.value || (!!inputText.value && props.tool.tool !== 'read')),
)
/** A shell that runs on in the background: its state, and the way to its output. */
const background = computed(() => (props.tool.shell?.background ? props.tool.shell.status : null))
const BACKGROUND_STATE = { running: 'läuft', done: 'beendet', error: 'fehlgeschlagen', stopped: 'abgebrochen' } as const
const duration = computed(() => (props.tool.endedAt ? props.tool.endedAt - props.tool.startedAt : null))

// Edits open by themselves, as in the CLIs (unless diffs stay folded), failures always.
const open = ref((hasChanges.value && !settings.settings.chat.collapseDiffs) || failed.value)
watch(failed, (now) => now && (open.value = true))
watch(hasChanges, (now) => now && !settings.settings.chat.collapseDiffs && (open.value = true))
/**
 * One file changed: the row names it (its name, then its folder) and counts its lines, so its diff below
 * goes without a head that would say all that again.
 */
const single = computed(() => (props.tool.changes?.length === 1 && !nexa.value ? props.tool.changes[0] : null))
const singleFile = computed(() => {
  const change = single.value
  if (!change) return null
  const shown = relative(change.path)
  const cut = Math.max(shown.lastIndexOf('/'), shown.lastIndexOf('\\'))
  const stats = changeStats(changeLines(change))
  return {
    name: shown.slice(cut + 1),
    dir: cut > 0 ? shown.slice(0, cut).replace(/\\/g, '/') : '',
    added: stats.added,
    removed: stats.removed,
    label: change.type === 'add' ? 'neu' : change.type === 'delete' ? 'gelöscht' : '',
  }
})

/** "File created successfully at …" under a diff only repeats it; what went wrong stays. */
const shownOutput = computed(() => (hasChanges.value && !failed.value ? '' : output.value))

/** A file that was read: its line numbers in a column of their own, not in the text. */
const MAX_READ_LINES = 2000
const numbered = computed(() => {
  if (props.tool.tool !== 'read' || failed.value || !shownOutput.value) return null
  const read = numberedLines(shownOutput.value)
  if (!read) return null
  const lines = read.lines.slice(0, MAX_READ_LINES)
  return { lines, more: read.lines.length - lines.length, note: read.note, digits: String(lines.at(-1)!.n).length }
})
</script>

<template>
  <div class="group/tool">
    <button
      type="button"
      :disabled="!expandable"
      class="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.85rem] transition-colors enabled:hover:bg-muted/60"
      :aria-expanded="expandable ? open : undefined"
      @click="open = !open"
    >
      <AppLogo v-if="nexa" class="size-3.5 shrink-0" />
      <component :is="meta.icon" v-else :class="cn('size-3.5 shrink-0', meta.color)" />
      <span :class="cn('shrink-0 font-medium', running && 'text-shimmer')">{{ title }}</span>
      <template v-if="singleFile">
        <span class="max-w-[60%] shrink-0 truncate font-mono text-[0.78rem]" :title="single!.path">{{ singleFile.name }}</span>
        <span v-if="singleFile.label" class="shrink-0 rounded bg-muted px-1.5 text-[0.7rem] text-muted-foreground">{{ singleFile.label }}</span>
        <span v-if="singleFile.dir" class="min-w-0 truncate font-mono text-[0.72rem] text-muted-foreground" :title="single!.path">{{ singleFile.dir }}</span>
      </template>
      <span
        v-else-if="detail"
        :class="cn('min-w-0 truncate text-muted-foreground', nexa?.plumbing ? 'text-[0.8rem]' : 'font-mono text-[0.78rem]')"
        :title="nexa?.plumbing ? detail : tool.detail"
        >{{ detail }}</span
      >
      <span v-if="tool.server && tool.tool === 'mcp' && !nexa" class="shrink-0 rounded bg-muted px-1.5 text-[0.7rem] text-muted-foreground">{{ tool.server }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-xs text-muted-foreground">
        <!-- Inside the row's button, so no button of its own. -->
        <span
          v-if="background"
          role="button"
          tabindex="0"
          :class="
            cn(
              'flex items-center gap-1.5 rounded-full border px-2 py-px text-[0.7rem] hover:bg-muted hover:text-foreground',
              ui.shellId === tool.id && 'bg-muted text-foreground',
            )
          "
          v-tooltip="'Shell im Hintergrund: Ausgabe zeigen'"
          @click.stop="ui.shellId = ui.shellId === tool.id ? null : tool.id"
          @keydown.enter.stop.prevent="ui.shellId = ui.shellId === tool.id ? null : tool.id"
        >
          <span
            :class="
              cn(
                'size-1.5 rounded-full',
                background === 'running' ? 'animate-pulse bg-(--tool-run)' : background === 'error' ? 'bg-destructive' : 'bg-muted-foreground/60',
              )
            "
          />
          Hintergrund · {{ BACKGROUND_STATE[background] }}
        </span>
        <span v-if="duration !== null && duration > 1500" class="tabular-nums opacity-0 transition-opacity group-hover/tool:opacity-100">{{ formatDuration(duration) }}</span>
        <span v-if="tool.exitCode !== undefined && tool.exitCode !== null && tool.exitCode !== 0" class="font-mono text-destructive">exit {{ tool.exitCode }}</span>
        <!-- Next to the state, so the counts line up whether a duration hides before them or not. -->
        <span v-if="singleFile" class="font-mono tabular-nums">
          <span class="text-(--syn-green)">+{{ singleFile.added }}</span>
          <span class="ml-1 text-(--syn-red)">−{{ singleFile.removed }}</span>
        </span>
        <Spinner v-if="running" class="size-3.5" />
        <XIcon v-else-if="failed" class="size-3.5 text-destructive" />
        <CircleSlashIcon v-else-if="tool.status === 'denied'" class="size-3.5" />
        <CheckIcon v-else class="size-3.5 text-(--tool-run) opacity-70" />
        <ChevronRightIcon v-if="expandable" :class="cn('size-3.5 transition-transform', open && 'rotate-90')" />
      </span>
    </button>
    <div v-if="open && expandable" class="mt-1 mb-2 ml-7 flex flex-col gap-2">
      <template v-if="hasChanges">
        <DiffView v-for="change in tool.changes" :key="change.path" :change="change" :bare="!!single" />
      </template>
      <pre
        v-else-if="inputText && tool.tool !== 'read'"
        class="selectable max-h-48 overflow-auto rounded-md border bg-(--code-bg) px-3 py-2 font-mono text-[0.78rem] whitespace-pre-wrap text-(--code-fg)"
      ><span v-if="tool.tool === 'bash'" class="text-(--syn-comment) select-none">$ </span>{{ inputText }}</pre>
      <div v-if="numbered" class="selectable max-h-72 overflow-auto rounded-md border bg-(--code-bg) py-2 font-mono text-[0.78rem] text-(--code-fg)">
        <!-- A row per line, so a copy has its line breaks; the numbers stay out of it. -->
        <div v-for="line in numbered.lines" :key="line.n" class="flex gap-3 px-3">
          <span class="shrink-0 text-right text-(--syn-comment) tabular-nums select-none" :style="{ width: `${numbered.digits}ch` }">{{ line.n }}</span>
          <span class="min-w-0 flex-1 break-words whitespace-pre-wrap">{{ line.text }}</span>
        </div>
        <p v-if="numbered.more" class="px-3 pt-1 text-(--syn-comment) select-none">… {{ numbered.more }} weitere Zeilen</p>
        <p v-if="numbered.note" class="mx-3 mt-2 border-t pt-2 font-sans text-[0.75rem] whitespace-pre-wrap text-muted-foreground">{{ numbered.note }}</p>
      </div>
      <pre
        v-else-if="shownOutput"
        :class="
          cn(
            'selectable max-h-72 overflow-auto rounded-md border bg-(--code-bg) px-3 py-2 font-mono text-[0.78rem] whitespace-pre-wrap text-(--code-fg)',
            failed && 'border-destructive/40',
          )
        "
        >{{ shownOutput.length > 20000 ? shownOutput.slice(0, 20000) + '\n…' : shownOutput }}</pre
      >
    </div>
  </div>
</template>
