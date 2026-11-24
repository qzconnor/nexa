<script setup lang="ts">
import { ClockIcon } from '@lucide/vue'
import type { UserItem } from '@shared/chat'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { fileImageUrl } from '@/lib/tools'
import { cn } from '@/lib/utils'
import Markdown from './Markdown.vue'

/**
 * A prompt of the user, on the right; the CLI it went to is shown when the session switched. One sent
 * while the agent works waits faded below the chat (`queued`) until the CLI takes it up, then stands
 * in the chat where it did, as any other.
 */
defineProps<{ item: UserItem; showProvider?: boolean; queued?: boolean }>()
const openImage = (path: string) => void window.api.app.openPath(path)
</script>

<template>
  <div :class="cn('flex flex-col items-end gap-1.5', queued ? 'py-1.5' : 'py-3')">
    <div v-if="item.images?.length" :class="cn('flex flex-wrap justify-end gap-2', queued && 'opacity-60')">
      <img
        v-for="image in item.images"
        :key="image"
        :src="fileImageUrl(image)"
        alt=""
        class="max-h-40 max-w-60 cursor-pointer rounded-lg border object-cover"
        @click="openImage(image)"
      />
    </div>
    <div v-if="item.text" :class="cn('max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5', queued && 'opacity-60')">
      <Markdown :text="item.text" breaks />
    </div>
    <span
      v-if="queued"
      class="flex items-center gap-1 text-[0.72rem] text-muted-foreground"
      v-tooltip="'Gesendet, während der Agent arbeitet: Er nimmt sie bei seinem nächsten Schritt auf.'"
    >
      <ClockIcon class="size-3" />
      Wartet
    </span>
    <span v-else-if="showProvider" class="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
      an <ProviderIcon :provider="item.provider" class="size-3" />
    </span>
  </div>
</template>
