<script setup lang="ts">
import { ChevronDownIcon, FileIcon, FolderOpenIcon, InfoIcon, LockIcon, RefreshCwIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed } from 'vue'
import type { CliConfigScope } from '@shared/cli-config'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import AccountDot from '@/components/accounts/AccountDot.vue'
import HighlightText from '@/components/common/HighlightText.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useSettingsFilter } from '@/composables/useSettingsSearch'
import { attempt } from '@/lib/errors'
import { useAccountsStore } from '@/stores/accounts'
import { useCliConfigStore } from '@/stores/cli-config'
import { useProjectsStore } from '@/stores/projects'

/**
 * The bar above a CLI's settings: whose files they are (account, scope, project), the files
 * themselves and a new read. During a search it picks the CLI too, as the tabs above are gone then.
 */
defineProps<{ withProvider?: boolean }>()

const store = useCliConfigStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()
const filter = useSettingsFilter()

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

const labelClass = 'text-xs font-medium text-muted-foreground'
const selectClass = 'h-8 min-w-40 max-w-64 bg-background/60'

const openFile = (path: string) => void attempt(() => window.api.app.openPath(path), 'Datei lässt sich nicht öffnen')
const showFolder = (path: string) => void attempt(() => window.api.app.showItem(path), 'Ordner lässt sich nicht öffnen')
</script>

<template>
  <Card size="sm" data-setting="cliConfig.target">
    <CardContent class="flex flex-col gap-3">
      <div class="flex flex-wrap items-end gap-x-5 gap-y-3">
        <div v-if="withProvider && target && filter.shows('cliConfig.provider')" data-setting="cliConfig.provider" class="flex flex-col gap-1.5">
          <span :class="labelClass"><HighlightText text="CLI" :terms="filter.terms.value" /></span>
          <SegmentedControl
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
        </div>

        <div v-if="target && filter.shows('cliConfig.account')" data-setting="cliConfig.account" class="flex flex-col gap-1.5">
          <span :class="labelClass"><HighlightText text="Account" :terms="filter.terms.value" /></span>
          <div class="flex items-center gap-1">
            <Select :model-value="target.accountId" @update:model-value="(id) => store.select({ accountId: String(id) })">
              <SelectTrigger :class="selectClass" aria-label="Account" v-tooltip="'Jeder Account hat seinen eigenen Konfigurationsordner.'"><SelectValue /></SelectTrigger>
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
          </div>
        </div>

        <div v-if="target && filter.shows('cliConfig.scope')" data-setting="cliConfig.scope" class="flex flex-col gap-1.5">
          <span :class="labelClass"><HighlightText text="Ebene" :terms="filter.terms.value" /></span>
          <SegmentedControl
            :model-value="target.scope"
            :options="scopes.map((s) => ({ value: s.id, label: s.label }))"
            aria-label="Ebene"
            @update:model-value="(scope: CliConfigScope) => store.select({ scope })"
          />
        </div>

        <div v-if="target && filter.shows('cliConfig.project')" data-setting="cliConfig.project" class="flex flex-col gap-1.5">
          <span :class="labelClass"><HighlightText text="Projekt" :terms="filter.terms.value" /></span>
          <Select
            :model-value="projectPath"
            :disabled="target.scope === 'user' || !projectOptions.length"
            @update:model-value="(folder) => store.select({ folder: String(folder) })"
          >
            <SelectTrigger
              :class="selectClass"
              aria-label="Projekt"
              v-tooltip="target.scope === 'user' ? 'Nur für die Ebenen eines Projekts' : 'Dessen Dateien gelten für alle, die darin arbeiten.'"
            >
              <SelectValue placeholder="Kein Projekt" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="p in projectOptions" :key="p.value" :value="p.value">{{ p.label }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="ml-auto flex items-center gap-1">
          <DropdownMenu v-if="snapshot?.files.length">
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="sm">
                <FileIcon data-icon="inline-start" />
                Dateien
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-md max-w-[calc(100vw-4rem)]">
              <DropdownMenuItem v-for="file in snapshot.files" :key="file.path" :disabled="!file.exists" @select="openFile(file.path)">
                <FileIcon class="self-start mt-0.5" />
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate">{{ file.label }}</span>
                  <span class="truncate font-mono text-xs text-muted-foreground" v-tooltip="file.path">{{ file.path }}</span>
                </span>
                <span v-if="!file.exists" class="shrink-0 text-xs text-muted-foreground">noch nicht angelegt</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-sm" :disabled="store.loading || !target" aria-label="Neu lesen" v-tooltip="'Neu lesen'" @click="store.load()">
            <Spinner v-if="store.loading" />
            <RefreshCwIcon v-else />
          </Button>
        </div>
      </div>

      <p v-if="scopeInfo?.description" class="text-xs text-muted-foreground">{{ scopeInfo.description }}</p>

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
    </CardContent>
  </Card>
</template>
