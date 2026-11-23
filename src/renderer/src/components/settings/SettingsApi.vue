<script setup lang="ts">
import { CheckIcon, CopyIcon } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import type { ApiStatus, AppSettings, DeepPartial } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settings'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'

const store = useSettingsStore()
const s = computed(() => store.settings)
const api = ref<ApiStatus | null>(null)
const copied = ref(false)

onMounted(async () => (api.value = await window.api.api.status()))

async function setApi(patch: DeepPartial<AppSettings['api']>): Promise<void> {
  await attempt(() => store.update({ api: patch }), 'Speichern fehlgeschlagen')
  // The server restarts with the new settings; its status follows shortly after.
  setTimeout(async () => (api.value = await window.api.api.status()), 300)
}

function copyToken(): void {
  if (!api.value?.token) return
  void navigator.clipboard.writeText(api.value.token)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection anchor="api.server" title="Lokale API" description="Für Stream Deck, Skripte und Automationen: eine HTTP-API nur auf 127.0.0.1, mit Token.">
      <SettingField anchor="api.enabled" label="Einschalten">
        <Switch :model-value="s.api.enabled" @update:model-value="(v: boolean) => setApi({ enabled: v })" />
      </SettingField>
      <SettingField anchor="api.port" label="Port">
        <Input
          type="number"
          :model-value="s.api.port"
          class="h-8 w-28 text-right"
          @change="(e: Event) => setApi({ port: Number((e.target as HTMLInputElement).value) || 47615 })"
        />
      </SettingField>
      <div v-if="api" class="flex flex-col gap-2 rounded-lg border bg-background/40 p-3 text-sm">
        <div class="flex items-center gap-2">
          <span :class="cn('size-2 rounded-full', api.running ? 'bg-success' : 'bg-muted-foreground')" />
          {{ api.running ? `Läuft auf http://127.0.0.1:${api.port}` : 'Aus' }}
        </div>
        <p v-if="api.error" class="text-xs text-destructive">{{ api.error }}</p>
        <div v-if="api.token" class="flex items-center gap-1 rounded-md border bg-(--code-bg) py-1 pr-1 pl-2.5">
          <code class="selectable min-w-0 flex-1 truncate font-mono text-xs">Authorization: Bearer {{ api.token }}</code>
          <Button variant="ghost" size="icon-xs" aria-label="Token kopieren" @click="copyToken">
            <CheckIcon v-if="copied" class="text-success" />
            <CopyIcon v-else />
          </Button>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection anchor="api.endpoints" title="Endpunkte">
      <pre class="selectable overflow-x-auto font-mono text-[0.75rem] text-muted-foreground">GET  /api/status                CLIs, Usage, laufende Chats
GET  /api/usage                 Usage der CLIs
GET  /api/projects              Projekte
GET  /api/sessions              alle Chats mit Status
POST /api/sessions              { path | projectId, provider?, prompt?, show? }
POST /api/sessions/:id/send     { text }
POST /api/sessions/:id/interrupt
POST /api/sessions/:id/show
POST /api/window/show
GET  /api/events                Server-Sent Events</pre>
    </SettingsSection>
  </div>
</template>
