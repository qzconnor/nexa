<script setup lang="ts">
import { GlobeIcon } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useBrowsersStore } from '@/stores/browsers'

/** The button in the chat's header that shows or hides its browser; a dot while the agent works in it. */
const props = defineProps<{ sessionId: string }>()

const browsers = useBrowsersStore()
const open = computed(() => browsers.isOpen(props.sessionId))
const busy = computed(() => browsers.busyIn(props.sessionId))
const label = computed(() => (open.value ? 'Browser ausblenden' : 'Browser einblenden'))
</script>

<template>
  <Button
    variant="ghost"
    size="icon-sm"
    :aria-label="busy ? `${label}, der Agent arbeitet darin` : label"
    :aria-pressed="open"
    v-tooltip.bottom="label"
    :class="cn('relative', open && 'bg-muted text-foreground')"
    @click="browsers.toggle(sessionId)"
  >
    <GlobeIcon :class="cn(busy && 'text-primary')" />
    <span v-if="busy" aria-hidden="true" class="absolute top-1 right-1 size-1.5 animate-pulse rounded-full bg-primary ring-2 ring-background" />
  </Button>
</template>
