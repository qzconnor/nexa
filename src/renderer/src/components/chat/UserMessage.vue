<script setup lang="ts">
import { CornerDownRightIcon } from '@lucide/vue'
import type { UserItem } from '@shared/chat'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { fileImageUrl } from '@/lib/tools'
import { cn } from '@/lib/utils'
import Markdown from './Markdown.vue'

/**
 * A prompt of the user, on the right; the CLI it went to is shown when the session switched. One sent
 * into a running answer stands apart: it cut in, the agent took it up on the way.
 */
defineProps<{ item: UserItem; showProvider?: boolean }>()
const openImage = (path: string) => void window.api.app.openPath(path)
</script>

<template>
  <div class="flex flex-col items-end gap-1.5 py-2">
    <span
      v-if="item.steer"
      class="flex items-center gap-1 text-[0.72rem] font-medium text-primary"
      v-tooltip="'Gesendet, während der Agent arbeitete: Er nimmt die Nachricht im laufenden Turn auf.'"
    >
      <CornerDownRightIcon class="size-3" />
      In die laufende Antwort geschickt
    </span>
    <div v-if="item.images?.length" class="flex flex-wrap justify-end gap-2">
      <img
        v-for="image in item.images"
        :key="image"
        :src="fileImageUrl(image)"
        alt=""
        class="max-h-40 max-w-60 cursor-pointer rounded-lg border object-cover"
        @click="openImage(image)"
      />
    </div>
    <div
      v-if="item.text"
      :class="
        cn(
          'max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5',
          item.steer ? 'border border-dashed border-primary/60 bg-primary/10' : 'bg-secondary',
        )
      "
    >
      <Markdown :text="item.text" breaks />
    </div>
    <span v-if="showProvider" class="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
      an <ProviderIcon :provider="item.provider" class="size-3" />
    </span>
  </div>
</template>
