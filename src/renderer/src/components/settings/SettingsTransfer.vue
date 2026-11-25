<script setup lang="ts">
import { FileInputIcon, FileOutputIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useSettingsTransfer } from '@/composables/useSettingsTransfer'
import SettingsSection from './SettingsSection.vue'

/** Export and import of the settings, e.g. to take them to another computer. Accounts stay out. */
const { busy, exportSettings, importSettings } = useSettingsTransfer()
</script>

<template>
  <SettingsSection
    anchor="general.transfer"
    title="Einstellungen übertragen"
    description="Sichert die Einstellungen und eigenen Themes in einer Datei, etwa für einen anderen Computer. Accounts und Logins bleiben draußen. Beim Import zeigt Nexa erst, was sich ändern würde."
  >
    <template #actions>
      <Button variant="outline" size="sm" :disabled="busy" @click="importSettings">
        <FileInputIcon data-icon="inline-start" />
        Importieren …
      </Button>
      <Button variant="outline" size="sm" :disabled="busy" @click="exportSettings">
        <FileOutputIcon data-icon="inline-start" />
        Exportieren …
      </Button>
    </template>
  </SettingsSection>
</template>
