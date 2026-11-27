<script setup lang="ts">
import { useIntersectionObserver } from '@vueuse/core'
import { computed, ref, useTemplateRef, watchEffect } from 'vue'
import type { FileChange } from '@shared/chat'
import { baseName } from '@shared/utils'
import { changeLines, changeStats, type DiffLine } from '@/lib/diff'
import { hasLanguage, highlightText, languageOf, loadLanguage } from '@/lib/syntax'
import { cn } from '@/lib/utils'
import { useProjectPath } from '@/composables/useProjectPath'

/**
 * The change of one file: its lines with numbers, coloured like the code of its language. `bare`: what
 * is around it names the file and counts its lines already (a tool row), so it has no head of its own,
 * except for where a moved file went. Half the code's background only: there are many of them in a
 * chat, and on the full one they stood out of the window's material as dark blocks.
 */
const props = defineProps<{ change: FileChange; maxHeight?: string; class?: string; bare?: boolean }>()

/**
 * Lines shown at first. A file the agent wrote whole is all added lines: thousands of rows (and their
 * colouring) for each one in the chat, of which the box shows twenty.
 */
const FIRST_LINES = 150

const { relative } = useProjectPath()
const shown = computed(() => relative(props.change.path))
const lines = computed(() => changeLines(props.change))
const stats = computed(() => changeStats(lines.value))
const language = computed(() => languageOf(props.change.path))
const loaded = ref(0)
const limit = ref(FIRST_LINES)
const visibleLines = computed(() => (lines.value.length > limit.value ? lines.value.slice(0, limit.value) : lines.value))
const more = computed(() => lines.value.length - visibleLines.value.length)

/** Coloured once it comes near the screen: a long chat has many changes nobody scrolls to. */
const root = useTemplateRef<HTMLElement>('root')
const seen = ref(false)
const { stop } = useIntersectionObserver(
  root,
  ([entry]) => {
    if (!entry?.isIntersecting) return
    seen.value = true
    stop()
  },
  { rootMargin: '400px 0px' },
)

watchEffect(() => {
  const lang = language.value
  if (seen.value && lang && !hasLanguage(lang)) void loadLanguage(lang).then((ok) => ok && loaded.value++)
})

/** Old and new side highlighted as wholes, so a line keeps the context of those around it. */
const html = computed<(string | null)[]>(() => {
  void loaded.value
  const lang = language.value
  if (!seen.value || !lang || !hasLanguage(lang)) return []
  const rows = visibleLines.value
  const out = new Array<string | null>(rows.length).fill(null)
  const side = (pick: (l: DiffLine) => boolean) => {
    const idx: number[] = []
    rows.forEach((l, i) => l.kind !== 'hunk' && pick(l) && idx.push(i))
    const highlighted = highlightText(
      idx.map((i) => rows[i].text),
      lang,
    )
    if (highlighted) idx.forEach((i, k) => (out[i] = highlighted[k] ?? null))
  }
  side((l) => l.kind !== 'add')
  side((l) => l.kind === 'add')
  return out
})

const typeLabel = computed(() => ({ add: 'neu', update: '', delete: 'gelöscht' })[props.change.type])
</script>

<template>
  <div ref="root" :class="cn('overflow-hidden rounded-md border bg-(--code-bg)/50 text-(--code-fg)', props.class)">
    <div v-if="bare && change.movePath" class="truncate border-b px-3 py-1.5 font-mono text-xs text-muted-foreground" :title="change.movePath">
      → {{ relative(change.movePath) }}
    </div>
    <div v-else-if="!bare" class="flex items-center gap-2 border-b px-3 py-1.5 text-xs">
      <span class="shrink-0 font-mono" :title="change.path">{{ baseName(change.path) }}</span>
      <span class="min-w-0 truncate text-muted-foreground" :title="change.path">{{ change.movePath ? `→ ${relative(change.movePath)}` : shown }}</span>
      <span v-if="typeLabel" class="rounded bg-muted px-1.5 text-[0.7rem] text-muted-foreground">{{ typeLabel }}</span>
      <span class="ml-auto shrink-0 font-mono tabular-nums">
        <span class="text-(--syn-green)">+{{ stats.added }}</span>
        <span class="ml-1.5 text-(--syn-red)">−{{ stats.removed }}</span>
      </span>
    </div>
    <div class="syntax overflow-auto font-mono text-[0.78rem] leading-[1.45]" :style="{ maxHeight: maxHeight ?? '22rem' }">
      <table class="w-full border-collapse">
        <tbody>
          <tr v-for="(line, i) in visibleLines" :key="i" class="diff-line" :data-kind="line.kind">
            <!-- One number per line, as in the diff of the file view: where it is now, a removed one where it was. -->
            <td class="diff-gutter w-[1%] whitespace-nowrap">{{ line.kind === 'hunk' ? '' : (line.new ?? line.old ?? '') }}</td>
            <td class="w-4 select-none text-center text-muted-foreground">{{ line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : '' }}</td>
            <td v-if="html[i]" class="pr-4 whitespace-pre" v-html="html[i]" />
            <td v-else class="pr-4 whitespace-pre">{{ line.text }}</td>
          </tr>
        </tbody>
      </table>
      <button
        v-if="more"
        type="button"
        class="sticky left-0 w-full border-t px-3 py-1.5 text-left font-sans text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        @click="limit = lines.length"
      >
        {{ more === 1 ? '1 weitere Zeile' : `${more} weitere Zeilen` }} anzeigen
      </button>
    </div>
  </div>
</template>
