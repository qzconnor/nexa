<script setup lang="ts">
import { computed } from 'vue'
import { ACTIVITY_CHOICES } from '@shared/defaults'
import type { FileTouchKind } from '@shared/files'
import type { GeneralSettings } from '@shared/types'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { formatActivityTime } from '@/lib/file-tree'
import { TOUCH_ICON } from '@/lib/file-touch'
import { isWindows } from '@/lib/platform'
import type { SettingsAnchor } from '@/lib/settings-index'
import { useSettingsStore } from '@/stores/settings'
import SettingField from './SettingField.vue'
import SettingsCommand from './SettingsCommand.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTransfer from './SettingsTransfer.vue'

const store = useSettingsStore()
const g = computed(() => store.settings.general)

/** A v-model for one general setting. */
function bind<K extends keyof GeneralSettings>(key: K) {
  return computed({
    get: () => g.value[key],
    set: (value: GeneralSettings[K]) => void attempt(() => store.update({ general: { [key]: value } }), 'Speichern fehlgeschlagen'),
  })
}
const runInTray = bind('runInTray')
const launchAtLogin = bind('launchAtLogin')
const confirmQuitRunning = bind('confirmQuitRunning')

const areaName = isWindows ? 'Infobereich' : 'Statusbereich'
const startLabel = isWindows ? 'Mit Windows starten' : 'Bei der Anmeldung starten'
const startDescription = computed(() => {
  const how = runInTray.value
    ? `Nexa startet unsichtbar im ${areaName}, bis du es öffnest.`
    : `Nexa öffnet sich nach der Anmeldung. Mit „Im ${areaName} weiterlaufen“ startet es unsichtbar.`
  // A development build would register Electron itself, so it registers nothing.
  return import.meta.env.DEV ? `${how} In der Entwicklungsversion ohne Wirkung.` : how
})

/** The kinds in the order the file tree's filter shows them, each with its row. */
const ACTIVITY_ROWS: { kind: FileTouchKind; anchor: SettingsAnchor; label: string }[] = [
  { kind: 'read', anchor: 'general.activityRead', label: 'Gelesen' },
  { kind: 'search', anchor: 'general.activitySearch', label: 'Durchsucht' },
  { kind: 'write', anchor: 'general.activityWrite', label: 'Geschrieben' },
  { kind: 'commit', anchor: 'general.activityCommit', label: 'Committet' },
]

function setActivity(kind: FileTouchKind, value: unknown): void {
  const seconds = Number(value)
  if (!(ACTIVITY_CHOICES as readonly number[]).includes(seconds)) return
  void attempt(() => store.update({ general: { activitySeconds: { [kind]: seconds } } }), 'Speichern fehlgeschlagen')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection anchor="general.window" title="Fenster und Start" description="Was beim Schließen des Fensters und bei der Anmeldung passiert.">
      <SettingField
        anchor="general.runInTray"
        for="run-in-tray"
        :label="`Im ${areaName} weiterlaufen`"
        :description="`Schließen blendet das Fenster nur aus: Chats, lokale API und Benachrichtigungen laufen weiter. Das Symbol im ${areaName} öffnet Nexa wieder, sein Menü beendet es.`"
      >
        <Switch id="run-in-tray" v-model="runInTray" />
      </SettingField>
      <SettingField anchor="general.launchAtLogin" for="launch-at-login" :label="startLabel" :description="startDescription">
        <Switch id="launch-at-login" v-model="launchAtLogin" />
      </SettingField>
      <SettingField
        anchor="general.confirmQuitRunning"
        for="confirm-quit-running"
        label="Vor dem Beenden fragen, wenn noch etwas läuft"
        description="Arbeitet ein Chat noch oder läuft ein Befehl, fragt Nexa vor dem Beenden. Sonst brechen die Antworten ab, und die Befehle enden."
      >
        <Switch id="confirm-quit-running" v-model="confirmQuitRunning" />
      </SettingField>
    </SettingsSection>
    <SettingsSection
      anchor="general.fileActivity"
      title="Aktivität im Dateibaum"
      description="Wie lange eine Datei als aktiv gilt, nachdem der Agent an ihr war. So lange zeigt sie der Filter „Aktivität“ im Dateibaum, danach verschwindet sie."
    >
      <SettingField v-for="row in ACTIVITY_ROWS" :key="row.kind" :anchor="row.anchor" :label="row.label" :for="`activity-${row.kind}`">
        <div class="flex items-center gap-2" :data-touch="row.kind">
          <component :is="TOUCH_ICON[row.kind]" class="size-3.5 text-(--touch)" aria-hidden="true" />
          <Select :model-value="String(g.activitySeconds[row.kind])" @update:model-value="(v) => setActivity(row.kind, v)">
            <SelectTrigger :id="`activity-${row.kind}`" class="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem v-for="seconds in ACTIVITY_CHOICES" :key="seconds" :value="String(seconds)">{{ formatActivityTime(seconds) }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingField>
    </SettingsSection>
    <!-- nx.exe is Windows' only. -->
    <SettingsCommand v-if="isWindows" />
    <SettingsTransfer />
  </div>
</template>
