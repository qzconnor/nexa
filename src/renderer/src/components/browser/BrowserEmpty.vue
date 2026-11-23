<script setup lang="ts">
import { GlobeIcon } from '@lucide/vue'
import { nextTick, ref, watch } from 'vue'
import { addressToUrl, BLANK_PAGE } from '@shared/browser'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useBrowsersStore } from '@/stores/browsers'

/**
 * The chat's browser while it has no page yet: an address opens its first tab. The agent opens one
 * here as well, as soon as it uses the browser.
 */
const props = defineProps<{ sessionId: string; agent: string }>()

const browsers = useBrowsersStore()
const address = ref('')
const input = ref<HTMLInputElement | null>(null)

function submit() {
  if (!address.value.trim()) return
  const url = addressToUrl(address.value)
  if (url === BLANK_PAGE) return
  void browsers.openTab(props.sessionId, url)
  address.value = ''
}

// Only when the user opened the browser: a chat switched to keeps the keyboard in its composer.
watch(
  () => browsers.emptyFocus,
  (request) => {
    if (request?.sessionId !== props.sessionId) return
    browsers.emptyFocus = null
    void nextTick(() => input.value?.focus())
  },
  { immediate: true },
)
</script>

<template>
  <Empty class="size-full rounded-none border-0">
    <EmptyHeader>
      <EmptyMedia>
        <GlobeIcon class="size-8 text-muted-foreground opacity-60" />
      </EmptyMedia>
      <EmptyTitle>Noch keine Seite offen</EmptyTitle>
      <EmptyDescription>Gib eine Adresse ein. Benutzt {{ agent }} den Browser, öffnet er sich auch hier.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent class="w-full max-w-md">
      <form class="w-full" @submit.prevent="submit">
        <input
          ref="input"
          v-model="address"
          type="text"
          aria-label="Adresse"
          placeholder="Adresse eingeben oder suchen"
          spellcheck="false"
          autocomplete="off"
          class="h-9 w-full rounded-md border border-input bg-background/40 px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </form>
    </EmptyContent>
  </Empty>
</template>
