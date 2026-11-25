<script setup lang="ts">
import { CheckIcon, CircleCheckIcon, CopyIcon, ExternalLinkIcon, RotateCwIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { identityLabel, planLabel } from '@shared/accounts'
import { PROVIDERS } from '@shared/providers'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { useAccountsStore } from '@/stores/accounts'
import AccountDot from './AccountDot.vue'

/**
 * The browser login of an account (`accounts.loginId`). The CLI runs without a terminal and opens
 * the browser itself; the dialog shows the link in case it didn't, takes a code the browser shows
 * (Claude Code), and says when the login went through.
 */
const accounts = useAccountsStore()

const account = computed(() => accounts.get(accounts.loginId))
const state = computed(() => (accounts.loginId ? accounts.logins.get(accounts.loginId) : undefined))
const running = computed(() => !state.value || state.value.status === 'starting' || state.value.status === 'waiting')
const cli = computed(() => (account.value ? PROVIDERS[account.value.provider].name : ''))
/** The login ends with a code to paste (Antigravity CLI): the page can't call the CLI back. */
const codeLogin = computed(() => !!account.value && !!PROVIDERS[account.value.provider].loginCode)
/** Who is signed in now, once the files of the account say so. */
const signedIn = computed(() => {
  const a = account.value
  if (!a) return null
  const who = identityLabel(a.identity)
  const plan = planLabel(a.identity.subscriptionType)
  return [who, plan].filter(Boolean).join(' · ') || null
})

const code = ref('')
const copied = ref(false)
const sending = ref(false)

watch(
  () => accounts.loginId,
  () => {
    code.value = ''
    copied.value = false
  },
)

const open = computed({
  get: () => !!accounts.loginId,
  set: (value) => {
    if (value) return
    // Closing ends a login that still waits: its CLI would keep a port open.
    const id = accounts.loginId
    if (id && running.value) void window.api.accounts.cancelLogin(id)
    accounts.loginId = null
  },
})

function copy(): void {
  if (!state.value?.url) return
  void navigator.clipboard.writeText(state.value.url)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function openLink(): void {
  if (state.value?.url) void window.api.app.openExternal(state.value.url)
}

async function sendCode(): Promise<void> {
  const id = accounts.loginId
  if (!id || !code.value.trim()) return
  sending.value = true
  await attempt(() => window.api.accounts.loginCode(id, code.value.trim()), 'Code ließ sich nicht senden')
  sending.value = false
  code.value = ''
}

function retry(): void {
  const id = accounts.loginId
  if (id) void attempt(() => accounts.login(id), 'Anmeldung ließ sich nicht starten')
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <AccountDot v-if="account" :color="account.color" class="size-2.5" />
          Anmelden bei {{ cli }}
        </DialogTitle>
        <DialogDescription>Account „{{ account?.name }}“ · Anmeldung im Browser</DialogDescription>
      </DialogHeader>

      <div v-if="state?.status === 'success'" class="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
        <CircleCheckIcon class="mt-0.5 size-5 shrink-0 text-success" />
        <div class="flex min-w-0 flex-col gap-0.5">
          <span class="text-sm font-medium">Angemeldet</span>
          <span class="truncate text-xs text-muted-foreground">{{ signedIn ?? `${cli} hat den Login gespeichert.` }}</span>
        </div>
      </div>

      <Alert v-else-if="state?.status === 'failed'" variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Anmeldung fehlgeschlagen</AlertTitle>
        <AlertDescription class="whitespace-pre-line">{{ state.message }}</AlertDescription>
      </Alert>

      <!-- min-w-0: the grid of the dialog would otherwise grow with the unbroken login link. -->
      <div v-else class="flex min-w-0 flex-col gap-4">
        <div class="flex items-center gap-2.5 text-sm">
          <Spinner class="size-4 text-muted-foreground" />
          <span v-if="!state?.url && state?.status !== 'waiting'">{{ cli }} startet die Anmeldung …</span>
          <span v-else-if="codeLogin">Warte auf den Code aus dem Browser …</span>
          <span v-else>Warte auf die Anmeldung im Browser …</span>
        </div>
        <!-- A CLI with a login dialog over stdin opens the browser itself and doesn't tell its client the link. -->
        <p v-if="!state?.url && state?.status === 'waiting'" class="text-sm text-muted-foreground">
          {{ cli }} öffnet den Browser selbst. Melde dich dort mit dem Konto an, das zu „{{ account?.name }}“ gehört – Nexa merkt es von
          selbst. Geht kein Browser auf, starte „{{ account ? PROVIDERS[account.provider].command : '' }}“ im Terminal und melde dich dort an.
        </p>
        <template v-if="state?.url">
          <p v-if="codeLogin" class="text-sm text-muted-foreground">
            {{ cli }} hat den Browser geöffnet. Melde dich dort mit dem Konto an, das zu „{{ account?.name }}“ gehört. Danach zeigt
            die Seite einen Code: Füge ihn unten ein. Falls kein Browser aufging:
          </p>
          <p v-else class="text-sm text-muted-foreground">
            {{ cli }} hat den Browser geöffnet. Melde dich dort mit dem Konto an, das zu „{{ account?.name }}“ gehört – Nexa merkt
            es von selbst. Falls kein Browser aufging:
          </p>
          <div class="flex items-center gap-1 rounded-md border bg-(--code-bg) py-1 pr-1 pl-2.5">
            <code class="min-w-0 flex-1 truncate font-mono text-xs" v-tooltip="state.url">{{ state.url }}</code>
            <Button variant="ghost" size="icon-xs" aria-label="Link kopieren" @click="copy">
              <CheckIcon v-if="copied" class="text-success" />
              <CopyIcon v-else />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Im Browser öffnen" @click="openLink">
              <ExternalLinkIcon />
            </Button>
          </div>
          <Field v-if="state.acceptsCode">
            <FieldLabel for="login-code">Code aus dem Browser</FieldLabel>
            <form class="flex gap-2" @submit.prevent="sendCode">
              <Input
                id="login-code"
                v-model="code"
                class="font-mono"
                autocomplete="off"
                spellcheck="false"
                :placeholder="codeLogin ? 'Code oder Adresse der Seite' : 'Nur wenn der Browser einen Code zeigt'"
              />
              <Button type="submit" :variant="codeLogin ? 'default' : 'outline'" :disabled="!code.trim() || sending">Senden</Button>
            </form>
            <FieldDescription v-if="codeLogin">Statt des Codes geht auch die ganze Adresse der Seite, auf der du nach der Anmeldung landest.</FieldDescription>
            <FieldDescription v-else>Nötig, wenn der Browser nicht zurückleiten kann, z. B. auf einem anderen Gerät.</FieldDescription>
          </Field>
        </template>
      </div>

      <DialogFooter>
        <template v-if="state?.status === 'failed'">
          <Button variant="outline" @click="open = false">Schließen</Button>
          <Button @click="retry"><RotateCwIcon data-icon="inline-start" /> Erneut versuchen</Button>
        </template>
        <Button v-else-if="state?.status === 'success'" @click="open = false">Fertig</Button>
        <Button v-else variant="outline" @click="open = false">Abbrechen</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
