<script setup lang="ts">
import { ListboxRoot } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { searchTerms } from '@shared/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useMatchHighlight } from '@/composables/useMatchHighlight'
import { palettePrefix, useUiStore } from '@/stores/ui'
import ChatSearchList from './ChatSearchList.vue'
import PaletteCommands from './PaletteCommands.vue'
import PaletteHelp from './PaletteHelp.vue'

/**
 * The quick open, like VS Code's and the Claude Manager's: one field at the top of the window, and
 * what is typed decides what it searches. Without a prefix the chats and projects (Strg+Umschalt+A),
 * after `>` the commands (Strg+Umschalt+P), after `?` the list of prefixes.
 */
const ui = useUiStore()

const mode = computed(() => palettePrefix(ui.paletteQuery))

/** What was typed is coloured in the commands, chats and projects found; the prefixes don't count. */
const results = ref<HTMLElement | null>(null)
const terms = computed(() => (mode.value === '?' ? [] : searchTerms(ui.paletteQuery.replace(/^>\s*/, ''))))
useMatchHighlight(
  () => results.value,
  () => terms.value,
)

/**
 * The middle of the title bar's search, which the quick open hangs under: it sits above the page
 * beside the sidebar, not in the middle of the window. Measured on every opening, as the sidebar and
 * the window change it.
 */
const center = ref<string | undefined>()
watch(
  () => ui.paletteOpen,
  (open) => {
    if (!open) return
    const field = document.querySelector('[data-titlebar-search]')?.getBoundingClientRect()
    center.value = field?.width ? `${field.left + field.width / 2}px` : undefined
  },
  { immediate: true },
)

let keepFocus = false
function done(keep = false): void {
  keepFocus = keep
  ui.paletteOpen = false
}

/**
 * Back to typing in the composer of the chat or start page on screen, rather than to the title bar's
 * button. Not when the action put the keyboard somewhere else (a question, the settings).
 */
function onCloseAutoFocus(event: Event): void {
  event.preventDefault()
  if (keepFocus) {
    keepFocus = false
    return
  }
  document.querySelector<HTMLElement>('[data-composer-input]')?.focus()
}
</script>

<template>
  <Dialog v-model:open="ui.paletteOpen">
    <!-- One column no wider than the dialog: with an auto column long paths widened it past the right
         edge. It hangs under the title bar's search, but no closer to the window's edge than half its
         width (19rem) and a margin. The backdrop leaves the title bar out, so the search it opened
         from stays sharp above it. -->
    <DialogContent
      :show-close-button="false"
      overlay-class="top-(--titlebar-height)"
      class="app-no-drag top-[calc(var(--titlebar-height)+0.375rem)] translate-y-0 grid-cols-[minmax(0,1fr)] gap-0 overflow-hidden rounded-xl! p-0 sm:max-w-[38rem]"
      :style="center ? { left: `clamp(min(50%, 20rem), ${center}, max(50%, 100% - 20rem))` } : undefined"
      @close-auto-focus="onCloseAutoFocus"
    >
      <DialogHeader class="sr-only">
        <DialogTitle>Suchen</DialogTitle>
        <DialogDescription>Chats und Projekte suchen, mit &gt; Befehle, mit ? die Möglichkeiten</DialogDescription>
      </DialogHeader>
      <!-- `contents`: no box of its own, the dialog's grid lays out the mode. -->
      <div ref="results" class="contents">
        <PaletteCommands v-if="mode === '>'" v-model:query="ui.paletteQuery" @done="done" />
        <PaletteHelp v-else-if="mode === '?'" v-model:query="ui.paletteQuery" />
        <ListboxRoot v-else highlight-on-hover class="flex min-h-0 flex-col">
          <ChatSearchList v-model:query="ui.paletteQuery" @done="done" />
        </ListboxRoot>
      </div>
    </DialogContent>
  </Dialog>
</template>
