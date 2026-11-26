<script setup lang="ts">
import { TimerIcon } from '@lucide/vue'
import { computed, useId } from 'vue'
import type { FileTouchKind, GitFileStatus } from '@shared/files'
import { Switch } from '@/components/ui/switch'
import { formatActivityTime, STATUS_CLASS, STATUS_LABEL, STATUS_LETTER, TOUCH_KINDS } from '@/lib/file-tree'
import { TOUCH_DONE, TOUCH_ICON } from '@/lib/file-touch'
import { cn } from '@/lib/utils'
import { useFileTreeStore } from '@/stores/file-tree'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/**
 * The filters of the trees, unfolded below a tree's folder: only the files git sees changed, only those
 * the agent is at right now in the chat, or both together; each narrowed by kind. With nothing to show
 * the tree shows all files. Below them whether the files git ignores show. They hold for every tree and
 * are remembered. Beside that the session's activity can be cleared before it runs out by itself.
 */
const props = defineProps<{
  /** The changes by state, the states there are. */
  statuses: { status: GitFileStatus; count: number }[]
  /** How many files of the tree the agent touched in each way. */
  kinds: Record<FileTouchKind, number>
  /** The tree's folder is in a git repository. */
  git: boolean
  /** The chat whose activity the tree shows. */
  sessionId: string
}>()

const fileTree = useFileTreeStore()
const settings = useSettingsStore(null)
const ui = useUiStore()
const id = useId()

/** All files the chat's agent is at, also those outside this tree. */
const recorded = computed(() => fileTree.activityOf(props.sessionId)?.size ?? 0)

/** How long each kind stays, as set in Einstellungen › Allgemein. */
const durations = computed(() => {
  const s = settings.settings.general.activitySeconds
  return `Gelesenes ${formatActivityTime(s.read)}, Durchsuchtes ${formatActivityTime(s.search)}, Geschriebenes ${formatActivityTime(s.write)}, Committetes ${formatActivityTime(s.commit)}`
})
const activityHint = computed(
  () =>
    `Was der Agent in diesem Chat gerade liest, durchsucht, schreibt oder committet. Es bleibt eine Weile: ${durations.value}. Tut sich gerade nichts, zeigt der Baum alle Dateien.`,
)

const openDurations = () => ui.openSettings('general', 'general.fileActivity')

function toggle<T>(set: Set<T>, value: T) {
  if (!set.delete(value)) set.add(value)
}

const files = (count: number) => `${count} ${count === 1 ? 'Datei' : 'Dateien'}`
const chipTooltip = (label: string, count: number, shown: boolean) =>
  `${label}: ${files(count)} · ${shown ? 'ausblenden' : 'wieder zeigen'}`

const chip =
  'flex h-[20px] cursor-pointer items-center gap-1 rounded-md px-[6px] font-mono text-[11px] font-medium tabular-nums transition-[background-color,opacity] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50'
const chipShown = 'bg-foreground/8 ring-1 ring-foreground/12'
const chipHidden = 'opacity-45 hover:opacity-80'
const caption = 'text-[11px] text-muted-foreground'
/** The kinds beside a filter, at the right edge. */
const chips = 'ml-auto flex min-h-[20px] flex-wrap items-center justify-end gap-1 transition-opacity'
</script>

<template>
  <div class="mx-[6px] mt-2 flex flex-col gap-1 rounded-lg bg-foreground/[0.03] px-2 py-[4px] text-xs ring-1 ring-foreground/10">
    <!-- The changes, their states beside them (below them when the tree is too narrow). -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div class="flex h-[24px] min-w-0 items-center gap-2">
        <Switch :id="`${id}-changes`" v-model="fileTree.filters.changes" size="sm" />
        <label :for="`${id}-changes`" class="min-w-0 cursor-pointer truncate">Änderungen</label>
      </div>
      <div :class="cn(chips, !fileTree.filters.changes && 'opacity-60')">
        <span v-if="!git" :class="caption">Kein Git-Repository</span>
        <span v-else-if="statuses.length === 0" :class="caption">Keine seit dem letzten Commit</span>
        <button
          v-for="item in statuses"
          :key="item.status"
          type="button"
          :aria-label="STATUS_LABEL[item.status]"
          :aria-pressed="!fileTree.hiddenStatuses.has(item.status)"
          :class="cn(chip, fileTree.hiddenStatuses.has(item.status) ? chipHidden : chipShown)"
          v-tooltip="chipTooltip(STATUS_LABEL[item.status], item.count, !fileTree.hiddenStatuses.has(item.status))"
          @click="toggle(fileTree.hiddenStatuses, item.status)"
        >
          <span :class="STATUS_CLASS[item.status]">{{ STATUS_LETTER[item.status] }}</span>{{ item.count }}
        </button>
      </div>
    </div>

    <!-- What the agent did in the chat, the kinds beside it. -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <div class="flex h-[24px] min-w-0 items-center gap-2">
        <Switch :id="`${id}-activity`" v-model="fileTree.filters.activity" size="sm" />
        <label :for="`${id}-activity`" class="min-w-0 cursor-pointer truncate" v-tooltip="activityHint">Aktivität</label>
      </div>
      <div :class="cn(chips, !fileTree.filters.activity && 'opacity-60')">
        <button
            v-for="kind in TOUCH_KINDS"
            :key="kind"
            type="button"
            :data-touch="kind"
            :aria-label="`Vom Agenten ${TOUCH_DONE[kind]}`"
            :aria-pressed="!fileTree.hiddenKinds.has(kind)"
            :class="cn(chip, fileTree.hiddenKinds.has(kind) ? chipHidden : chipShown)"
            v-tooltip="chipTooltip(`Gerade vom Agenten ${TOUCH_DONE[kind]}`, kinds[kind], !fileTree.hiddenKinds.has(kind))"
            @click="toggle(fileTree.hiddenKinds, kind)"
          >
            <component :is="TOUCH_ICON[kind]" class="size-[12px] text-(--touch)" />{{ kinds[kind] }}
          </button>
      </div>
    </div>

    <div class="my-0.5 h-px bg-border" />
    <div class="flex h-[24px] items-center gap-2">
      <Switch :id="`${id}-ignored`" v-model="fileTree.showIgnored" size="sm" />
      <label :for="`${id}-ignored`" class="min-w-0 flex-1 cursor-pointer truncate">Ignorierte Dateien zeigen</label>
      <!-- It runs out by itself; this is for not waiting. -->
      <button
        type="button"
        :disabled="recorded === 0"
        class="h-[20px] shrink-0 cursor-pointer rounded-md px-[6px] text-[11px] text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        v-tooltip="recorded === 0 ? 'Der Agent ist gerade an keiner Datei' : `Vergisst sofort die ${files(recorded)}, an denen der Agent gerade war`"
        @click="fileTree.clearActivity(sessionId)"
      >
        Aktivität leeren
      </button>
      <!-- How long it stays is a setting: this opens it. -->
      <button
        type="button"
        aria-label="Dauer der Aktivität einstellen"
        class="-ml-1 flex size-[20px] shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        v-tooltip="`Wie lange die Aktivität bleibt (${durations}): Einstellungen › Allgemein`"
        @click="openDurations"
      >
        <TimerIcon class="size-[13px]" />
      </button>
    </div>
  </div>
</template>
