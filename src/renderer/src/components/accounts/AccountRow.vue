<script setup lang="ts">
import { EllipsisIcon, FolderOpenIcon, KeyRoundIcon, LogInIcon, PencilIcon, StarIcon, Trash2Icon } from '@lucide/vue'
import { computed } from 'vue'
import { accountKindLabel, canLogin, identityLabel, isSystemAccountId, planLabel, usesSecret, type Account } from '@shared/accounts'
import { PROVIDERS } from '@shared/providers'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { useClock } from '@/composables/useClock'
import { attempt } from '@/lib/errors'
import { formatReset } from '@/lib/format'
import { clampPercent, shortWindowLabel, usageFillClass, usageLevel, usageTextClass } from '@/lib/usage'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'
import AccountAuthStatus from './AccountAuthStatus.vue'
import AccountDot from './AccountDot.vue'

/** One account in the settings: who is signed in, its limits, what can be done with it. */
const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ remove: [] }>()

const accounts = useAccountsStore()
const providers = useProvidersStore()
const now = useClock(30_000)

const plan = computed(() => planLabel(props.account.identity.subscriptionType))
const who = computed(() => identityLabel(props.account.identity) ?? accountKindLabel(props.account.kind, props.account.provider))
const isDefault = computed(() => accounts.defaultId(props.account.provider) === props.account.id)
const login = computed(() => accounts.logins.get(props.account.id))
const loggingIn = computed(() => login.value?.status === 'starting' || login.value?.status === 'waiting')
const usage = computed(() => providers.usageOf(props.account.id))
const windows = computed(() => (usage.value?.windows ?? []).slice(0, 2))
/** What the account needs before it can run. */
const needsLogin = computed(() => canLogin(props.account.kind) && (props.account.authState === 'missing' || props.account.authState === 'dead'))
const needsSecret = computed(() => usesSecret(props.account.kind) && props.account.authState === 'missing')

const startLogin = () => void attempt(() => accounts.login(props.account.id), 'Anmeldung ließ sich nicht starten')
const edit = () => (accounts.formRequest = { account: props.account, provider: props.account.provider })
const makeDefault = () => void attempt(() => accounts.setDefault(props.account))
const openFolder = () => void attempt(() => window.api.app.openPath(props.account.configDir), 'Ordner ließ sich nicht öffnen')
</script>

<template>
  <div class="flex flex-col gap-2.5 rounded-lg border bg-background/40 p-3">
    <div class="flex items-start gap-3">
      <AccountDot :color="account.color" class="mt-1.5 size-2.5" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="truncate text-sm font-medium">{{ account.name }}</span>
          <Badge v-if="plan" variant="secondary">{{ plan }}</Badge>
          <Badge v-if="isDefault" v-tooltip="`Neue Chats mit ${PROVIDERS[account.provider].name} starten mit diesem Account`" variant="outline">
            Vorgabe
          </Badge>
        </div>
        <span class="truncate text-xs text-muted-foreground" v-tooltip="account.configDir">{{ who }}</span>
        <AccountAuthStatus :account="account" class="mt-0.5" />
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button v-if="needsLogin" size="sm" variant="outline" :disabled="loggingIn" @click="startLogin">
          <LogInIcon data-icon="inline-start" />
          Anmelden
        </Button>
        <Button v-else-if="needsSecret" size="sm" variant="outline" @click="edit">
          <KeyRoundIcon data-icon="inline-start" />
          Secret eintragen
        </Button>
        <Button v-else-if="!isDefault" size="sm" variant="ghost" @click="makeDefault">Als Vorgabe</Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" aria-label="Account-Aktionen"><EllipsisIcon /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-56">
            <DropdownMenuItem :disabled="isDefault" @select="makeDefault"><StarIcon /> Als Vorgabe verwenden</DropdownMenuItem>
            <DropdownMenuItem @select="edit"><PencilIcon /> Bearbeiten</DropdownMenuItem>
            <DropdownMenuItem v-if="canLogin(account.kind)" :disabled="loggingIn" @select="startLogin"><LogInIcon /> Neu anmelden</DropdownMenuItem>
            <DropdownMenuItem @select="openFolder"><FolderOpenIcon /> Konfigurationsordner öffnen</DropdownMenuItem>
            <template v-if="!isSystemAccountId(account.id)">
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" @select="emit('remove')"><Trash2Icon /> Entfernen</DropdownMenuItem>
            </template>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div v-if="windows.length" class="grid grid-cols-2 gap-4 pl-5.5">
      <div v-for="w in windows" :key="w.key" class="flex min-w-0 flex-col gap-1">
        <div class="flex items-baseline justify-between gap-2 text-xs">
          <span class="text-muted-foreground">{{ shortWindowLabel(w.label, w.windowMinutes) }}</span>
          <span :class="cn('tabular-nums', usageTextClass[usageLevel(w.usedPercent)])">{{ clampPercent(w.usedPercent) }} %</span>
        </div>
        <Progress :model-value="clampPercent(w.usedPercent)" :class="cn('h-1', usageFillClass[usageLevel(w.usedPercent)])" />
        <span v-if="w.resetsAt" class="truncate text-[0.7rem] text-muted-foreground">Zurückgesetzt {{ formatReset(w.resetsAt, now) }}</span>
      </div>
    </div>
    <p v-else-if="usage?.message" class="pl-5.5 text-xs text-muted-foreground">{{ usage.message }}</p>
  </div>
</template>
