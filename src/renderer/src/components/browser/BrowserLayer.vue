<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import { useBrowsersStore } from '@/stores/browsers'
import { useUiStore } from '@/stores/ui'
import BrowserPane from './BrowserPane.vue'

/**
 * The pages of all chats' browsers, over the page area of the window. A `<webview>` loads anew when it
 * moves to another parent, so the pages don't live in the chat's panel (which goes with the chat):
 * they stay here, in the order their tabs were opened, and the shown one is placed over the panel's
 * room for it (BrowserPanel measures it). A page an agent drives while no panel shows it is drawn
 * unseen in its last size: a page that isn't drawn has no size, and neither its screenshots nor the
 * clicks on it would work.
 */
const browsers = useBrowsersStore()
const ui = useUiStore()

/** Loaded tabs only (see `awake`); never sorted otherwise, a moved page would load again. */
const panes = computed(() => browsers.tabs.filter((t) => browsers.awake.has(t.id)))

const onScreen = (id: string) => ui.view === 'chat' && browsers.visibleTab === id
const driven = (id: string) => browsers.controls.get(id)?.active === true || browsers.controls.get(id)?.busy === true
const inBackground = (id: string) => !onScreen(id) && driven(id)

function paneStyle(id: string) {
  const slot = browsers.slot
  if (onScreen(id) && slot) return { left: `${slot.left}px`, top: `${slot.top}px`, width: `${slot.width}px`, height: `${slot.height}px` }
  const size = browsers.lastSize
  return { left: '0px', top: '0px', width: `${size.width}px`, height: `${size.height}px` }
}
</script>

<template>
  <div
    data-slot="browser-layer"
    class="pointer-events-none absolute inset-0 z-10 overflow-hidden"
  >
    <BrowserPane
      v-for="tab in panes"
      v-show="onScreen(tab.id) || inBackground(tab.id)"
      :key="tab.id"
      :tab="tab"
      :visible="onScreen(tab.id)"
      :class="cn('absolute', onScreen(tab.id) ? 'pointer-events-auto' : 'pointer-events-none -z-10 opacity-0')"
      :aria-hidden="!onScreen(tab.id) || undefined"
      :style="paneStyle(tab.id)"
    />
  </div>
</template>
