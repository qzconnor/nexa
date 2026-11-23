<script setup lang="ts">
import { CheckIcon, ChevronDownIcon, GaugeIcon, SettingsIcon, ShieldIcon } from '@lucide/vue'
import { computed } from 'vue'
import { PROVIDER_IDS, type PermissionMode, type ProviderId } from '@shared/chat'
import { identityLabel, planLabel, usesSecret, type Account } from '@shared/accounts'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
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

/** CLI, account, model, effort and permission mode of a chat, as small menus under the composer. */
const props = defineProps<{ provider: ProviderId; account?: string; model: string; effort: string; mode: PermissionMode; disabled?: boolean }>()
const emit = defineEmits<{
  'update:provider': [ProviderId]
  'update:account': [string]
  'update:model': [string]
  'update:effort': [string]
  'update:mode': [PermissionMode]
}>()
const providers = useProvidersStore()
const accounts = useAccountsStore()
const ui = useUiStore()

/** The CLIs that are on; one that is off only while this chat still has it. */
const cliChoices = computed(() => PROVIDER_IDS.filter((id) => providers.enabled.includes(id) || id === props.provider))

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

const EFFORT_LABELS: Record<string, string> = {
  none: 'Keins',
  minimal: 'Minimal',
  low: 'Niedrig',
  medium: 'Mittel',
  high: 'Hoch',
  xhigh: 'Sehr hoch',
  max: 'Maximal',
}

const models = computed(() => providers.models[props.provider] ?? [])
const current = computed(() => models.value.find((m) => m.id === props.model) ?? models.value.find((m) => m.isDefault))
const modelLabel = computed(() => (props.model ? (models.value.find((m) => m.id === props.model)?.label ?? props.model) : (current.value?.label ?? 'Standard')))
const efforts = computed(() => current.value?.efforts ?? [])
const effortLabel = computed(() => {
  const effort = props.effort || current.value?.defaultEffort
  return effort ? (EFFORT_LABELS[effort] ?? effort) : 'Standard'
})
const modes = computed(() => PROVIDERS[props.provider].permissionModes)

function openModels(open: boolean): void {
  if (open && !models.value.length) void providers.loadModels(props.provider)
}

function pickModel(id: string): void {
  emit('update:model', id)
  // An effort the new model doesn't know goes back to its default.
  const model = models.value.find((m) => m.id === id)
  if (props.effort && model?.efforts && !model.efforts.includes(props.effort)) emit('update:effort', '')
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

    <DropdownMenu @update:open="openModels">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="sm" class="gap-1 px-2 text-muted-foreground" :disabled="disabled">
          <span class="max-w-40 truncate text-foreground">{{ modelLabel }}</span>
          <ChevronDownIcon class="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="max-h-96 w-72 overflow-y-auto">
        <DropdownMenuLabel>Modell</DropdownMenuLabel>
        <DropdownMenuItem v-if="!models.length" disabled>Wird geladen …</DropdownMenuItem>
        <DropdownMenuItem v-for="m in models" :key="m.id || 'default'" class="items-start gap-2" @select="pickModel(m.id)">
          <span class="flex min-w-0 flex-col">
            <span>{{ m.label }}</span>
            <span v-if="m.description" class="line-clamp-2 text-xs text-muted-foreground">{{ m.description }}</span>
          </span>
          <CheckIcon v-if="m.id === model || (!model && m.isDefault && !models.some((x) => x.id === ''))" class="mt-0.5 ml-auto shrink-0" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu v-if="efforts.length">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="sm" class="gap-1 px-2 text-muted-foreground" :disabled="disabled">
          <GaugeIcon class="size-3.5" />
          <span class="text-foreground">{{ effortLabel }}</span>
          <ChevronDownIcon class="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-48">
        <DropdownMenuLabel>Denkaufwand</DropdownMenuLabel>
        <DropdownMenuItem @select="emit('update:effort', '')">
          Standard<span v-if="current?.defaultEffort" class="text-muted-foreground"> ({{ EFFORT_LABELS[current.defaultEffort] ?? current.defaultEffort }})</span>
          <CheckIcon v-if="!effort" class="ml-auto" />
        </DropdownMenuItem>
        <DropdownMenuItem v-for="e in efforts" :key="e" @select="emit('update:effort', e)">
          {{ EFFORT_LABELS[e] ?? e }}
          <CheckIcon v-if="effort === e" class="ml-auto" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          :class="cn('gap-1 px-2 text-muted-foreground', mode === 'full' && 'text-destructive', mode === 'plan' && 'text-primary')"
        >
          <ShieldIcon class="size-3.5" />
          <!-- "full" and "plan" carry their own color from the button. -->
          <span :class="mode !== 'full' && mode !== 'plan' && 'text-foreground'">{{ PERMISSION_MODES[mode].label }}</span>
          <ChevronDownIcon class="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-72">
        <DropdownMenuLabel>Freigaben</DropdownMenuLabel>
        <DropdownMenuItem v-for="m in modes" :key="m" class="items-start" @select="emit('update:mode', m)">
          <span class="flex flex-col">
            <span :class="m === 'full' && 'text-destructive'">{{ PERMISSION_MODES[m].label }}</span>
            <span class="text-xs text-muted-foreground">{{ PERMISSION_MODES[m].description }}</span>
          </span>
          <CheckIcon v-if="m === mode" class="mt-0.5 ml-auto shrink-0" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
