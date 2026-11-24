<script setup lang="ts">
import { computed } from 'vue'
import type { AppSettings, DeepPartial, UserShell } from '@shared/types'
import { VOICE_LANGUAGES, voiceLanguage as resolveVoiceLanguage, voiceLanguageLabel } from '@shared/voice'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { isWindows } from '@/lib/platform'
import { useAccountsStore } from '@/stores/accounts'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'

const store = useSettingsStore()
const ui = useUiStore()
const s = computed(() => store.settings)

function update(patch: DeepPartial<AppSettings>): void {
  void attempt(() => store.update(patch), 'Speichern fehlgeschlagen')
}

const SHELLS: { value: UserShell; label: string }[] = [
  { value: 'powershell', label: 'PowerShell' },
  { value: 'gitbash', label: 'Git Bash' },
  { value: 'cmd', label: 'cmd' },
]
const shell = computed({
  get: () => s.value.chat.shell,
  set: (value: UserShell) => update({ chat: { shell: value } }),
})

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
    </SettingsSection>

    <SettingsSection anchor="chat.input" title="Eingabe">
      <SettingField anchor="chat.enterSends" label="Enter sendet" description="Aus: Strg+Enter sendet, Enter macht eine neue Zeile.">
        <Switch :model-value="s.chat.enterSends" @update:model-value="(v: boolean) => update({ chat: { enterSends: v } })" />
      </SettingField>
      <SettingField
        v-if="isWindows"
        anchor="chat.shell"
        label="Shell für „!“"
        description="„!“ am Anfang des Eingabefelds führt die Zeile als Befehl im Ordner des Chats aus. PowerShell 7, wenn installiert, sonst Windows PowerShell. Der Agent bekommt Befehl und Ausgabe mit dem nächsten Prompt, Schlüssel und Passwörter durch •••• ersetzt."
      >
        <SegmentedControl v-model="shell" :options="SHELLS" aria-label="Shell für „!“" />
      </SettingField>
    </SettingsSection>

    <SettingsSection
      anchor="chat.voice"
      title="Spracheingabe"
      description="Das Mikrofon in der Eingabe (Strg+M) schreibt mit, während du sprichst, in Chats mit jeder CLI. Erkannt wird mit der Spracherkennung von Claude, wie bei „/voice“ in Claude Code; dafür braucht es einen bei claude.ai angemeldeten Claude-Account."
    >
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
      description="Nexas eigener MCP-Server: die Agents zeichnen damit direkt im Chat und bedienen den Browser neben ihm."
    >
      <SettingField anchor="chat.renderTools" label="Diagramme, Charts und Tabellen" description="Gilt für neu gestartete CLIs.">
        <Switch :model-value="s.tools.renderTools" @update:model-value="(v: boolean) => update({ tools: { renderTools: v } })" />
      </SettingField>
      <SettingField
        anchor="chat.browserTools"
        label="Browser neben dem Chat"
        description="Die Agents öffnen und testen Seiten im Browser rechts vom Chat, du siehst zu. Gilt für neu gestartete CLIs."
      >
        <Switch :model-value="s.tools.browserTools" @update:model-value="(v: boolean) => update({ tools: { browserTools: v } })" />
      </SettingField>
      <SettingField
        anchor="chat.noClaudeInChrome"
        label="Ohne „Claude in Chrome“"
        description="Claude Code startet ohne seine Chrome-Erweiterung, damit Claude den Browser von Nexa nimmt."
      >
        <Switch
          :model-value="s.tools.noClaudeInChrome"
          :disabled="!s.tools.browserTools"
          @update:model-value="(v: boolean) => update({ tools: { noClaudeInChrome: v } })"
        />
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
