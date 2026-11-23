<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, ClockAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import { usesSecret, type Account } from '@shared/accounts'
import { cn } from '@/lib/utils'

const props = defineProps<{ account: Account }>()

const status = computed(() => {
  const { authState, kind, provider } = props.account
  if (authState === 'ok') return { icon: CircleCheckIcon, tone: 'text-success', text: usesSecret(kind) ? 'Secret hinterlegt' : 'Angemeldet' }
  if (authState === 'expired') {
    const cli = provider === 'codex' ? 'Codex' : 'Claude Code'
    return { icon: ClockAlertIcon, tone: 'text-warning', text: `Token abgelaufen – ${cli} erneuert ihn beim nächsten Start` }
  }
  if (authState === 'dead') return { icon: CircleAlertIcon, tone: 'text-destructive', text: 'Login abgelaufen – bitte neu anmelden' }
  return { icon: CircleAlertIcon, tone: 'text-destructive', text: usesSecret(kind) ? 'Kein gültiges Secret gespeichert' : 'Nicht angemeldet' }
})
</script>

<template>
  <span :class="cn('flex items-center gap-1.5 text-xs', status.tone)">
    <component :is="status.icon" class="size-3.5 shrink-0" />
    <span class="min-w-0">{{ status.text }}</span>
  </span>
</template>
