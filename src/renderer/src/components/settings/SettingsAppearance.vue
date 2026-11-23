<script setup lang="ts">
import { computed } from 'vue'
import type { AppearanceSettings, WindowMaterial } from '@shared/types'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import ThemeToolbar from '@/components/themes/ThemeToolbar.vue'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { supportsMaterial } from '@/lib/platform'
import { useSettingsStore } from '@/stores/settings'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'
import SliderControl from './SliderControl.vue'
import ThemePicker from './ThemePicker.vue'

const store = useSettingsStore()
const a = computed(() => store.settings.appearance)

function set(patch: Partial<AppearanceSettings>): void {
  void attempt(() => store.update({ appearance: patch }), 'Speichern fehlgeschlagen')
}

/** A v-model for one appearance setting. */
function bind<K extends keyof AppearanceSettings>(key: K) {
  return computed({ get: () => a.value[key], set: (value: AppearanceSettings[K]) => set({ [key]: value } as Partial<AppearanceSettings>) })
}
const theme = bind('theme')
const material = bind('material')
const keepMaterialActive = bind('keepMaterialActive')
const surfaceOpacity = bind('surfaceOpacity')
const uiFontSize = bind('uiFontSize')
const radius = bind('radius')
const chatWidth = bind('chatWidth')

const MATERIALS: { value: WindowMaterial; label: string }[] = [
  { value: 'mica', label: 'Mica' },
  { value: 'acrylic', label: 'Acryl' },
  { value: 'tabbed', label: 'Mica Alt' },
  { value: 'none', label: 'Aus' },
]
const CHAT_WIDTHS = [
  { value: 'normal', label: 'Normal' },
  { value: 'wide', label: 'Breit' },
  { value: 'full', label: 'Voll' },
] as const
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection anchor="appearance.theme" title="Theme" description="Farben für App und Code. Themes des Claude Managers lassen sich importieren.">
      <template #actions><ThemeToolbar /></template>
      <ThemePicker v-model="theme" />
    </SettingsSection>

    <SettingsSection anchor="appearance.window" title="Fenster" :description="supportsMaterial ? 'Windows-11-Material hinter der App.' : 'Schrift und Ecken der Oberfläche.'">
      <template v-if="supportsMaterial">
        <SettingField anchor="appearance.material" label="Material" description="Acryl ist am stärksten transparent, Mica übernimmt dezent die Farbe des Desktops.">
          <SegmentedControl v-model="material" :options="MATERIALS" aria-label="Material" />
        </SettingField>
        <SettingField anchor="appearance.keepMaterial" label="Auch im Hintergrund" description="Das Material bleibt, wenn ein anderes Fenster im Vordergrund ist.">
          <Switch v-model="keepMaterialActive" :disabled="material === 'none'" />
        </SettingField>
        <SettingField anchor="appearance.surfaceOpacity" for="surface-opacity" label="Deckkraft der Flächen" description="Wie stark Inhalt, Karten und Sidebar das Material verdecken.">
          <SliderControl id="surface-opacity" v-model="surfaceOpacity" :min="20" :max="100" :step="2" :format="(v) => `${v} %`" />
        </SettingField>
      </template>
      <SettingField anchor="appearance.uiFontSize" for="ui-font-size" label="Schriftgröße">
        <SliderControl id="ui-font-size" v-model="uiFontSize" :min="12" :max="18" :format="(v) => `${v} px`" />
      </SettingField>
      <SettingField anchor="appearance.radius" for="radius" label="Ecken" description="Rundung von Karten, Knöpfen und Dialogen.">
        <SliderControl id="radius" v-model="radius" :min="0" :max="1.2" :step="0.05" :format="(v) => `${v.toFixed(2)} rem`" />
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="appearance.chat" title="Chat" description="Wie der Verlauf dargestellt wird.">
      <SettingField anchor="appearance.chatWidth" label="Breite" description="Wie breit Nachrichten und Eingabe höchstens werden.">
        <SegmentedControl v-model="chatWidth" :options="CHAT_WIDTHS" aria-label="Breite des Chats" />
      </SettingField>
    </SettingsSection>
  </div>
</template>
