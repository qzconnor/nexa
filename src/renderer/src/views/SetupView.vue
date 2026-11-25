<script setup lang="ts">
import { ArrowRightIcon, RefreshCwIcon } from '@lucide/vue'
import { computed } from 'vue'
import { PROVIDER_IDS } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import AppLogo from '@/components/common/AppLogo.vue'
import ProviderCard from '@/components/providers/ProviderCard.vue'
import ClaudeManagerImport from '@/components/setup/ClaudeManagerImport.vue'
import CliSessionsImport from '@/components/setup/CliSessionsImport.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { andList } from '@/lib/format'
import { useProvidersStore } from '@/stores/providers'
import { useSettingsStore } from '@/stores/settings'

/**
 * The first start: which CLIs Nexa found (installed, version, login) and which of them to use, and
 * what to take over from the Claude Manager if it was used before. It takes the start page's place
 * until it is through; the same switches are in the settings („CLIs“, „Accounts“).
 */
const providers = useProvidersStore()
const settings = useSettingsStore()

const checking = computed(() => !providers.checked || providers.detecting)
/** What the button says: the start goes on without a usable CLI too, the start page then tells. */
const ready = computed(() => providers.available.length > 0)
const summary = computed(() => {
  if (checking.value) return 'Nexa sucht nach Claude Code, Codex und Antigravity CLI …'
  const found = PROVIDER_IDS.filter((id) => providers.status(id)?.installed)
  if (!found.length) return 'Nexa hat keine der CLIs gefunden. Installiere eine und prüfe dann erneut.'
  if (found.length === 1) return `Nexa hat ${PROVIDERS[found[0]].name} gefunden. Die anderen CLIs kannst du später dazunehmen.`
  if (found.length < PROVIDER_IDS.length) {
    return `Nexa hat ${andList(found.map((id) => PROVIDERS[id].name))} gefunden. Schalte aus, was du nicht nutzen willst.`
  }
  return 'Nexa hat alle CLIs gefunden. Schalte aus, was du nicht nutzen willst.'
})

function finish(): void {
  void attempt(() => settings.update({ setup: { done: true } }), 'Speichern fehlgeschlagen')
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-10">
      <div class="flex flex-col items-center gap-3 text-center">
        <AppLogo class="size-12" />
        <h1 class="text-2xl font-semibold tracking-tight">Willkommen bei Nexa</h1>
        <p class="max-w-lg text-sm text-balance text-muted-foreground">{{ summary }}</p>
      </div>

      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-medium text-muted-foreground">Welche CLIs willst du nutzen?</h2>
          <Button variant="ghost" size="xs" :disabled="providers.detecting" @click="providers.refresh()">
            <Spinner v-if="providers.detecting" />
            <RefreshCwIcon v-else />
            Erneut prüfen
          </Button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <ProviderCard v-for="id in PROVIDER_IDS" :key="id" :provider="id" compact toggle />
        </div>
        <p class="text-xs text-muted-foreground">Ausgeschaltete CLIs stehen nicht zur Wahl, und Nexa fragt ihre Limits nicht ab. Ändern lässt sich das jederzeit unter Einstellungen&nbsp;›&nbsp;CLIs.</p>
      </div>

      <ClaudeManagerImport />
      <CliSessionsImport v-if="ready" />

      <div class="flex flex-col items-center gap-2">
        <Button size="lg" :disabled="checking" @click="finish">
          {{ ready ? 'Los geht’s' : 'Ohne CLI weiter' }}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </div>
    </div>
  </div>
</template>
