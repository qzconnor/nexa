<script setup lang="ts">
import { computed } from 'vue'
import type { GeneralSettings } from '@shared/types'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { isWindows } from '@/lib/platform'
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
    <!-- nx.exe is Windows' only. -->
    <SettingsCommand v-if="isWindows" />
    <SettingsTransfer />
  </div>
</template>
