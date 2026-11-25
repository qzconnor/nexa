<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, SettingsIcon } from '@lucide/vue'
import { computed } from 'vue'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { identityLabel, planLabel, usesSecret, type Account } from '@shared/accounts'
import { PROVIDERS } from '@shared/providers'
import AccountDot from '@/components/accounts/AccountDot.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { clampPercent, usageLevel, usageTextClass } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'
import { useUiStore } from '@/stores/ui'

/** CLI and account of a chat, as small menus under the composer (the rest is behind its gear). */
const props = defineProps<{ provider: ProviderId; account?: string; disabled?: boolean }>()
const emit = defineEmits<{
  'update:provider': [ProviderId]
  'update:account': [string]
}>()
const providers = useProvidersStore()
const accounts = useAccountsStore()
const ui = useUiStore()

/** The CLIs that are on (Antigravity once installed); one that is off only while this chat still has it. */
const cliChoices = computed(() => PROVIDER_IDS.filter((id) => providers.offered.includes(id) || id === props.provider))

/** The accounts of the CLI; the menu only shows when there is a choice. */
const choices = computed(() => accounts.ofProvider(props.provider))
const account = computed(() => accounts.get(props.account) ?? accounts.get(accounts.defaultId(props.provider)))

/** Who is signed in, or why the account can't run. */
function accountDetail(a: Account): string {
  if (a.authState === 'missing') return usesSecret(a.kind) ? 'Kein Secret gespeichert' : 'Nicht angemeldet'
  if (a.authState === 'dead') return 'Login abgelaufen'
  return identityLabel(a.identity) ?? (a.kind === 'apiKey' ? 'API-Key' : a.kind === 'token' ? 'Long-lived Token' : 'Angemeldet')
}

/** The fullest window of an account's limits, for the menu. */
function busiest(a: Account): number | null {
  const windows = providers.usageOf(a.id)?.windows ?? []
  return windows.length ? Math.max(...windows.slice(0, 2).map((w) => clampPercent(w.usedPercent))) : null
}
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-0.5">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="sm" class="gap-1.5 px-2 text-muted-foreground" :disabled="disabled">
          <ProviderIcon :provider="provider" class="size-3.5" />
          <span class="text-foreground">{{ PROVIDERS[provider].short }}</span>
          <ChevronDownIcon class="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-64">
        <DropdownMenuLabel>CLI für diesen Chat</DropdownMenuLabel>
        <DropdownMenuItem
          v-for="id in cliChoices"
          :key="id"
          :disabled="!providers.available.includes(id)"
          class="gap-2"
          @select="emit('update:provider', id)"
        >
          <ProviderIcon :provider="id" />
          <span class="flex flex-col">
            <span>{{ PROVIDERS[id].name }}</span>
            <span class="text-xs text-muted-foreground">
              <template v-if="!providers.enabled.includes(id)">in den Einstellungen ausgeschaltet</template>
              <template v-else>{{ providers.status(id)?.installed ? (providers.status(id)?.version ?? 'installiert') : 'nicht installiert' }}</template>
            </span>
          </span>
          <CheckIcon v-if="id === provider" class="ml-auto" />
        </DropdownMenuItem>
        <template v-if="cliChoices.length > 1">
          <DropdownMenuSeparator />
          <p class="px-2 py-1.5 text-xs text-muted-foreground">Beim Wechsel bekommt die andere CLI den bisherigen Verlauf als Kontext.</p>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu v-if="choices.length > 1">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="sm" class="gap-1.5 px-2 text-muted-foreground" :disabled="disabled" v-tooltip="'Account für diesen Chat'">
          <AccountDot :color="account?.color" />
          <span class="max-w-32 truncate text-foreground">{{ account?.name ?? 'Account' }}</span>
          <ChevronDownIcon class="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-80">
        <DropdownMenuLabel>Account für diesen Chat</DropdownMenuLabel>
        <DropdownMenuItem v-for="a in choices" :key="a.id" class="items-start gap-2.5" @select="emit('update:account', a.id)">
          <AccountDot :color="a.color" class="mt-1.5" />
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="flex items-center gap-1.5">
              <span class="truncate">{{ a.name }}</span>
              <span v-if="planLabel(a.identity.subscriptionType)" class="text-xs text-muted-foreground">{{ planLabel(a.identity.subscriptionType) }}</span>
            </span>
            <span :class="cn('truncate text-xs', a.authState === 'missing' || a.authState === 'dead' ? 'text-destructive' : 'text-muted-foreground')">
              {{ accountDetail(a) }}
            </span>
          </span>
          <span
            v-if="busiest(a) !== null"
            v-tooltip="'Am stärksten genutztes Limit'"
            :class="cn('mt-0.5 text-xs tabular-nums', usageTextClass[usageLevel(busiest(a)!)])"
          >
            {{ busiest(a) }} %
          </span>
          <CheckIcon v-if="a.id === account?.id" class="mt-0.5 shrink-0" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <p class="px-2 py-1.5 text-xs text-muted-foreground">Beim Wechsel geht die Unterhaltung beim anderen Account weiter.</p>
        <DropdownMenuItem @select="ui.openSettings('accounts')"><SettingsIcon /> Accounts verwalten …</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
