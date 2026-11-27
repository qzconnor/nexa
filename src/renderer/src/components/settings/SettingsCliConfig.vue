<script setup lang="ts">
import { LayersIcon, RefreshCwIcon } from '@lucide/vue'
import { computed, onMounted, watch } from 'vue'
import type { ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import CliConfigHooks from '@/components/cli-config/CliConfigHooks.vue'
import CliConfigMcp from '@/components/cli-config/CliConfigMcp.vue'
import CliConfigOverview from '@/components/cli-config/CliConfigOverview.vue'
import CliConfigPermissions from '@/components/cli-config/CliConfigPermissions.vue'
import ListSkeleton from '@/components/common/ListSkeleton.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSettingsFilter } from '@/composables/useSettingsSearch'
import { attempt } from '@/lib/errors'
import type { SettingsAnchor } from '@/lib/settings-index'
import { useCliConfigStore, type CliConfigSection } from '@/stores/cli-config'
import { useUiStore } from '@/stores/ui'
import SettingsCliConfigBar from './SettingsCliConfigBar.vue'
import SettingsSection from './SettingsSection.vue'

/**
 * Einstellungen › CLI-Konfiguration: the MCP servers, permissions and hooks of a CLI, read from and
 * written to its own files, so they count in the terminal as well. Tabs at the top: „Alle CLIs“ (the
 * global MCP servers, side by side) and one per CLI; below a CLI's bar (account, scope, project) a tab
 * per area. A search drops the tabs and shows every card with hits, one below the other.
 */
const store = useCliConfigStore()
const ui = useUiStore()
const filter = useSettingsFilter()

const searching = computed(() => filter.terms.value.length > 0)

const SECTIONS: { id: CliConfigSection; label: string }[] = [
  { id: 'mcp', label: 'MCP-Server' },
  { id: 'permissions', label: 'Berechtigungen' },
  { id: 'hooks', label: 'Hooks' },
]

const tab = computed(() => (store.page === 'all' ? 'all' : (store.target?.provider ?? '')))
function selectTab(value: string | number): void {
  if (value === 'all') store.showAll()
  else store.select({ provider: value as ProviderId })
}
const mcpCount = computed(() => store.snapshot?.mcp.servers.length ?? 0)

/**
 * A card or row asked for (quick open, „Konnektoren verwalten“) comes to the front: its tab first.
 * At the start the page loads what it shows anyway.
 */
function follow(anchor: SettingsAnchor | null, initial = false): void {
  if (!anchor?.startsWith('cliConfig.')) return
  const section = SECTIONS.find((s) => anchor === `cliConfig.${s.id}`)
  if (section) store.section = section.id
  const page = anchor === 'cliConfig.global' ? 'all' : 'cli'
  if (page === store.page) return
  store.page = page
  if (!initial) void (page === 'all' ? store.loadOverview() : store.load())
}
follow(ui.settingsAnchor, true)
// At once: the dialog takes the anchor back and looks for its element after the next render.
watch(
  () => ui.settingsAnchor,
  (anchor) => follow(anchor),
  { flush: 'sync' },
)

onMounted(() => void attempt(() => store.show(searching.value), 'Einstellungen der CLI nicht lesbar'))
// A search shows both the overview and a CLI's cards: what isn't there yet comes now.
watch(searching, (on) => {
  if (!on) return
  if (!store.snapshot && !store.loading) void store.load()
  if (!store.overview && !store.overviewLoading) void store.loadOverview()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <Tabs v-if="!searching" :model-value="tab" @update:model-value="selectTab">
      <TabsList variant="line" data-setting="cliConfig.provider" aria-label="CLI" class="w-full justify-start border-b pb-1">
        <TabsTrigger value="all" class="flex-none px-2.5">
          <LayersIcon />
          Alle CLIs
        </TabsTrigger>
        <TabsTrigger v-for="id in store.providers" :key="id" :value="id" class="flex-none px-2.5">
          <ProviderIcon :provider="id" class="size-3.5" />
          {{ PROVIDERS[id].short }}
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <SettingsSection
      v-if="searching || store.page === 'all'"
      anchor="cliConfig.global"
      title="Globale MCP-Server"
      description="Ein globaler Server steht in jeder CLI und jedem Account auf der Ebene „Nutzer“. Nexa hält ihn gleich: Was du änderst, gilt überall, und neue Accounts bekommen ihn auch."
    >
      <template #actions>
        <Button variant="ghost" size="sm" :disabled="store.overviewLoading" @click="store.loadOverview()">
          <Spinner v-if="store.overviewLoading" data-icon="inline-start" />
          <RefreshCwIcon v-else data-icon="inline-start" />
          Neu lesen
        </Button>
      </template>
      <CliConfigOverview />
    </SettingsSection>

    <template v-if="searching || store.page === 'cli'">
      <SettingsCliConfigBar v-if="filter.shows('cliConfig.target')" :with-provider="searching" />

      <Tabs v-if="!searching" :model-value="store.section" @update:model-value="(id) => (store.section = id as CliConfigSection)">
        <TabsList aria-label="Bereich">
          <TabsTrigger v-for="s in SECTIONS" :key="s.id" :value="s.id" class="px-3">
            {{ s.label }}
            <Badge v-if="s.id === 'mcp' && mcpCount" variant="secondary" class="h-4 min-w-4 px-1 text-[0.65rem] tabular-nums">{{ mcpCount }}</Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <SettingsSection
        v-if="searching || store.section === 'mcp'"
        anchor="cliConfig.mcp"
        title="MCP-Server"
        description="Werkzeuge, die die CLI startet oder über das Netz erreicht. Werte, die nach Schlüsseln aussehen, zeigt Nexa nicht an."
      >
        <CliConfigMcp v-if="store.snapshot" />
        <ListSkeleton v-else-if="store.loading" />
      </SettingsSection>

      <SettingsSection
        v-if="searching || store.section === 'permissions'"
        anchor="cliConfig.permissions"
        title="Berechtigungen"
        description="Was die CLI ohne Rückfrage darf, was sie fragt und was nie."
      >
        <CliConfigPermissions v-if="store.snapshot" />
        <ListSkeleton v-else-if="store.loading" />
      </SettingsSection>

      <SettingsSection
        v-if="searching || store.section === 'hooks'"
        anchor="cliConfig.hooks"
        title="Hooks"
        description="Befehle, die die CLI bei Ereignissen ausführt: vor einem Werkzeug, nach einer Antwort, beim Start …"
      >
        <CliConfigHooks v-if="store.snapshot" />
        <ListSkeleton v-else-if="store.loading" />
      </SettingsSection>
    </template>
  </div>
</template>
