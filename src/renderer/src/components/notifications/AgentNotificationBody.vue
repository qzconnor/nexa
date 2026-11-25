<script setup lang="ts">
import type { AgentNotification } from '@shared/notify'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Button } from '@/components/ui/button'

/**
 * Under the title of an agent's notification toast (useAgentNotifications): which chat sends it, its
 * text, and its buttons; Sonner's own action slot holds only one, an agent may offer three.
 */
defineProps<{ note: AgentNotification }>()
const emit = defineEmits<{ action: [action: string]; open: [] }>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <button
      type="button"
      class="flex min-w-0 items-center gap-1.5 self-start text-left text-muted-foreground hover:text-foreground"
      v-tooltip="'Chat öffnen'"
      @click="emit('open')"
    >
      <ProviderIcon :provider="note.provider" class="size-3 shrink-0" />
      <span class="truncate">{{ note.chat }}</span>
    </button>
    <p v-if="note.message" class="whitespace-pre-line text-foreground/85">{{ note.message }}</p>
    <div class="mt-1 flex flex-wrap gap-1.5">
      <Button
        v-for="(action, i) in note.actions"
        :key="action"
        :variant="i === 0 ? 'default' : 'outline'"
        size="xs"
        @click="emit('action', action)"
      >
        {{ action }}
      </Button>
      <Button v-if="!note.actions.length" variant="outline" size="xs" @click="emit('open')">Chat öffnen</Button>
    </div>
  </div>
</template>
