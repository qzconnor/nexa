<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { CommandStatus } from '@shared/types'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { useSettingsStore } from '@/stores/settings'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'

/** What `nx` can do, as `nx --help` says it (src/launcher/nx.cs). */
const EXAMPLES = [
  ['nx', 'neuer Chat im aktuellen Ordner'],
  ['nx C:\\Projekte\\demo', 'neuer Chat in einem anderen Ordner'],
  ['nx -a Firma', 'mit Account (Name, E-Mail oder ID, von Claude Code oder Codex)'],
  ['nx --claude', 'mit Claude Code, „--codex“ mit Codex'],
  ['nx -c', 'letzten Chat in diesem Ordner öffnen'],
  ['nx -r <id>', 'Chat fortsetzen: aus Nexa, eine Session von Claude Code oder ein Thread von Codex'],
  ['nx -r', 'Chats dieses Ordners zur Auswahl'],
  ['nx -n', 'neuer Chat, auch wenn im Ordner schon einer offen ist'],
  ['nx -m "<prompt>"', 'Chat öffnen und den Prompt gleich senden'],
  ['nx -- --model opus', 'Argumente an die CLI weitergeben (Codex: -c schlüssel=wert)'],
] as const

const store = useSettingsStore()
const reuseChat = computed({
  get: () => store.settings.general.nxReuseChat,
  set: (nxReuseChat: boolean) => void attempt(() => store.update({ general: { nxReuseChat } }), 'Speichern fehlgeschlagen'),
})

const status = ref<CommandStatus | null>(null)
const busy = ref(false)

const registerHint = computed(() => {
  if (status.value && !status.value.available) return 'Nur in der installierten App verfügbar.'
  const base = 'Der Installer richtet ihn ein: Benutzer-PATH und App-Pfad für die Explorer-Adressleiste.'
  return status.value?.hint ? `${base} ${status.value.hint}` : base
})

onMounted(async () => {
  status.value = (await attempt(() => window.api.command.status(), 'Status von „nx“ unbekannt')) ?? null
})

async function setRegistered(registered: boolean) {
  busy.value = true
  const next = await attempt(() => window.api.command.setRegistered(registered), 'Ändern fehlgeschlagen')
  busy.value = false
  if (!next) return
  status.value = next
  if (next.registered) toast.success('„nx“ ist eingerichtet', { description: 'In neu geöffneten Terminals verfügbar.' })
  else if (registered) toast.error('„nx“ ließ sich nicht einrichten', { description: next.hint ?? undefined })
}
</script>

<template>
  <SettingsSection anchor="general.command" title="Befehl „nx“" description="Öffnet einen Chat in Nexa – aus jedem Terminal oder der Explorer-Adressleiste.">
    <SettingField anchor="general.commandRegistered" for="command-registered" label="Befehl einrichten" :description="registerHint">
      <Spinner v-if="busy" class="text-muted-foreground" />
      <Switch
        id="command-registered"
        :model-value="status?.registered ?? false"
        :disabled="busy || !status?.available"
        @update:model-value="setRegistered"
      />
    </SettingField>
    <SettingField
      anchor="general.nxReuseChat"
      for="command-reuse-chat"
      label="Offenen Chat wiederverwenden"
      description="Läuft die CLI eines Chats im Ordner noch oder ist er noch leer, wechselt „nx“ zu ihm, statt einen neuen zu öffnen. -n, -m und Argumente für die CLI öffnen immer einen neuen."
    >
      <Switch id="command-reuse-chat" v-model="reuseChat" />
    </SettingField>
    <dl class="selectable grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
      <template v-for="[command, meaning] in EXAMPLES" :key="command">
        <dt><code class="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs">{{ command }}</code></dt>
        <dd class="text-muted-foreground">{{ meaning }}</dd>
      </template>
    </dl>
  </SettingsSection>
</template>
