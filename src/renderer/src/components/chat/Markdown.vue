<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { handleMarkdownClick, loadFenceLanguages, useMarkdown } from '@/composables/useMarkdown'
import { useOpenFile } from '@/composables/useOpenFile'
import { sortOrder } from '@/lib/table-sort'
import { cn } from '@/lib/utils'

/**
 * Markdown of an answer (raw HTML off, so it is safe for v-html). Code blocks are highlighted once
 * their language is loaded; while the text streams a caret blinks at its end.
 */
const props = defineProps<{ text: string; streaming?: boolean; breaks?: boolean; class?: string }>()
const { render } = useMarkdown(props.breaks ?? false)
const openFile = useOpenFile()
const version = ref(0)
const html = computed(() => {
  void version.value
  return render(props.text)
})

let loading = false
watch(
  () => props.text,
  async (text) => {
    if (loading || props.streaming) return
    loading = true
    try {
      if (await loadFenceLanguages(text)) version.value++
    } finally {
      loading = false
    }
  },
  { immediate: true },
)
watch(
  () => props.streaming,
  async (streaming) => {
    if (!streaming && (await loadFenceLanguages(props.text))) version.value++
  },
)

/** A copy button on every code block; a table's header cell sorts it. */
function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const button = target?.closest<HTMLButtonElement>('button[data-copy]')
  if (button) {
    const code = button.parentElement?.querySelector('code')?.textContent ?? ''
    void navigator.clipboard.writeText(code)
    button.dataset.copied = ''
    setTimeout(() => delete button.dataset.copied, 1200)
    return
  }
  const header = target?.closest<HTMLTableCellElement>('.md-table th')
  if (header && !target?.closest('a')) {
    sortTable(header)
    return
  }
  handleMarkdownClick(event, openFile)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const header = (event.target as HTMLElement | null)?.closest<HTMLTableCellElement>('.md-table th')
  if (!header) return
  event.preventDefault()
  sortTable(header)
}

/**
 * Sorts a table's rows by the column of `header`: up, down, back to the order of the answer. Right in
 * the page, as the table is the answer's HTML; a new render (the text grows) starts it unsorted.
 */
function sortTable(header: HTMLTableCellElement): void {
  const body = header.closest('table')?.tBodies[0]
  const row = header.parentElement
  if (!body || !row) return
  const state = header.getAttribute('aria-sort')
  const next = state === 'ascending' ? 'descending' : state === 'descending' ? 'none' : 'ascending'
  for (const cell of row.children) cell.setAttribute('aria-sort', 'none')
  header.setAttribute('aria-sort', next)
  const rows = [...body.rows]
  rows.forEach((r, i) => (r.dataset.order ??= String(i)))
  const ordered =
    next === 'none'
      ? [...rows].sort((a, b) => Number(a.dataset.order) - Number(b.dataset.order))
      : sortOrder(
          rows.map((r) => r.cells[header.cellIndex]?.textContent ?? ''),
          next,
        ).map((i) => rows[i]!)
  body.append(...ordered)
}
</script>

<template>
  <div
    :class="cn('markdown selectable syntax', props.streaming && 'streaming-caret', props.class)"
    @click="onClick"
    @keydown="onKeydown"
    v-html="html"
  />
</template>
