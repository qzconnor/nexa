<script setup lang="ts">
import { computed } from 'vue'
import type { AppSettings, DeepPartial } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
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

async function clearBrowserData(): Promise<void> {
  const confirmed = await ui.confirm({
    title: 'Browserdaten löschen?',
    description: 'Der Browser neben dem Chat wird überall abgemeldet: Cookies, gespeicherte Daten der Seiten und Cache gehen verloren.',
    confirmText: 'Löschen',
    destructive: true,
  })
  if (confirmed) void attempt(() => window.api.browser.clearData(), 'Browserdaten nicht gelöscht')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection anchor="chat.history" title="Verlauf" description="Was im Chat zu sehen ist.">
      <SettingField anchor="chat.showThinking" label="Gedanken anzeigen" description="Was das Modell denkt, eingeklappt im Verlauf.">
        <Switch :model-value="s.chat.showThinking" @update:model-value="(v: boolean) => update({ chat: { showThinking: v } })" />
      </SettingField>
      <SettingField anchor="chat.collapseTools" label="Werkzeuge eingeklappt" description="Auch Änderungen an Dateien erst nach einem Klick zeigen.">
        <Switch :model-value="s.chat.collapseTools" @update:model-value="(v: boolean) => update({ chat: { collapseTools: v } })" />
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="chat.input" title="Eingabe">
      <SettingField anchor="chat.enterSends" label="Enter sendet" description="Aus: Strg+Enter sendet, Enter macht eine neue Zeile.">
        <Switch :model-value="s.chat.enterSends" @update:model-value="(v: boolean) => update({ chat: { enterSends: v } })" />
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
