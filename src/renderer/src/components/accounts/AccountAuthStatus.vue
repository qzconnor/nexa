<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, ClockAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import { nexaRenewsLogin, usesSecret, type Account } from '@shared/accounts'
import { PROVIDERS } from '@shared/providers'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps<{ account: Account }>()
const settings = useSettingsStore()

const status = computed(() => {
  const { authState, kind, provider } = props.account
  if (authState === 'ok') return { icon: CircleCheckIcon, tone: 'text-success', text: usesSecret(kind) ? 'Secret hinterlegt' : 'Angemeldet' }
  if (authState === 'expired') {
    // With „Logins frisch halten“ Nexa renews it within minutes, not the CLI at its next start.
    if (settings.settings.chat.keepLoginsFresh && nexaRenewsLogin(props.account)) {
      return { icon: ClockAlertIcon, tone: 'text-warning', text: 'Token abgelaufen – Nexa erneuert ihn gleich' }
    }
    return { icon: ClockAlertIcon, tone: 'text-warning', text: `Token abgelaufen – ${PROVIDERS[provider].name} erneuert ihn beim nächsten Start` }
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
