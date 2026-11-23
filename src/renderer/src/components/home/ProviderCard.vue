<script setup lang="ts">
import { CheckIcon, CopyIcon, ExternalLinkIcon, LogInIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'

/** What Nexa found out about a CLI: installed, version, login, with what to do when something is missing. */
const props = defineProps<{ provider: ProviderId; compact?: boolean }>()
const providers = useProvidersStore()
const accounts = useAccountsStore()
const copied = ref(false)

const meta = computed(() => PROVIDERS[props.provider])
const status = computed(() => providers.status(props.provider))
const checking = computed(() => !status.value?.checkedAt || providers.detecting)
const ready = computed(() => status.value?.installed && status.value.loggedIn !== false)

function copyInstall(): void {
  void navigator.clipboard.writeText(meta.value.installHint)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

async function login(): Promise<void> {
  // The default account of the CLI signs in; its dialog shows the progress.
  await attempt(() => accounts.login(accounts.defaultId(props.provider)), 'Anmeldung ließ sich nicht starten')
}

const openDocs = () => void window.api.app.openExternal(meta.value.installUrl)
</script>

<template>
  <div :class="cn('flex flex-col gap-2 rounded-xl border bg-card/60 p-4', ready && 'border-border', !ready && !checking && 'border-warning/40')">
    <div class="flex items-center gap-2.5">
      <ProviderIcon :provider="provider" class="size-5" />
      <span class="font-medium">{{ meta.name }}</span>
      <span class="ml-auto flex items-center gap-1.5 text-xs">
        <template v-if="checking"><Spinner class="size-3.5" /> wird geprüft</template>
        <template v-else-if="ready"><CheckIcon class="size-3.5 text-success" /> bereit</template>
        <template v-else-if="status?.installed"><TriangleAlertIcon class="size-3.5 text-warning" /> nicht angemeldet</template>
        <template v-else><TriangleAlertIcon class="size-3.5 text-warning" /> nicht installiert</template>
      </span>
    </div>
    <div v-if="!checking && status?.installed" class="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <span v-if="status.version">Version {{ status.version }}</span>
      <span v-if="status.account?.email">{{ status.account.email }}<template v-if="status.account.plan"> · {{ status.account.plan }}</template></span>
      <span v-if="!compact && status.path" class="truncate font-mono" :title="status.path">{{ status.path }}</span>
    </div>
    <div v-if="!checking && !status?.installed" class="flex flex-col gap-2">
      <p class="text-xs text-muted-foreground">Installieren, dann „Erneut prüfen“:</p>
      <div class="flex items-center gap-1 rounded-md border bg-(--code-bg) py-1 pr-1 pl-2.5">
        <code class="min-w-0 flex-1 truncate font-mono text-xs">{{ meta.installHint }}</code>
        <Button variant="ghost" size="icon-xs" aria-label="Kopieren" @click="copyInstall">
          <CheckIcon v-if="copied" class="text-success" />
          <CopyIcon v-else />
        </Button>
      </div>
      <Button variant="link" size="xs" class="self-start px-0" @click="openDocs">
        Anleitung <ExternalLinkIcon data-icon="inline-end" />
      </Button>
    </div>
    <div v-if="!checking && status?.installed && status.loggedIn === false">
      <Button size="sm" variant="outline" @click="login"><LogInIcon /> Anmelden</Button>
    </div>
    <p v-if="status?.error && !checking" class="text-xs text-destructive">{{ status.error }}</p>
  </div>
</template>
