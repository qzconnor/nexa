<script setup lang="ts">
import { GaugeIcon, HourglassIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { availability } from '@shared/account-choice'
import type { ChatItem, ProviderId, SessionRuntime } from '@shared/chat'
import { DEFAULT_CONTINUE_PROMPT } from '@shared/defaults'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { attempt } from '@/lib/errors'
import { formatReset } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'

/**
 * Above the composer of a chat that stopped at its account's limit: when the limit resets and
 * „Am Reset fortsetzen“. While the chat waits to go on by itself (the user asked, or the automatic
 * account switch found no free account), when and with which account, and „Nicht fortsetzen“.
 */
const props = defineProps<{
  sessionId: string
  provider: ProviderId
  /** The chat's account. */
  accountId: string
  runtime: SessionRuntime
  items: readonly ChatItem[]
  busy: boolean
}>()

const accounts = useAccountsStore()
const providers = useProvidersStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const now = useClock(15_000)
const changing = ref(false)

/** The chat's last turn stopped at the limit, and nothing came after it. */
const atLimit = computed(() => {
  if (props.busy) return false
  const last = props.items.findLast((i) => i.kind === 'user' || i.kind === 'turn')
  return last?.kind === 'turn' && !!last.limit && last.provider === props.provider
})
const resume = computed(() => props.runtime.resume)
const name = (id: string | null | undefined) => accounts.get(id)?.name ?? 'Account'

/** When the chat's account is free again, as its limits tell; null when they don't. */
const reset = computed(() => {
  const account = accounts.get(props.accountId)
  if (!account) return null
  const free = availability(account, { accounts: accounts.accounts, usage: providers.usage, blocked: [], now: now.value })
  return free && free.at > now.value ? free : null
})

const prompt = computed(() => settings.settings.chat.continuePrompt.trim() || DEFAULT_CONTINUE_PROMPT)

const title = computed(() => {
  const waiting = resume.value
  if (!waiting) return `Limit von „${name(props.accountId)}“ erreicht`
  if (waiting.at === null) return 'Wartet auf einen freien Account'
  if (waiting.accountId && waiting.accountId !== props.accountId) return `Geht mit „${name(waiting.accountId)}“ weiter`
  return 'Geht am Reset weiter'
})

const detail = computed(() => {
  const waiting = resume.value
  if (waiting) {
    if (waiting.at === null) return 'Kein Account dieser CLI ist angemeldet.'
    return `${waiting.estimated ? 'Etwa ' : ''}${formatReset(waiting.at, now.value)} mit „${prompt.value}“`
  }
  return reset.value ? `Reset ${reset.value.estimated ? 'etwa ' : ''}${formatReset(reset.value.at, now.value)}` : null
})

async function toggle(on: boolean): Promise<void> {
  changing.value = true
  await attempt(() => sessions.resumeAtReset(props.sessionId, on), on ? 'Fortsetzen fehlgeschlagen' : 'Abbrechen fehlgeschlagen')
  changing.value = false
}
</script>

<template>
  <div v-if="resume || atLimit" class="frost-backing pointer-events-auto mb-2 rounded-xl" role="status">
    <div
      :class="
        cn(
          'flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[0.8rem] leading-snug',
          resume ? 'border-primary/30 bg-primary/10' : 'border-warning/30 bg-warning/10',
        )
      "
    >
      <HourglassIcon v-if="resume" class="size-3.5 shrink-0 text-primary" />
      <GaugeIcon v-else class="size-3.5 shrink-0 text-warning" />
      <p class="min-w-0 flex-1">
        <span class="font-medium">{{ title }}</span>
        <span v-if="detail" class="text-muted-foreground tabular-nums"> · {{ detail }}</span>
      </p>
      <Button v-if="resume" variant="ghost" size="xs" :disabled="changing" @click="toggle(false)">
        <Spinner v-if="changing" data-icon="inline-start" />
        Nicht fortsetzen
      </Button>
      <Button
        v-else
        variant="outline"
        size="xs"
        :disabled="changing"
        v-tooltip="`Geht nach dem Reset von selbst mit „${prompt}“ weiter`"
        @click="toggle(true)"
      >
        <Spinner v-if="changing" data-icon="inline-start" />
        Am Reset fortsetzen
      </Button>
    </div>
  </div>
</template>
