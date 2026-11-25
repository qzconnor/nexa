<script setup lang="ts">
import { FileIcon, FolderOpenIcon, InfoIcon, LockIcon, RefreshCwIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import type { CliConfigScope } from '@shared/cli-config'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import AccountDot from '@/components/accounts/AccountDot.vue'
import CliConfigHooks from '@/components/cli-config/CliConfigHooks.vue'
import CliConfigMcp from '@/components/cli-config/CliConfigMcp.vue'
import CliConfigPermissions from '@/components/cli-config/CliConfigPermissions.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { useAccountsStore } from '@/stores/accounts'
import { useCliConfigStore } from '@/stores/cli-config'
import { useProjectsStore } from '@/stores/projects'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'

/**
 * Einstellungen › CLI-Konfiguration: the MCP servers, permissions and hooks of a CLI, read from and
 * written to its own files, so they count in the terminal as well. Whose: the CLI, the account (its
 * config folder) and the scope, for a project's scopes with its folder.
 */
const store = useCliConfigStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()

onMounted(() => void attempt(() => store.show(), 'Einstellungen der CLI nicht lesbar'))

const target = computed(() => store.target)
const snapshot = computed(() => store.snapshot)
const providerOptions = computed(() => store.providers.map((id) => ({ value: id, label: PROVIDERS[id].short })))

/** The accounts of the CLI, and the one shown even when the list hides it (the standard one of a chat). */
const accountOptions = computed(() => {
  const t = target.value
  if (!t) return []
  const list = accounts.ofProvider(t.provider)
  const current = accounts.get(t.accountId)
  return current && !list.some((a) => a.id === current.id) ? [current, ...list] : list
})
const account = computed(() => accounts.get(target.value?.accountId))

const scopes = computed(() => snapshot.value?.scopes ?? [{ id: 'user' as CliConfigScope, label: 'Nutzer', description: '' }])
const scopeInfo = computed(() => scopes.value.find((s) => s.id === target.value?.scope))

/** The project of the folder shown; a chat's folder may be one inside it. */
const projectPath = computed(() => {
  const folder = target.value?.folder
  if (!folder) return undefined
  return projects.projects.find((p) => p.path === folder)?.path ?? folder
})
const projectOptions = computed(() => {
  const list = projects.projects.map((p) => ({ value: p.path, label: p.name }))
  const folder = target.value?.folder
  return folder && !list.some((p) => p.value === folder) ? [{ value: folder, label: folder }, ...list] : list
})

const selectClass = 'min-w-48 max-w-72 bg-background/60'

// The name tells the files apart; the folder, long as it is, may lose its end.
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const folderOf = (path: string) => path.slice(0, Math.max(0, path.length - fileName(path).length - 1))

const openFile = (path: string) => void attempt(() => window.api.app.openPath(path), 'Datei lässt sich nicht öffnen')
const showFolder = (path: string) => void attempt(() => window.api.app.showItem(path), 'Ordner lässt sich nicht öffnen')
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection
      anchor="cliConfig.target"
      title="Konfiguration"
      description="Die Dateien, die die CLI selbst liest: Was hier steht, gilt auch im Terminal und in der IDE."
    >
      <template #actions>
        <Button variant="ghost" size="sm" :disabled="store.loading || !target" @click="store.load()">
          <Spinner v-if="store.loading" data-icon="inline-start" />
          <RefreshCwIcon v-else data-icon="inline-start" />
          Neu lesen
        </Button>
      </template>

      <SettingField anchor="cliConfig.provider" label="CLI">
        <SegmentedControl
          v-if="target"
          :model-value="target.provider"
          :options="providerOptions"
          aria-label="CLI"
          @update:model-value="(provider: ProviderId) => store.select({ provider })"
        >
          <template #option="{ option }">
            <ProviderIcon :provider="option.value" class="size-3.5" />
            {{ option.label }}
          </template>
        </SegmentedControl>
      </SettingField>

      <SettingField anchor="cliConfig.account" label="Account" description="Jeder Account hat seinen eigenen Konfigurationsordner.">
        <Select v-if="target" :model-value="target.accountId" @update:model-value="(id) => store.select({ accountId: String(id) })">
          <SelectTrigger :class="selectClass" aria-label="Account"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="a in accountOptions" :key="a.id" :value="a.id">
              <AccountDot :color="a.color" />
              {{ a.name }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Button v-if="account" variant="ghost" size="icon-sm" aria-label="Konfigurationsordner öffnen" v-tooltip="account.configDir" @click="showFolder(account.configDir)">
          <FolderOpenIcon />
        </Button>
      </SettingField>

      <SettingField anchor="cliConfig.scope" label="Ebene" :description="scopeInfo?.description">
        <SegmentedControl
          v-if="target"
          :model-value="target.scope"
          :options="scopes.map((s) => ({ value: s.id, label: s.label }))"
          aria-label="Ebene"
          @update:model-value="(scope: CliConfigScope) => store.select({ scope })"
        />
      </SettingField>

      <SettingField
        anchor="cliConfig.project"
        label="Projekt"
        :description="target?.scope === 'user' ? 'Für die Ebenen eines Projekts.' : 'Dessen Dateien gelten für alle, die darin arbeiten.'"
      >
        <Select
          :model-value="projectPath"
          :disabled="!target || target.scope === 'user' || !projectOptions.length"
          @update:model-value="(folder) => store.select({ folder: String(folder) })"
        >
          <SelectTrigger :class="selectClass" aria-label="Projekt"><SelectValue placeholder="Kein Projekt" /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="p in projectOptions" :key="p.value" :value="p.value">{{ p.label }}</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>

      <div v-if="snapshot?.files.length" class="flex flex-col gap-1 rounded-lg border bg-background/40 p-2" aria-label="Dateien">
        <div v-for="file in snapshot.files" :key="file.path" class="flex min-w-0 items-center gap-2 text-xs">
          <FileIcon class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="w-40 shrink-0 truncate text-muted-foreground">{{ file.label }}</span>
          <span class="flex min-w-0 flex-1 items-baseline gap-2" v-tooltip="file.path">
            <span class="shrink-0 font-mono">{{ fileName(file.path) }}</span>
            <span class="min-w-0 truncate font-mono text-muted-foreground">{{ folderOf(file.path) }}</span>
          </span>
          <Button v-if="file.exists" variant="ghost" size="xs" @click="openFile(file.path)">Öffnen</Button>
          <span v-else class="shrink-0 px-2 text-muted-foreground">noch nicht angelegt</span>
        </div>
      </div>

      <Alert v-if="store.error" variant="destructive">
        <TriangleAlertIcon />
        <AlertTitle>Nicht lesbar</AlertTitle>
        <AlertDescription>{{ store.error }}</AlertDescription>
      </Alert>
      <Alert v-if="snapshot?.readOnly">
        <LockIcon />
        <AlertTitle>Nur zum Ansehen</AlertTitle>
        <AlertDescription>{{ snapshot.readOnly }}</AlertDescription>
      </Alert>
      <Alert v-if="snapshot?.notice">
        <InfoIcon />
        <AlertDescription>{{ snapshot.notice }}</AlertDescription>
      </Alert>
    </SettingsSection>

    <SettingsSection
      anchor="cliConfig.mcp"
      title="MCP-Server"
      description="Werkzeuge, die die CLI startet oder über das Netz erreicht. Werte, die nach Schlüsseln aussehen, zeigt Nexa nicht an."
    >
      <CliConfigMcp v-if="snapshot" />
      <Spinner v-else-if="store.loading" class="mx-auto text-muted-foreground" />
    </SettingsSection>

    <SettingsSection anchor="cliConfig.permissions" title="Berechtigungen" description="Was die CLI ohne Rückfrage darf, was sie fragt und was nie.">
      <CliConfigPermissions v-if="snapshot" />
      <Spinner v-else-if="store.loading" class="mx-auto text-muted-foreground" />
    </SettingsSection>

    <SettingsSection anchor="cliConfig.hooks" title="Hooks" description="Befehle, die die CLI bei Ereignissen ausführt: vor einem Werkzeug, nach einer Antwort, beim Start …">
      <CliConfigHooks v-if="snapshot" />
      <Spinner v-else-if="store.loading" class="mx-auto text-muted-foreground" />
    </SettingsSection>
  </div>
</template>
