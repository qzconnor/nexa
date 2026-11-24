<script setup lang="ts">
import { ArrowRightIcon, RefreshCwIcon, SettingsIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { identityLabel, planLabel } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type { UsageWindow } from '@shared/types'
import AccountDot from '@/components/accounts/AccountDot.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import UsageResetLine from '@/components/common/UsageResetLine.vue'
import UsageRing from '@/components/common/UsageRing.vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { useClock } from '@/composables/useClock'
import { attempt } from '@/lib/errors'
import { formatRelative } from '@/lib/format'
import { clampPercent, forecastHint, shortWindowLabel, usageFillClass, usageLevel, usageTextClass } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'

/**
 * The plan limits of one CLI in the title bar: a ring per window for the account that counts now
 * (the open chat's, else the default one), every account of the CLI in the popover.
 */
const props = defineProps<{ provider: ProviderId }>()
const providers = useProvidersStore()
const accounts = useAccountsStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const now = useClock(30_000)
const open = ref(false)
const refreshing = ref(false)

const list = computed(() => accounts.ofProvider(props.provider))
const shownId = computed(() => {
  const meta = sessions.active
  return meta && meta.provider === props.provider ? accounts.sessionAccount(meta) : accounts.defaultId(props.provider)
})
const shown = computed(() => accounts.get(shownId.value))
const windows = computed(() => (providers.usageOf(shownId.value)?.windows ?? []).slice(0, 2))
const latest = computed(() => Math.max(0, ...list.value.map((a) => providers.usageOf(a.id)?.updatedAt ?? 0)) || undefined)

/** When the window's limit comes at this pace, if before its reset. */
function limitAt(window: UsageWindow): string | null {
  return forecastHint(window, now.value)?.at ?? null
}

async function refresh(): Promise<void> {
  refreshing.value = true
  await attempt(() => providers.refresh(), 'Aktualisieren fehlgeschlagen')
  refreshing.value = false
}

function openDashboard(): void {
  open.value = false
  ui.openSettings('usage')
}

function openAccounts(): void {
  open.value = false
  ui.openSettings('accounts')
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="app-no-drag gap-2.5 px-2 font-normal text-muted-foreground hover:bg-foreground/8"
        :aria-label="`Nutzung ${PROVIDERS[provider].name}`"
      >
        <span class="relative">
          <ProviderIcon :provider="provider" class="size-3.5" />
          <AccountDot v-if="list.length > 1" :color="shown?.color" class="absolute -right-1 -bottom-1 size-1.5 ring-1" />
        </span>
        <span v-if="!windows.length" class="text-xs">–</span>
        <span v-for="w in windows" :key="w.key" class="flex items-center gap-1">
          <UsageRing :percent="w.usedPercent" :size="14" />
          <span class="text-xs">{{ shortWindowLabel(w.label, w.windowMinutes) }}</span>
          <span :class="cn('text-xs font-medium tabular-nums', clampPercent(w.usedPercent) >= 85 ? usageTextClass.high : 'text-foreground')">
            {{ clampPercent(w.usedPercent) }}&nbsp;%
          </span>
          <!-- At this pace the limit comes before the reset: when, right in the title bar. -->
          <span v-if="limitAt(w)" :class="cn('text-xs font-medium tabular-nums', usageTextClass.high)">→&nbsp;{{ limitAt(w) }}</span>
        </span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-84 gap-0 p-0" @open-auto-focus.prevent>
      <div class="flex items-center gap-2 p-3 pb-2">
        <ProviderIcon :provider="provider" />
        <span class="font-medium">{{ PROVIDERS[provider].name }}</span>
        <Button variant="ghost" size="xs" class="ml-auto" @click="openDashboard">
          Verbrauch
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
      <div class="flex max-h-[60vh] flex-col overflow-y-auto">
        <div
          v-for="account in list"
          :key="account.id"
          :class="cn('flex flex-col gap-3 border-t px-3 py-2.5', account.id === shownId && list.length > 1 && 'bg-muted/40')"
        >
          <div class="flex min-w-0 items-center gap-2">
            <AccountDot :color="account.color" />
            <span class="truncate text-sm font-medium">{{ account.name }}</span>
            <span v-if="planLabel(account.identity.subscriptionType)" class="rounded bg-secondary px-1.5 text-xs">
              {{ planLabel(account.identity.subscriptionType) }}
            </span>
            <span v-if="account.id === shownId && list.length > 1" class="ml-auto shrink-0 text-[0.7rem] text-muted-foreground">
              {{ sessions.active?.provider === provider ? 'dieser Chat' : 'Vorgabe' }}
            </span>
          </div>
          <span v-if="identityLabel(account.identity)" class="-mt-2 truncate pl-4 text-xs text-muted-foreground">{{ identityLabel(account.identity) }}</span>
          <div v-for="w in providers.usageOf(account.id)?.windows ?? []" :key="w.key" class="flex flex-col gap-1.5 pl-4">
            <div class="flex items-baseline justify-between gap-3 text-xs">
              <span>{{ w.label }}</span>
              <span :class="cn('tabular-nums', usageTextClass[usageLevel(w.usedPercent)])">{{ clampPercent(w.usedPercent) }} %</span>
            </div>
            <Progress :model-value="clampPercent(w.usedPercent)" :class="cn('h-1.5', usageFillClass[usageLevel(w.usedPercent)])" />
            <UsageResetLine :window="w" :now="now" class="text-[0.7rem]" />
          </div>
          <p v-if="!providers.usageOf(account.id)?.windows.length" class="pl-4 text-xs text-muted-foreground">
            {{
              account.authState === 'missing'
                ? 'Nicht angemeldet.'
                : (providers.usageOf(account.id)?.message ?? 'Noch keine Angaben – sie kommen mit der ersten Antwort oder beim nächsten Abruf.')
            }}
          </p>
          <p v-if="providers.usageOf(account.id)?.limited" class="pl-4 text-xs text-destructive">Das Limit ist erreicht.</p>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2 border-t py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
        <span>Stand {{ formatRelative(latest, now) }}</span>
        <div class="flex items-center">
          <Button variant="ghost" size="icon-xs" aria-label="Accounts verwalten" v-tooltip="'Accounts verwalten'" @click="openAccounts">
            <SettingsIcon />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Aktualisieren" :disabled="refreshing" @click="refresh">
            <Spinner v-if="refreshing" />
            <RefreshCwIcon v-else />
          </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
