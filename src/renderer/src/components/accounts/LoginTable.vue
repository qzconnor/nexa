<script setup lang="ts">
import { LogInIcon, RefreshCwIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { accountKindLabel, identityLabel, type Account, type LoginRenewResult } from '@shared/accounts'
import { PROVIDERS } from '@shared/providers'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useClock } from '@/composables/useClock'
import { attempt, errorMessage } from '@/lib/errors'
import { formatDateTime, formatRelative } from '@/lib/format'
import { loginAction, loginEndHint, loginEndText, loginStatus, savedHint, tokenText, type LoginTone } from '@/lib/logins'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import AccountDot from './AccountDot.vue'

/**
 * The logins of all accounts at a glance (as in the Claude Manager): how long the access token holds,
 * when the browser login ends and when its tokens were saved last. „Jetzt erneuern“ gets a new access
 * token for a Claude login right away. `keepFresh`: `chat.keepLoginsFresh`, for the hints.
 */
defineProps<{ keepFresh: boolean }>()

const accounts = useAccountsStore()
const now = useClock(30_000)
const renewing = ref(new Set<string>())

const list = computed(() => [...accounts.ofProvider('claude'), ...accounts.ofProvider('codex')])

const toneClass: Record<LoginTone, string> = { ok: 'text-success', warning: 'text-warning', error: 'text-destructive' }

function who(account: Account): string {
  return `${PROVIDERS[account.provider].short} · ${identityLabel(account.identity) ?? accountKindLabel(account.kind, account.provider)}`
}

function loggingIn(account: Account): boolean {
  const status = accounts.logins.get(account.id)?.status
  return status === 'starting' || status === 'waiting'
}

const login = (account: Account) => void attempt(() => accounts.login(account.id), 'Anmeldung ließ sich nicht starten')

async function renew(account: Account): Promise<void> {
  if (renewing.value.has(account.id)) return
  renewing.value = new Set(renewing.value).add(account.id)
  let result: LoginRenewResult
  try {
    result = await accounts.renewLogin(account.id)
  } catch (error) {
    toast.error('Login ließ sich nicht erneuern', { description: errorMessage(error) })
    return
  } finally {
    const next = new Set(renewing.value)
    next.delete(account.id)
    renewing.value = next
  }
  if (result === 'renewed') {
    toast.success(`Login von „${account.name}“ erneuert`)
  } else if (result === 'busy') {
    toast.info('Claude Code erneuert den Login gerade', { description: 'Gleich zeigt die Liste den neuen Access-Token.' })
  } else if (result === 'rejected') {
    toast.error(`Login von „${account.name}“ lässt sich nicht erneuern`, {
      description: 'Anthropic nimmt den Refresh-Token nicht mehr an. Nur neu anmelden hilft.',
      action: { label: 'Neu anmelden', onClick: () => login(account) },
    })
  } else {
    toast.error('Erneuern fehlgeschlagen', { description: 'Netzwerk oder Server haben nicht geantwortet. Versuch es gleich noch einmal.' })
  }
}
</script>

<template>
  <Table class="table-fixed text-xs">
    <TableHeader>
      <TableRow class="hover:bg-transparent">
        <TableHead>Account</TableHead>
        <TableHead class="w-28">Status</TableHead>
        <TableHead class="w-44">Access-Token</TableHead>
        <TableHead class="w-28">Login endet</TableHead>
        <TableHead class="w-32">Zuletzt erneuert</TableHead>
        <TableHead class="w-32"><span class="sr-only">Aktion</span></TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="account in list" :key="account.id">
        <TableCell>
          <div class="flex min-w-0 items-center gap-2">
            <AccountDot :color="account.color" />
            <div class="flex min-w-0 flex-col">
              <span class="truncate text-sm font-medium">{{ account.name }}</span>
              <span class="truncate text-muted-foreground" v-tooltip="account.configDir">{{ who(account) }}</span>
            </div>
          </div>
        </TableCell>
        <TableCell :class="cn('truncate', toneClass[loginStatus(account).tone])">{{ loginStatus(account).text }}</TableCell>
        <TableCell class="truncate" v-tooltip="account.tokenExpiresAt ? formatDateTime(Date.parse(account.tokenExpiresAt)) : null">
          {{ tokenText(account, now) }}
        </TableCell>
        <TableCell class="truncate" v-tooltip="loginEndHint(account, keepFresh)">{{ loginEndText(account, now) }}</TableCell>
        <TableCell class="truncate" v-tooltip="savedHint(account)">
          {{ account.tokenSavedAt ? formatRelative(Date.parse(account.tokenSavedAt), now) : '–' }}
        </TableCell>
        <TableCell class="text-right">
          <Button
            v-if="loginAction(account) === 'login' || loginAction(account) === 'relogin'"
            size="xs"
            variant="outline"
            :disabled="loggingIn(account)"
            @click="login(account)"
          >
            <LogInIcon data-icon="inline-start" />
            {{ loginAction(account) === 'relogin' ? 'Neu anmelden' : 'Anmelden' }}
          </Button>
          <Button
            v-else-if="loginAction(account) === 'renew'"
            size="xs"
            variant="ghost"
            :disabled="renewing.has(account.id)"
            v-tooltip="'Holt mit dem Refresh-Token jetzt einen neuen Access-Token, wie Claude Code beim Start einer Session'"
            @click="renew(account)"
          >
            <Spinner v-if="renewing.has(account.id)" data-icon="inline-start" />
            <RefreshCwIcon v-else data-icon="inline-start" />
            Jetzt erneuern
          </Button>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>
