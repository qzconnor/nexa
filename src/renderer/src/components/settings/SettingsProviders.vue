<script setup lang="ts">
import { RefreshCwIcon } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import { PROVIDER_IDS, type PermissionMode, type ProviderId } from '@shared/chat'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
import type { AppSettings, DeepPartial } from '@shared/types'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import ProviderCard from '@/components/providers/ProviderCard.vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { useProvidersStore } from '@/stores/providers'
import type { SettingsAnchor } from '@/lib/settings-index'
import { useSettingsStore } from '@/stores/settings'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'

/** An example of the extra arguments; Nexa passes Antigravity's `--add-dir` itself for a chat's folders. */
const ARGS_EXAMPLE: Record<ProviderId, string> = { claude: 'z. B. --add-dir ../shared', codex: 'z. B. --add-dir ../shared', antigravity: 'z. B. --sandbox' }

const store = useSettingsStore()
const providers = useProvidersStore()
const s = computed(() => store.settings)

function update(patch: DeepPartial<AppSettings>): void {
  void attempt(() => store.update(patch), 'Speichern fehlgeschlagen')
}

/** The anchor of a row of a CLI's card (lib/settings-index.ts). */
const cliAnchor = (id: ProviderId, row: 'enabled' | 'model' | 'path' | 'extraArgs') => `${id}.${row}` as SettingsAnchor

/** The last CLI that is on stays on (shared/providers.ts). */
const lastOn = (id: ProviderId) => providers.enabled.length === 1 && providers.enabled[0] === id
const setEnabled = (id: ProviderId, on: boolean) => void attempt(() => providers.setEnabled(id, on), 'Speichern fehlgeschlagen')

const selectClass = 'min-w-44 bg-background/60'
/** The CLI's own model: an empty setting, which a select item can't carry as its value. */
const CLI_DEFAULT = 'cli-default'

/** The models of a CLI, and the one set even before the list is there (or when the CLI no longer offers it). */
function modelChoices(id: ProviderId): { id: string; label: string }[] {
  const list = (providers.models[id] ?? []).filter((m) => m.id)
  const set = s.value[id].model
  return set && !list.some((m) => m.id === set) ? [{ id: set, label: set }, ...list] : list
}

// The models' names for the selects, not their ids: loaded once for the CLIs that are there.
onMounted(() => {
  for (const id of providers.installed) if (!providers.models[id]) void providers.loadModels(id)
})
const extraArgs = (id: ProviderId) => s.value[id].extraArgs.join(' ')
const setExtraArgs = (id: ProviderId, value: string) => update({ [id]: { extraArgs: value.split(/\s+/).filter(Boolean) } })
async function pickCli(id: ProviderId): Promise<void> {
  const dir = await window.api.app.pickDirectory()
  if (dir) update({ [id]: { path: dir } })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection anchor="providers.defaults" title="Neue Chats" description="Womit ein neuer Chat startet. An der Eingabe lässt sich alles jederzeit wechseln.">
      <template #actions>
        <Button variant="ghost" size="sm" :disabled="providers.detecting" @click="providers.refresh()">
          <RefreshCwIcon data-icon="inline-start" />
          Erneut prüfen
        </Button>
      </template>
      <SettingField anchor="providers.provider" label="CLI">
        <SegmentedControl
          :model-value="s.defaults.provider"
          :options="
            providers.enabled
              .filter((id) => providers.offered.includes(id) || id === s.defaults.provider)
              .map((id) => ({ value: id, label: PROVIDERS[id].settingsLabel ?? PROVIDERS[id].short }))
          "
          aria-label="CLI für neue Chats"
          @update:model-value="(provider) => update({ defaults: { provider } })"
        >
          <template #option="{ option }">
            <ProviderIcon :provider="option.value" class="size-3.5" />
            {{ option.label }}
          </template>
        </SegmentedControl>
      </SettingField>
      <SettingField anchor="providers.permissionMode" label="Freigaben" description="Was die CLI ohne Rückfrage darf.">
        <Select
          :model-value="s.defaults.permissionMode"
          @update:model-value="(mode) => update({ defaults: { permissionMode: mode as PermissionMode } })"
        >
          <SelectTrigger :class="selectClass" aria-label="Freigaben für neue Chats"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="(mode, id) in PERMISSION_MODES" :key="id" :value="id">{{ mode.label }}</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>
    </SettingsSection>

    <SettingsSection v-for="id in PROVIDER_IDS" :key="id" :anchor="id" :title="PROVIDERS[id].name">
      <template #icon><ProviderIcon :provider="id" /></template>
      <SettingField
        :anchor="cliAnchor(id, 'enabled')"
        label="In Nexa nutzen"
        :description="lastOn(id) ? 'Eine CLI bleibt immer eingeschaltet.' : 'Aus: nicht mehr für Chats wählbar, und Nexa fragt ihre Limits nicht ab.'"
      >
        <Switch
          :model-value="providers.enabled.includes(id)"
          :disabled="lastOn(id)"
          :aria-label="`${PROVIDERS[id].name} in Nexa nutzen`"
          @update:model-value="(on: boolean) => setEnabled(id, on)"
        />
      </SettingField>
      <ProviderCard :provider="id" />
      <SettingField :anchor="cliAnchor(id, 'model')" label="Modell" description="Für neue Chats.">
        <Select
          :model-value="s[id].model || CLI_DEFAULT"
          @update:open="(open) => open && providers.loadModels(id)"
          @update:model-value="(model) => update({ [id]: { model: model === CLI_DEFAULT ? '' : String(model) } })"
        >
          <SelectTrigger :class="selectClass" :aria-label="`Modell von ${PROVIDERS[id].name}`"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="CLI_DEFAULT">Standard der CLI</SelectItem>
            <SelectItem v-for="m in modelChoices(id)" :key="m.id" :value="m.id">{{ m.label }}</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>
      <SettingField :anchor="cliAnchor(id, 'path')" label="Pfad zur CLI" description="Leer: wird im PATH gesucht.">
        <Input
          :model-value="s[id].path"
          class="h-8 w-64 font-mono text-xs"
          :placeholder="providers.status(id)?.path ?? PROVIDERS[id].command"
          @change="(e: Event) => update({ [id]: { path: (e.target as HTMLInputElement).value.trim() } })"
        />
        <Button variant="outline" size="sm" @click="pickCli(id)">Wählen …</Button>
      </SettingField>
      <SettingField :anchor="cliAnchor(id, 'extraArgs')" label="Zusätzliche Argumente" description="Hängt Nexa beim Start der CLI an.">
        <Input
          :model-value="extraArgs(id)"
          class="h-8 w-64 font-mono text-xs"
          :placeholder="ARGS_EXAMPLE[id]"
          @change="(e: Event) => setExtraArgs(id, (e.target as HTMLInputElement).value)"
        />
      </SettingField>
    </SettingsSection>
  </div>
</template>
