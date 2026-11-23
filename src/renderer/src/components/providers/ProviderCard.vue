<script setup lang="ts">
import { CheckIcon, CopyIcon, ExternalLinkIcon, LogInIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'

/**
 * What Nexa found out about a CLI: installed, version, login, with what to do when something is
 * missing; greyed out while it is switched off. `toggle`: with the switch for that (setup).
 */
const props = defineProps<{ provider: ProviderId; compact?: boolean; toggle?: boolean }>()
const providers = useProvidersStore()
const accounts = useAccountsStore()
const copied = ref(false)

const meta = computed(() => PROVIDERS[props.provider])
const status = computed(() => providers.status(props.provider))
const checking = computed(() => !status.value?.checkedAt || providers.detecting)
const ready = computed(() => status.value?.installed && status.value.loggedIn !== false)
const on = computed(() => providers.enabled.includes(props.provider))
/** The last CLI that is on stays on (shared/providers.ts). */
const lastOn = computed(() => on.value && providers.enabled.length === 1)

function copyInstall(): void {
  void navigator.clipboard.writeText(meta.value.installHint)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

async function login(): Promise<void> {
  // The default account of the CLI signs in; its dialog shows the progress.
  await attempt(() => accounts.login(accounts.defaultId(props.provider)), 'Anmeldung ließ sich nicht starten')
}

function setOn(value: boolean): void {
  void attempt(() => providers.setEnabled(props.provider, value), 'Speichern fehlgeschlagen')
}

const openDocs = () => void window.api.app.openExternal(meta.value.installUrl)
</script>

<template>
  <div
    :class="
      cn(
        'flex flex-col gap-2 rounded-xl border bg-card/60 p-4 transition-colors',
        !ready && !checking && on && 'border-warning/40',
        !on && 'bg-transparent',
      )
    "
  >
    <div class="flex items-center gap-2.5">
      <ProviderIcon :provider="provider" :class="cn('size-5 transition-opacity', !on && 'opacity-50 grayscale')" />
      <span :class="cn('font-medium', !on && 'text-muted-foreground')">{{ meta.name }}</span>
      <span class="ml-auto flex items-center gap-1.5 text-xs">
        <template v-if="checking"><Spinner class="size-3.5" /> wird geprüft</template>
        <template v-else-if="!on"><span class="text-muted-foreground">ausgeschaltet</span></template>
        <template v-else-if="ready"><CheckIcon class="size-3.5 text-success" /> bereit</template>
        <template v-else-if="status?.installed"><TriangleAlertIcon class="size-3.5 text-warning" /> nicht angemeldet</template>
        <template v-else><TriangleAlertIcon class="size-3.5 text-warning" /> nicht installiert</template>
      </span>
      <Switch
        v-if="toggle"
        :model-value="on"
        :disabled="lastOn"
        :aria-label="`${meta.name} in Nexa nutzen`"
        v-tooltip="lastOn ? 'Eine CLI bleibt immer eingeschaltet' : ''"
        class="ml-1"
        @update:model-value="setOn"
      />
    </div>
    <div v-if="!checking && status?.installed" :class="cn('flex flex-col gap-0.5 text-xs text-muted-foreground', !on && 'opacity-70')">
      <span v-if="status.version">Version {{ status.version }}</span>
      <span v-if="status.account?.email">{{ status.account.email }}<template v-if="status.account.plan"> · {{ status.account.plan }}</template></span>
      <span v-if="!compact && status.path" class="truncate font-mono" :title="status.path">{{ status.path }}</span>
    </div>
    <div v-if="!checking && !status?.installed && on" class="flex flex-col gap-2">
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
    <div v-if="!checking && status?.installed && status.loggedIn === false && on">
      <Button size="sm" variant="outline" @click="login"><LogInIcon /> Anmelden</Button>
    </div>
    <p v-if="status?.error && !checking && on" class="text-xs text-destructive">{{ status.error }}</p>
  </div>
</template>
