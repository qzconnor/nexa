<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { handleMarkdownClick, loadFenceLanguages, useMarkdown } from '@/composables/useMarkdown'
import { cn } from '@/lib/utils'

/**
 * Markdown of an answer (raw HTML off, so it is safe for v-html). Code blocks are highlighted once
 * their language is loaded; while the text streams a caret blinks at its end.
 */
const props = defineProps<{ text: string; streaming?: boolean; breaks?: boolean; class?: string }>()
const { render } = useMarkdown(props.breaks ?? false)
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

/** A copy button on every code block. */
function onClick(event: MouseEvent): void {
  const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>('button[data-copy]')
  if (button) {
    const code = button.parentElement?.querySelector('code')?.textContent ?? ''
    void navigator.clipboard.writeText(code)
    button.dataset.copied = ''
    setTimeout(() => delete button.dataset.copied, 1200)
    return
  }
  handleMarkdownClick(event)
}
</script>

<template>
  <div
    :class="cn('markdown selectable syntax', props.streaming && 'streaming-caret', props.class)"
    @click="onClick"
    v-html="html"
  />
</template>
