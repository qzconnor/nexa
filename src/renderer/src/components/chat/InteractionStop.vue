<script setup lang="ts">
import { SquareIcon } from '@lucide/vue'
import { ref } from 'vue'
import { Button } from '@/components/ui/button'
import { attempt } from '@/lib/errors'
import { useSessionsStore } from '@/stores/sessions'

/**
 * Stops the agent from a question it asked, as the composer's stop button does: the question is left
 * unanswered („Nicht mehr beantwortet“) and the turn ends. Also where there is no composer (the inbox).
 */
const props = defineProps<{ sessionId: string; disabled?: boolean }>()
const sessions = useSessionsStore()
const stopping = ref(false)

async function stop(): Promise<void> {
  stopping.value = true
  await attempt(() => sessions.interrupt(props.sessionId), 'Anhalten fehlgeschlagen')
  stopping.value = false
}
</script>

<template>
  <!-- Apart from the answers, at the end of their row: it is no answer, it ends the turn. -->
  <Button
    type="button"
    variant="ghost"
    size="sm"
    class="ml-auto text-muted-foreground"
    :disabled="disabled || stopping"
    v-tooltip="'Hält den Agent an, ohne zu antworten'"
    @click="stop"
  >
    <SquareIcon class="size-3 fill-current" />
    Anhalten
  </Button>
</template>
