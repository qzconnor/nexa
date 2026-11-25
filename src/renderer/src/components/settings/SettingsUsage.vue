<script setup lang="ts">
import { RefreshCwIcon } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { identityLabel, planLabel } from '@shared/accounts'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type { UsageStats } from '@shared/types'
import AccountDot from '@/components/accounts/AccountDot.vue'
import UsageResetLine from '@/components/common/UsageResetLine.vue'
import RenderBlock from '@/components/render/RenderBlock.vue'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { attempt } from '@/lib/errors'
import { formatRelative, formatTokens } from '@/lib/format'
import { clampPercent, usageFillClass, usageLevel, usageTextClass } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'
import SettingsSection from './SettingsSection.vue'

/** Usage of every CLI: the plan limits of each of its accounts, and what Nexa's chats used per day. */
const providers = useProvidersStore()
const accounts = useAccountsStore()
const now = useClock(30_000)
const stats = ref<UsageStats | null>(null)
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  await attempt(async () => {
    const [next] = await Promise.all([window.api.usage.stats(30), providers.refresh()])
    stats.value = next
  }, 'Verbrauch ließ sich nicht laden')
  loading.value = false
}
onMounted(load)

const CARDS = {
  claude: { anchor: 'usage.claude', description: 'Limits je Account und was Nexas Chats in 30 Tagen verbraucht haben.' },
  codex: { anchor: 'usage.codex', description: 'Limits je Account und was Nexas Chats in 30 Tagen verbraucht haben.' },
  // Its quota belongs to the Google login and is split by groups of models; an API key has none.
  antigravity: {
    anchor: 'usage.antigravity',
    description: 'Kontingente des Google-Logins je Modellgruppe (API-Keys haben keine) und was Nexas Chats in 30 Tagen verbraucht haben.',
  },
} as const satisfies Record<ProviderId, { anchor: string; description: string }>

function describe(id: ProviderId): string {
  // Off, its limits aren't read: old numbers would only look current.
  if (!providers.enabled.includes(id)) return 'In Nexa ausgeschaltet (Einstellungen › CLIs).'
  return providers.status(id)?.installed === false ? 'Nicht installiert.' : CARDS[id].description
}

const chart = computed(() => {
  const days = stats.value?.days ?? []
  if (!days.length) return null
  return {
    type: 'chart' as const,
    chart: 'bar' as const,
    x: 'day',
    stacked: true,
    series: PROVIDER_IDS.map((id) => ({ key: id, label: PROVIDERS[id].short })),
    data: days.map((d) => ({ day: d.date.slice(5).split('-').reverse().join('.'), ...Object.fromEntries(PROVIDER_IDS.map((id) => [id, d.tokens[id] ?? 0])) })),
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection
      v-for="(id, index) in PROVIDER_IDS"
      :key="id"
      :anchor="CARDS[id].anchor"
      :title="PROVIDERS[id].name"
      :description="describe(id)"
    >
      <template v-if="index === 0" #actions>
        <Button variant="ghost" size="sm" :disabled="loading" @click="load">
          <Spinner v-if="loading" data-icon="inline-start" />
          <RefreshCwIcon v-else data-icon="inline-start" />
          Aktualisieren
        </Button>
      </template>
      <div v-for="account in providers.enabled.includes(id) ? accounts.ofProvider(id) : []" :key="account.id" class="flex flex-col gap-3">
        <div class="flex min-w-0 items-center gap-2 text-sm">
          <AccountDot :color="account.color" />
          <span class="truncate font-medium">{{ account.name }}</span>
          <span v-if="planLabel(account.identity.subscriptionType)" class="rounded bg-secondary px-1.5 text-xs">
            {{ planLabel(account.identity.subscriptionType) }}
          </span>
          <span class="ml-auto truncate text-xs text-muted-foreground">{{ identityLabel(account.identity) }}</span>
        </div>
        <template v-if="providers.usageOf(account.id)?.windows.length">
          <div class="grid gap-x-6 gap-y-3 pl-4 sm:grid-cols-2">
            <div v-for="w in providers.usageOf(account.id)!.windows" :key="w.key" class="flex flex-col gap-1.5">
              <div class="flex items-baseline justify-between text-sm">
                <span>{{ w.label }}</span>
                <span :class="cn('font-medium tabular-nums', usageTextClass[usageLevel(w.usedPercent)])">{{ clampPercent(w.usedPercent) }} %</span>
              </div>
              <Progress :model-value="clampPercent(w.usedPercent)" :class="cn('h-1.5', usageFillClass[usageLevel(w.usedPercent)])" />
              <UsageResetLine :window="w" :now="now" class="text-xs" />
            </div>
          </div>
          <span class="pl-4 text-xs text-muted-foreground">Stand {{ formatRelative(providers.usageOf(account.id)?.updatedAt, now) }}</span>
        </template>
        <p v-else class="pl-4 text-sm text-muted-foreground">
          {{ account.authState === 'missing' ? 'Nicht angemeldet.' : (providers.usageOf(account.id)?.message ?? 'Noch keine Angaben zu den Limits.') }}
        </p>
      </div>
      <div v-if="stats?.totals[id]" class="grid grid-cols-2 gap-2 border-t pt-4 text-center">
        <div>
          <div class="text-lg font-semibold tabular-nums">{{ stats.totals[id]!.turns }}</div>
          <div class="text-xs text-muted-foreground">Antworten</div>
        </div>
        <div>
          <div class="text-lg font-semibold tabular-nums">{{ formatTokens(stats.totals[id]!.inputTokens + stats.totals[id]!.outputTokens) }}</div>
          <div class="text-xs text-muted-foreground">Tokens</div>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection anchor="usage.days" title="Tokens pro Tag" description="Ein- und Ausgabe aller Chats in Nexa, letzte 30 Tage.">
      <RenderBlock v-if="chart" :spec="chart" />
      <p v-else-if="stats" class="text-sm text-muted-foreground">Noch keine Chats in den letzten 30 Tagen.</p>
      <Spinner v-else class="size-4 text-muted-foreground" />
    </SettingsSection>
  </div>
</template>
