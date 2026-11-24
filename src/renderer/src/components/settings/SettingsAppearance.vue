<script setup lang="ts">
import { computed } from 'vue'
import type { AppearanceSettings, WindowMaterial } from '@shared/types'
import { DEFAULT_ZOOM, normalizeZoom, ZOOM_STEPS } from '@shared/zoom'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import ThemeToolbar from '@/components/themes/ThemeToolbar.vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useClaudeManager } from '@/composables/useClaudeManager'
import { attempt } from '@/lib/errors'
import { CODE_FONT_FALLBACKS, RECOMMENDED_CODE_FONTS, RECOMMENDED_UI_FONTS, UI_FONT_FALLBACKS } from '@/lib/fonts'
import { supportsMaterial } from '@/lib/platform'
import { useSettingsStore } from '@/stores/settings'
import FontPicker from './FontPicker.vue'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'
import SliderControl from './SliderControl.vue'
import ThemePicker from './ThemePicker.vue'

const store = useSettingsStore()
const a = computed(() => store.settings.appearance)
// The hint at the Claude Manager's themes only while its files are there to import.
const claudeManager = useClaudeManager()

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
const uiFont = bind('uiFont')
const codeFont = bind('codeFont')
const ligatures = bind('ligatures')
const radius = bind('radius')
const chatWidth = bind('chatWidth')
// The select works with strings; the setting is a number.
const zoom = computed({
  get: () => String(normalizeZoom(a.value.zoom)),
  set: (value: string) => set({ zoom: Number(value) }),
})

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
    <SettingsSection
      anchor="appearance.theme"
      title="Theme"
      :description="claudeManager.found.value ? 'Farben für App und Code. Themes des Claude Managers lassen sich importieren.' : 'Farben für App und Code.'"
    >
      <template #actions><ThemeToolbar /></template>
      <ThemePicker v-model="theme" />
    </SettingsSection>

    <SettingsSection
      anchor="appearance.window"
      title="Fenster"
      :description="supportsMaterial ? 'Windows-11-Material hinter der App, Größe und Ecken.' : 'Größe und Ecken der Oberfläche.'"
    >
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
      <SettingField
        anchor="appearance.zoom"
        label="Skalierung"
        description="Vergrößert oder verkleinert die ganze Oberfläche. Strg + Plus und Strg + Minus ändern sie überall, Strg + 0 setzt sie zurück."
      >
        <Select v-model="zoom">
          <SelectTrigger class="min-w-32 bg-background/60" aria-label="Skalierung"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="step in ZOOM_STEPS" :key="step" :value="String(step)">{{ step === DEFAULT_ZOOM ? `${step} % (Standard)` : `${step} %` }}</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>
      <SettingField anchor="appearance.radius" for="radius" label="Ecken" description="Rundung von Karten, Knöpfen und Dialogen.">
        <SliderControl id="radius" v-model="radius" :min="0" :max="1.2" :step="0.05" :format="(v) => `${v.toFixed(2)} rem`" />
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="appearance.font" title="Schrift" description="Schriftarten und Größe für Oberfläche und Code.">
      <SettingField anchor="appearance.uiFont" for="ui-font" label="Schriftart" description="Für Oberfläche und Nachrichten.">
        <FontPicker id="ui-font" v-model="uiFont" standard="Geist" :recommended="RECOMMENDED_UI_FONTS" :fallbacks="UI_FONT_FALLBACKS" />
      </SettingField>
      <SettingField anchor="appearance.uiFontSize" for="ui-font-size" label="Schriftgröße">
        <SliderControl id="ui-font-size" v-model="uiFontSize" :min="12" :max="18" :format="(v) => `${v} px`" />
      </SettingField>
      <SettingField
        anchor="appearance.codeFont"
        for="code-font"
        label="Code-Schrift"
        description="Für Code in Antworten, Diffs, Dateien, Shell-Ausgaben und Werkzeugen."
      >
        <FontPicker id="code-font" v-model="codeFont" standard="Geist Mono" :recommended="RECOMMENDED_CODE_FONTS" :fallbacks="CODE_FONT_FALLBACKS" />
      </SettingField>
      <SettingField
        anchor="appearance.ligatures"
        for="ligatures"
        label="Ligaturen"
        description="Zeichenfolgen wie => oder != erscheinen als ein Zeichen (⇒, ≠), wenn die Schrift Ligaturen hat, z. B. JetBrains Mono, Fira Code oder Cascadia Code."
      >
        <Switch id="ligatures" v-model="ligatures" />
      </SettingField>
      <!-- The code font with its ligatures, without leaving the settings. -->
      <pre
        aria-hidden="true"
        class="overflow-x-auto rounded-lg border bg-(--code-bg) px-3 py-2 font-mono text-[0.85rem] leading-relaxed text-(--code-fg)"
      ><span class="text-(--syn-magenta)">const</span> <span class="text-(--syn-blue)">passt</span> = (a, b) => a !== b &amp;&amp; a >= <span class="text-(--syn-yellow)">0</span>
items.<span class="text-(--syn-blue)">filter</span>((x) => x.size &lt;= <span class="text-(--syn-yellow)">10</span>) <span class="text-(--syn-comment)">// -> ok</span></pre>
    </SettingsSection>

    <SettingsSection anchor="appearance.chat" title="Chat" description="Wie der Verlauf dargestellt wird.">
      <SettingField anchor="appearance.chatWidth" label="Breite" description="Wie breit Nachrichten und Eingabe höchstens werden. Normal und Breit wachsen auf großen Bildschirmen (4K, Ultrawide) mit, im selben Verhältnis wie auf Full HD.">
        <SegmentedControl v-model="chatWidth" :options="CHAT_WIDTHS" aria-label="Breite des Chats" />
      </SettingField>
    </SettingsSection>
  </div>
</template>
