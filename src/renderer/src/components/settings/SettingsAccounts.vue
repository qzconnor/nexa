<script setup lang="ts">
import { PlusIcon, RefreshCwIcon } from '@lucide/vue'
import { ref } from 'vue'
import type { Account } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import AccountRow from '@/components/accounts/AccountRow.vue'
import RemoveAccountDialog from '@/components/accounts/RemoveAccountDialog.vue'
import ClaudeManagerImport from '@/components/setup/ClaudeManagerImport.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useSettingsFilter } from '@/composables/useSettingsSearch'
import { attempt } from '@/lib/errors'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'
import SettingsSection from './SettingsSection.vue'

/**
 * The accounts of each CLI. Every account has a config folder and login of its own; new chats start
 * with the default one, and a chat switches at its composer.
 */
const accounts = useAccountsStore()
const providers = useProvidersStore()
const removing = ref<Account | null>(null)
const removeOpen = ref(false)
const refreshing = ref(false)
const filter = useSettingsFilter()

function add(provider: ProviderId): void {
  accounts.formRequest = { account: null, provider }
}

function remove(account: Account): void {
  removing.value = account
  removeOpen.value = true
}

/** Logins from the files, limits from the CLIs (Codex servers that don't run are started for it). */
async function refresh(): Promise<void> {
  refreshing.value = true
  await attempt(async () => {
    await accounts.refresh()
    providers.usage = await window.api.usage.refresh()
  }, 'Aktualisieren fehlgeschlagen')
  refreshing.value = false
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection
      anchor="accounts.claude"
      title="Claude Code"
      description="Browser-Login, Long-lived Token oder API-Key – jeder Account mit eigenem Konfigurationsordner."
    >
      <template #actions>
        <Button variant="ghost" size="sm" :disabled="refreshing" @click="refresh">
          <Spinner v-if="refreshing" data-icon="inline-start" />
          <RefreshCwIcon v-else data-icon="inline-start" />
          Aktualisieren
        </Button>
        <Button variant="outline" size="sm" @click="add('claude')">
          <PlusIcon data-icon="inline-start" />
          Hinzufügen
        </Button>
      </template>
      <AccountRow v-for="account in accounts.ofProvider('claude')" :key="account.id" :account="account" @remove="remove(account)" />
    </SettingsSection>

    <SettingsSection anchor="accounts.codex" title="Codex" description="ChatGPT-Logins, jeder mit eigenem CODEX_HOME.">
      <template #actions>
        <Button variant="outline" size="sm" @click="add('codex')">
          <PlusIcon data-icon="inline-start" />
          Hinzufügen
        </Button>
      </template>
      <AccountRow v-for="account in accounts.ofProvider('codex')" :key="account.id" :account="account" @remove="remove(account)" />
    </SettingsSection>

    <div v-if="filter.shows('accounts.import')" data-setting="accounts.import">
      <ClaudeManagerImport always />
    </div>

    <p v-if="!filter.terms.value.length" class="px-1 text-xs text-muted-foreground">
      Neue Chats starten mit dem Vorgabe-Account ihrer CLI. Im Chat wechselt das Menü an der Eingabe den Account; die Unterhaltung
      geht mit allem, was die CLI wusste, beim anderen Account weiter. Sobald du für eine CLI einen eigenen Account hinzufügst,
      ist ihr Standard-Account (~/.claude, ~/.codex) ausgeblendet; Chats, die ihn nutzten, gehen mit dem Vorgabe-Account weiter.
    </p>

    <RemoveAccountDialog v-model:open="removeOpen" :account="removing" />
  </div>
</template>
