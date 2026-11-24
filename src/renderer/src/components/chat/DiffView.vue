<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import type { FileChange } from '@shared/chat'
import { baseName } from '@shared/utils'
import { changeLines, changeStats, type DiffLine } from '@/lib/diff'
import { hasLanguage, highlightText, languageOf, loadLanguage } from '@/lib/syntax'
import { cn } from '@/lib/utils'
import { useProjectPath } from '@/composables/useProjectPath'

/**
 * The change of one file: its lines with numbers, coloured like the code of its language. `bare`: what
 * is around it names the file and counts its lines already (a tool row), so it has no head of its own,
 * except for where a moved file went.
 */
const props = defineProps<{ change: FileChange; maxHeight?: string; class?: string; bare?: boolean }>()

const { relative } = useProjectPath()
const shown = computed(() => relative(props.change.path))
const lines = computed(() => changeLines(props.change))
const stats = computed(() => changeStats(lines.value))
const language = computed(() => languageOf(props.change.path))
const loaded = ref(0)

watchEffect(() => {
  const lang = language.value
  if (lang && !hasLanguage(lang)) void loadLanguage(lang).then((ok) => ok && loaded.value++)
})

/** Old and new side highlighted as wholes, so a line keeps the context of those around it. */
const html = computed<(string | null)[]>(() => {
  void loaded.value
  const lang = language.value
  if (!lang || !hasLanguage(lang)) return []
  const out = new Array<string | null>(lines.value.length).fill(null)
  const side = (pick: (l: DiffLine) => boolean) => {
    const idx: number[] = []
    lines.value.forEach((l, i) => l.kind !== 'hunk' && pick(l) && idx.push(i))
    const highlighted = highlightText(
      idx.map((i) => lines.value[i].text),
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
  <div :class="cn('overflow-hidden rounded-md border bg-(--code-bg) text-(--code-fg)', props.class)">
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
          <tr v-for="(line, i) in lines" :key="i" class="diff-line" :data-kind="line.kind">
            <td class="diff-gutter w-[1%] whitespace-nowrap">{{ line.kind === 'hunk' ? '' : (line.old ?? '') }}</td>
            <td class="diff-gutter w-[1%] whitespace-nowrap">{{ line.kind === 'hunk' ? '' : (line.new ?? '') }}</td>
            <td class="w-4 select-none text-center text-muted-foreground">{{ line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : '' }}</td>
            <td v-if="html[i]" class="pr-4 whitespace-pre" v-html="html[i]" />
            <td v-else class="pr-4 whitespace-pre">{{ line.text }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
