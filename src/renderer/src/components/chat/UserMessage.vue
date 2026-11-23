<script setup lang="ts">
import type { UserItem } from '@shared/chat'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { fileImageUrl } from '@/lib/tools'
import Markdown from './Markdown.vue'

/** A prompt of the user, on the right; the CLI it went to is shown when the session switched. */
defineProps<{ item: UserItem; showProvider?: boolean }>()
const openImage = (path: string) => void window.api.app.openPath(path)
</script>

<template>
  <div class="flex flex-col items-end gap-1.5 py-2">
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
    <div v-if="item.text" class="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5">
      <Markdown :text="item.text" breaks />
    </div>
    <span v-if="showProvider" class="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
      an <ProviderIcon :provider="item.provider" class="size-3" />
    </span>
  </div>
</template>
