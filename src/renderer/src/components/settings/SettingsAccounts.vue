<script setup lang="ts">
import { PlusIcon, RefreshCwIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import type { Account } from '@shared/accounts'
import type { ProviderId } from '@shared/chat'
import { DEFAULT_CONTINUE_PROMPT } from '@shared/defaults'
import type { ChatSettings } from '@shared/types'
import AccountList from '@/components/accounts/AccountList.vue'
import LoginTable from '@/components/accounts/LoginTable.vue'
import RemoveAccountDialog from '@/components/accounts/RemoveAccountDialog.vue'
import ClaudeManagerImport from '@/components/setup/ClaudeManagerImport.vue'
import CliSessionsImport from '@/components/setup/CliSessionsImport.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { useClaudeManager } from '@/composables/useClaudeManager'
import { useSettingsFilter } from '@/composables/useSettingsSearch'
import { attempt } from '@/lib/errors'
import { useAccountsStore } from '@/stores/accounts'
import { useProvidersStore } from '@/stores/providers'
import { useSettingsStore } from '@/stores/settings'
import SettingField from './SettingField.vue'
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
const claudeManager = useClaudeManager()
const settings = useSettingsStore()
const chat = computed(() => settings.settings.chat)

function updateChat(patch: Partial<ChatSettings>): void {
  void attempt(() => settings.update({ chat: patch }), 'Speichern fehlgeschlagen')
}

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
      <AccountList provider="claude" @remove="remove" />
    </SettingsSection>

    <SettingsSection anchor="accounts.codex" title="Codex" description="ChatGPT-Logins, jeder mit eigenem CODEX_HOME.">
      <template #actions>
        <Button variant="outline" size="sm" @click="add('codex')">
          <PlusIcon data-icon="inline-start" />
          Hinzufügen
        </Button>
      </template>
      <AccountList provider="codex" @remove="remove" />
    </SettingsSection>

    <SettingsSection
      anchor="accounts.logins"
      title="Logins"
      description="Claude Code und Codex erneuern den Access-Token eines Browser-Logins selbst. Erst wenn der Login endet, musst du dich neu anmelden."
    >
      <SettingField
        anchor="accounts.keepLoginsFresh"
        label="Logins frisch halten"
        description="Läuft der Access-Token eines Claude-Accounts ab, holt Nexa mit dem Refresh-Token einen neuen, wie Claude Code beim Start einer Session und unter derselben Sperre. So stimmen die Limits ruhender Accounts, und ein Wechsel zu ihnen geht sofort. Codex erneuert seine Logins selbst."
      >
        <Switch :model-value="chat.keepLoginsFresh" @update:model-value="(v: boolean) => updateChat({ keepLoginsFresh: v })" />
      </SettingField>
      <LoginTable :keep-fresh="chat.keepLoginsFresh" />
    </SettingsSection>

    <SettingsSection anchor="accounts.limit" title="Bei erreichtem Limit" description="Wenn ein Chat am Limit seines Accounts stehen bleibt.">
      <SettingField
        anchor="accounts.autoSwitch"
        label="Account automatisch wechseln"
        description="Der Chat geht mit dem nächsten freien Account derselben CLI weiter, in der Reihenfolge oben; der verlassene bleibt bis zu seinem Reset außen vor. Ist keiner frei, wartet der Chat auf den ersten Reset. API-Keys nimmt der Wechsel nie, sie kosten pro Token. „Am Reset fortsetzen“ im Chat geht auch ohne den Wechsel."
      >
        <Switch :model-value="chat.autoSwitch" @update:model-value="(v: boolean) => updateChat({ autoSwitch: v })" />
      </SettingField>
      <SettingField
        anchor="accounts.continuePrompt"
        for="continue-prompt"
        label="Nachricht zum Weitermachen"
        description="Geht nach dem Wechsel oder am Reset hinaus, damit der Agent dort weitermacht, wo er stehen blieb."
      >
        <Input
          id="continue-prompt"
          :model-value="chat.continuePrompt"
          :placeholder="DEFAULT_CONTINUE_PROMPT"
          class="h-8 w-56"
          @change="(e: Event) => updateChat({ continuePrompt: (e.target as HTMLInputElement).value.trim() })"
        />
      </SettingField>
    </SettingsSection>

    <div v-if="filter.shows('accounts.cliImport')" data-setting="accounts.cliImport">
      <CliSessionsImport />
    </div>

    <div v-if="claudeManager.found.value && filter.shows('accounts.import')" data-setting="accounts.import">
      <ClaudeManagerImport />
    </div>

    <p v-if="!filter.terms.value.length" class="px-1 text-xs text-muted-foreground">
      Neue Chats starten mit dem Vorgabe-Account ihrer CLI. Im Chat wechselt das Menü an der Eingabe den Account; die Unterhaltung
      geht mit allem, was die CLI wusste, beim anderen Account weiter. Sobald du für eine CLI einen eigenen Account hinzufügst,
      ist ihr Standard-Account (~/.claude, ~/.codex) ausgeblendet; Chats, die ihn nutzten, gehen mit dem Vorgabe-Account weiter.
      Die Reihenfolge änderst du am Griff links an einer Karte (ziehen oder Pfeiltasten); so stehen die Accounts überall in Nexa.
    </p>

    <RemoveAccountDialog v-model:open="removeOpen" :account="removing" />
  </div>
</template>
