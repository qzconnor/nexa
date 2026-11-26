<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SETTING_RANGES } from '@shared/defaults'
import type { AppSettings, DeepPartial, UserShell } from '@shared/types'
import { languageName, MAX_SPELLCHECK_LANGUAGES, shortLanguageNames, spellcheckLanguages } from '@shared/spellcheck'
import { voiceAvailable, VOICE_LANGUAGES, voiceLanguage as resolveVoiceLanguage, voiceLanguageLabel } from '@shared/voice'
import { ChevronDownIcon } from '@lucide/vue'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useChatActions } from '@/composables/useChatActions'
import { attempt } from '@/lib/errors'
import { microphonesOf, systemMicrophone, type Microphone } from '@/lib/microphones'
import { isWindows } from '@/lib/platform'
import { useAccountsStore } from '@/stores/accounts'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'
import SliderControl from './SliderControl.vue'

const store = useSettingsStore()
const ui = useUiStore()
const s = computed(() => store.settings)

function update(patch: DeepPartial<AppSettings>): void {
  void attempt(() => store.update(patch), 'Speichern fehlgeschlagen')
}

const chatActions = useChatActions()
/** Nexa's tools reach a CLI only at its start: the open chat's gets the offer to start anew. */
async function updateTools(patch: DeepPartial<AppSettings['tools']>): Promise<void> {
  const saved = await attempt(() => store.update({ tools: patch }).then(() => true), 'Speichern fehlgeschlagen')
  if (saved) chatActions.offerRestart()
}

/** Saved once the slider rests, not for every minute passed while dragging. */
const releaseIdle = ref(s.value.chat.releaseIdleMinutes)
watch(
  () => s.value.chat.releaseIdleMinutes,
  (value) => (releaseIdle.value = value),
)
let releaseTimer: ReturnType<typeof setTimeout> | undefined
const releaseIdleMinutes = computed({
  get: () => releaseIdle.value,
  set: (value: number) => {
    releaseIdle.value = value
    clearTimeout(releaseTimer)
    releaseTimer = setTimeout(() => update({ chat: { releaseIdleMinutes: value } }), 300)
  },
})
onBeforeUnmount(() => clearTimeout(releaseTimer))

const SHELLS: { value: UserShell; label: string }[] = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'gitbash', label: 'Git Bash' },
  { value: 'cmd', label: 'cmd' },
]
const shell = computed({
  get: () => s.value.chat.shell,
  set: (value: UserShell) => update({ chat: { shell: value } }),
})

const app = useAppStore()
const SPELLCHECK_DEFAULT = 'Wie das System und Englisch'
const spellcheckAvailable = computed(() => app.info?.spellcheckLanguages ?? [])
/** The languages checked in now, as the main process sets them (main/window/edit-menu.ts). */
const spellcheckActive = computed(() => spellcheckLanguages(s.value.chat.spellcheckLanguages, app.info?.systemLanguages ?? [], spellcheckAvailable.value))
/** By name; a language without its region (`de`) only where there is none with it (`de-DE`), or it is set. */
const spellcheckChoices = computed(() =>
  spellcheckAvailable.value
    .filter((code) => spellcheckActive.value.includes(code) || !spellcheckAvailable.value.some((other) => other.startsWith(`${code}-`)))
    .map((code) => ({ code, name: languageName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de')),
)
// Short: whether these are the system's shows the menu's first item.
const spellcheckText = computed(() => shortLanguageNames(spellcheckActive.value).join(', ') || 'Keine verfügbar')
/** From the languages checked in now, so choosing one more keeps the system's. */
function toggleSpellcheckLanguage(code: string): void {
  const active = spellcheckActive.value
  const next = active.includes(code) ? active.filter((c) => c !== code) : [...active, code]
  if (next.length) update({ chat: { spellcheckLanguages: next } })
}

// The selects can't hold an empty value: these stand for the setting's `''`.
const SYSTEM = 'system'
const AUTOMATIC = 'auto'
// The app's locale, as the main process reads it (app.getLocale()).
const systemLanguage = resolveVoiceLanguage('', navigator.language)
const voiceLanguage = computed({
  get: () => s.value.chat.voiceLanguage || SYSTEM,
  set: (value: string) => update({ chat: { voiceLanguage: value === SYSTEM ? '' : value } }),
})
const accounts = useAccountsStore()
/** API keys have no login the recognition could use. */
const claudeAccounts = computed(() => accounts.accounts.filter((a) => a.provider === 'claude' && a.kind !== 'apiKey'))
const voiceAccount = computed({
  // A removed account counts as „automatic“, here as in the main process.
  get: () => (claudeAccounts.value.some((a) => a.id === s.value.chat.voiceAccount) ? s.value.chat.voiceAccount : AUTOMATIC),
  set: (value: string) => update({ chat: { voiceAccount: value === AUTOMATIC ? '' : value } }),
})

const microphones = ref<Microphone[]>([])
const systemMic = ref<string | null>(null)
async function loadMicrophones(): Promise<void> {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
  microphones.value = microphonesOf(devices)
  systemMic.value = systemMicrophone(devices)
}
// A headset plugged in while the settings are open shows up right away.
onMounted(() => {
  void loadMicrophones()
  navigator.mediaDevices.addEventListener('devicechange', loadMicrophones)
})
onBeforeUnmount(() => navigator.mediaDevices.removeEventListener('devicechange', loadMicrophones))
const voiceMicrophone = computed({
  get: () => s.value.chat.voiceMicrophone || SYSTEM,
  set: (value: string) => update({ chat: { voiceMicrophone: value === SYSTEM ? '' : value } }),
})
/** The one set but unplugged stays in the list, so the choice doesn't seem lost. */
const missingMicrophone = computed(() => {
  const name = s.value.chat.voiceMicrophone
  return name && !microphones.value.some((m) => m.label === name) ? name : null
})
const systemMicrophoneText = computed(() => (systemMic.value ? `Wie das System (${systemMic.value})` : 'Wie das System'))
// Written out: the select doesn't pick up the name of an item that only came with the device list.
const microphoneText = computed(() => {
  const name = s.value.chat.voiceMicrophone
  if (!name) return systemMicrophoneText.value
  return name === missingMicrophone.value ? `${name} (nicht angeschlossen)` : name
})

const voiceDescription = computed(() => {
  const base = 'Das Mikrofon in der Eingabe (Strg+M) schreibt mit, während du sprichst, in Chats mit jeder CLI. Erkannt wird mit der Spracherkennung von Claude, auch in Codex-Chats.'
  if (!s.value.claude.enabled) return `${base} Claude Code ist ausgeschaltet, deshalb gibt es gerade kein Mikrofon.`
  if (!voiceAvailable(accounts.accounts, s.value.chat.voiceAccount, true)) return `${base} Dafür braucht es einen bei claude.ai angemeldeten Claude-Account; ohne ihn gibt es kein Mikrofon.`
  return base
})

async function clearBrowserData(): Promise<void> {
  const confirmed = await ui.confirm({
    title: 'Browserdaten löschen?',
    description: 'Der Browser neben dem Chat wird überall abgemeldet: Cookies, gespeicherte Daten der Seiten und Cache gehen verloren.',
    confirmText: 'Löschen',
    destructive: true,
  })
  if (confirmed) void attempt(() => window.api.browser.clearData(), 'Browserdaten nicht gelöscht')
}

/** In place of the settings: the list needs the room, and a dialog over a dialog over a dialog (its question) is too much. */
function cleanUp(): void {
  ui.settingsOpen = false
  ui.cleanupProject = null
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection anchor="chat.history" title="Verlauf" description="Was im Chat zu sehen ist.">
      <SettingField anchor="chat.showThinking" label="Gedanken anzeigen" description="Was das Modell denkt, offen im Verlauf über seiner Antwort.">
        <Switch :model-value="s.chat.showThinking" @update:model-value="(v: boolean) => update({ chat: { showThinking: v } })" />
      </SettingField>
      <SettingField anchor="chat.collapseDiffs" label="Änderungen eingeklappt" description="Diffs geänderter Dateien erst nach einem Klick zeigen.">
        <Switch :model-value="s.chat.collapseDiffs" @update:model-value="(v: boolean) => update({ chat: { collapseDiffs: v } })" />
      </SettingField>
      <SettingField
        anchor="chat.autoTitles"
        label="Titel vom Modell"
        description="Neue Chats bekommen nach dem ersten Prompt einen kurzen Titel vom Modell, auch in der CLI. Codex fragt sein Modell dafür eigens. Aus: die erste Zeile des Prompts."
      >
        <Switch :model-value="s.chat.autoTitles" @update:model-value="(v: boolean) => update({ chat: { autoTitles: v } })" />
      </SettingField>
      <SettingField
        anchor="chat.checkpoints"
        label="Checkpoints der Dateien"
        description="Nexa merkt sich vor jedem Prompt, wie die Dateien des Chats aussehen: Was ein Prompt geändert hat, lässt sich ansehen und zurückspulen, mit jeder CLI. Nexa legt die Stände in seinem Datenordner ab, das Repository des Projekts bleibt unberührt."
      >
        <Switch :model-value="s.chat.checkpoints" @update:model-value="(v: boolean) => update({ chat: { checkpoints: v } })" />
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="chat.processes" title="Prozesse" description="Was die CLIs der Chats an Speicher belegen.">
      <SettingField
        anchor="chat.releaseIdleMinutes"
        for="release-idle"
        label="CLI nach Ruhe beenden"
        description="Ein Chat, der so lange nichts tut, beendet seine CLI samt ihren MCP-Servern; der nächste Prompt startet sie wieder mit derselben Unterhaltung. Nicht, solange etwas im Hintergrund läuft."
      >
        <SliderControl
          id="release-idle"
          v-model="releaseIdleMinutes"
          v-bind="SETTING_RANGES['chat.releaseIdleMinutes']"
          :format="(v) => (v === 0 ? 'nie' : `nach ${v} min`)"
        />
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="chat.input" title="Eingabe">
      <SettingField anchor="chat.enterSends" label="Enter sendet" description="Aus: Strg+Enter sendet, Enter macht eine neue Zeile.">
        <Switch :model-value="s.chat.enterSends" @update:model-value="(v: boolean) => update({ chat: { enterSends: v } })" />
      </SettingField>
      <SettingField
        anchor="chat.promptSuggestions"
        label="Vorschlag für den nächsten Prompt"
        description="Nur Claude Code: Nach einer Antwort steht grau im Eingabefeld, was du wahrscheinlich als Nächstes schreibst, etwa „ja, mach weiter“. Tab übernimmt es. Claude Code fragt dafür sein Modell noch einmal kurz; das zählt etwas zum Limit."
      >
        <Switch :model-value="s.chat.promptSuggestions" @update:model-value="(v: boolean) => update({ chat: { promptSuggestions: v } })" />
      </SettingField>
      <SettingField
        anchor="chat.spellcheck"
        label="Rechtschreibprüfung"
        description="Tippfehler in den Textfeldern werden rot unterstrichen. Ein Rechtsklick auf das Wort zeigt Vorschläge und nimmt es auf Wunsch ins Wörterbuch auf."
      >
        <Switch :model-value="s.chat.spellcheck" @update:model-value="(v: boolean) => update({ chat: { spellcheck: v } })" />
      </SettingField>
      <SettingField
        v-if="spellcheckAvailable.length"
        anchor="chat.spellcheckLanguages"
        label="Sprachen"
        description="In welchen Sprachen geprüft wird. Ohne Auswahl in der des Systems und in Englisch, weil Prompts oft englische Fachwörter enthalten."
      >
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" class="max-w-72 min-w-44 justify-between bg-background/60 font-normal" :disabled="!s.chat.spellcheck" aria-label="Sprachen der Rechtschreibprüfung">
              <span class="truncate">{{ spellcheckText }}</span>
              <ChevronDownIcon class="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="max-h-80 w-64 overflow-y-auto">
            <DropdownMenuCheckboxItem :model-value="!s.chat.spellcheckLanguages.length" @select.prevent="update({ chat: { spellcheckLanguages: [] } })">
              {{ SPELLCHECK_DEFAULT }}
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              v-for="language in spellcheckChoices"
              :key="language.code"
              :model-value="spellcheckActive.includes(language.code)"
              :disabled="spellcheckActive.includes(language.code) ? spellcheckActive.length === 1 : spellcheckActive.length >= MAX_SPELLCHECK_LANGUAGES"
              @select.prevent="toggleSpellcheckLanguage(language.code)"
            >
              {{ language.name }}
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingField>
      <SettingField
        v-if="isWindows"
        anchor="chat.shell"
        label="Shell für „!“"
        description="„!“ am Anfang des Eingabefelds führt die Zeile als Befehl im Ordner des Chats aus. PowerShell 7, wenn installiert, sonst Windows PowerShell. Der Agent bekommt Befehl und Ausgabe mit dem nächsten Prompt, Schlüssel und Passwörter durch •••• ersetzt. Auch die Startbefehle der Projekte laufen in dieser Shell."
      >
        <SegmentedControl v-model="shell" :options="SHELLS" aria-label="Shell für „!“" />
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="chat.voice" title="Spracheingabe" :description="voiceDescription">
      <SettingField anchor="chat.voiceMicrophone" label="Mikrofon" description="Womit aufgenommen wird. Ist es nicht angeschlossen, nimmt die Spracheingabe das des Systems.">
        <Select v-model="voiceMicrophone">
          <SelectTrigger class="max-w-72 min-w-44 bg-background/60" aria-label="Mikrofon der Spracheingabe">
            <SelectValue>{{ microphoneText }}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="SYSTEM">{{ systemMicrophoneText }}</SelectItem>
            <SelectItem v-for="mic in microphones" :key="mic.id" :value="mic.label">{{ mic.label }}</SelectItem>
            <SelectItem v-if="missingMicrophone" :value="missingMicrophone">{{ missingMicrophone }} (nicht angeschlossen)</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>
      <SettingField anchor="chat.voiceLanguage" label="Sprache" description="Die Sprache, in der du sprichst. Pro Aufnahme erkennt Claude eine Sprache.">
        <Select v-model="voiceLanguage">
          <SelectTrigger class="min-w-44 bg-background/60" aria-label="Sprache der Spracheingabe"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="SYSTEM">Wie das System ({{ voiceLanguageLabel(systemLanguage) }})</SelectItem>
            <SelectItem v-for="language in VOICE_LANGUAGES" :key="language.code" :value="language.code">{{ language.label }}</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>
      <SettingField
        anchor="chat.voiceAutoStop"
        label="Automatisch beenden"
        description="Hörst du auf zu sprechen, endet die Aufnahme nach zwei Sekunden Pause von selbst; sagst du gar nichts, nach acht Sekunden. Aus: Sie endet mit einem Klick aufs Mikrofon, Strg+M oder Esc."
      >
        <Switch :model-value="s.chat.voiceAutoStop" @update:model-value="(v: boolean) => update({ chat: { voiceAutoStop: v } })" />
      </SettingField>
      <SettingField
        anchor="chat.voiceAutoSend"
        label="Automatisch abschicken"
        description="Endet die Aufnahme, geht die Nachricht gleich ab, ohne Enter. Esc beendet die Aufnahme, ohne abzuschicken."
      >
        <Switch :model-value="s.chat.voiceAutoSend" @update:model-value="(v: boolean) => update({ chat: { voiceAutoSend: v } })" />
      </SettingField>
      <SettingField
        anchor="chat.voiceAccount"
        label="Account"
        description="Mit wessen Anmeldung erkannt wird. Automatisch: der Account des Chats, wenn es ein Claude-Account ist, sonst der erste angemeldete."
      >
        <Select v-model="voiceAccount">
          <SelectTrigger class="min-w-44 bg-background/60" aria-label="Account der Spracheingabe"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem :value="AUTOMATIC">Automatisch</SelectItem>
            <SelectItem v-for="account in claudeAccounts" :key="account.id" :value="account.id">{{ account.name }}</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="chat.removal" title="Löschen" description="Gelöschte Chats lassen sich 8 Sekunden lang zurückholen.">
      <SettingField
        anchor="chat.deleteCliConversations"
        label="Transkripte der CLIs mitlöschen"
        description="Die Unterhaltung in Claude Code oder Codex kommt mit in den Papierkorb, samt Subagents und Checkpoints, in jedem Account mit einer Kopie. Aus: Sie bleibt und lässt sich in der CLI weiter fortsetzen."
      >
        <Switch :model-value="s.chat.deleteCliConversations" @update:model-value="(v: boolean) => update({ chat: { deleteCliConversations: v } })" />
      </SettingField>
      <SettingField anchor="chat.cleanup" label="Chats aufräumen" description="Alte oder große Chats finden und mehrere auf einmal löschen.">
        <Button variant="outline" size="sm" @click="cleanUp">Aufräumen …</Button>
      </SettingField>
    </SettingsSection>

    <SettingsSection
      anchor="chat.tools"
      title="Nexa-Werkzeuge"
      description="Nexas eigener MCP-Server: die Agents zeichnen damit direkt im Chat, bedienen den Browser neben ihm und erreichen deine anderen Chats. Solange einer der Schalter an ist, sehen sie darüber auch die Limits deiner Accounts."
    >
      <SettingField anchor="chat.renderTools" label="Diagramme, Charts und Tabellen" description="Gilt für neue Chats und nach „Chat neu starten“.">
        <Switch :model-value="s.tools.renderTools" @update:model-value="(v: boolean) => updateTools({ renderTools: v })" />
      </SettingField>
      <SettingField
        anchor="chat.browserTools"
        label="Browser neben dem Chat"
        description="Die Agents öffnen und testen Seiten im Browser rechts vom Chat, du siehst zu. Gilt für neue Chats und nach „Chat neu starten“."
      >
        <Switch :model-value="s.tools.browserTools" @update:model-value="(v: boolean) => updateTools({ browserTools: v })" />
      </SettingField>
      <SettingField
        anchor="chat.noClaudeInChrome"
        label="Ohne „Claude in Chrome“"
        description="Claude Code startet ohne seine Chrome-Erweiterung, damit Claude den Browser von Nexa nimmt."
      >
        <Switch
          :model-value="s.tools.noClaudeInChrome"
          :disabled="!s.tools.browserTools"
          @update:model-value="(v: boolean) => updateTools({ noClaudeInChrome: v })"
        />
      </SettingField>
      <SettingField
        anchor="chat.chatTools"
        label="Nachrichten zwischen Chats"
        description="Die Agents schreiben deinen anderen Chats, auch von Claude zu Codex und zurück, lesen deren Antworten, durchsuchen frühere Chats und legen neue an. Jeder Chat behält seine eigenen Freigaben. Gilt für neue Chats und nach „Chat neu starten“. Auch die Chats gekoppelter Geräte, soweit deren Einstellung und Fernsteuerung es zulassen; Agents anderer Geräte erreichen die Chats hier nur, wenn das hier an ist."
      >
        <Switch :model-value="s.tools.chatTools" @update:model-value="(v: boolean) => updateTools({ chatTools: v })" />
      </SettingField>
      <SettingField
        anchor="chat.browserData"
        label="Browserdaten"
        description="Meldet den Browser überall ab: Cookies, gespeicherte Daten der Seiten und Cache."
      >
        <Button variant="outline" size="sm" @click="clearBrowserData">Löschen …</Button>
      </SettingField>
      <p class="text-xs text-muted-foreground">
        Eigene MCP-Server richtest du wie gewohnt in der jeweiligen CLI ein (<code class="font-mono">claude mcp add</code> bzw.
        <code class="font-mono">~/.codex/config.toml</code>). Nexa startet die CLIs mit ihrer Konfiguration.
      </p>
    </SettingsSection>
  </div>
</template>
