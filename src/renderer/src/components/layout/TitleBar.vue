<script setup lang="ts">
import { PanelLeftIcon } from '@lucide/vue'
import { computed } from 'vue'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import AppLogo from '@/components/common/AppLogo.vue'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import TitleBarUsage from './TitleBarUsage.vue'

/**
 * The title bar: logo, the sidebar's button and the usage of the CLIs that count now. The caption
 * buttons are Electron's titleBarOverlay on the right, so that area stays free.
 */
const app = useAppStore()
const providers = useProvidersStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()

/**
 * The CLIs that count now: in a chat those it ran with (both after a switch), elsewhere the one new
 * chats start with. Limits of a CLI the chat doesn't use would only be noise.
 */
const shown = computed<ProviderId[]>(() => {
  const meta = ui.view === 'chat' ? sessions.active : null
  const wanted = meta ? PROVIDER_IDS.filter((id) => id === meta.provider || meta.cli[id]) : [settings.settings.defaults.provider]
  const list = wanted.filter((id) => providers.installed.includes(id))
  return list.length ? list : providers.installed.slice(0, 1)
})
</script>

<template>
  <header
    :data-unfocused="!app.windowState.focused || undefined"
    class="app-drag flex h-(--titlebar-height) shrink-0 items-center gap-1 pr-(--caption-buttons-width) pl-3"
  >
    <div class="flex items-center gap-2.5 transition-opacity in-data-unfocused:opacity-75">
      <AppLogo class="size-5" />
      <span class="text-[0.95rem] font-semibold tracking-tight">Nexa</span>
    </div>
    <Button variant="ghost" size="icon-sm" class="app-no-drag ml-2 text-muted-foreground" aria-label="Seitenleiste" @click="ui.toggleSidebar()">
      <PanelLeftIcon />
    </Button>
    <div class="h-full min-w-8 flex-1" />
    <div class="mr-2 flex items-center gap-1 transition-opacity in-data-unfocused:opacity-75">
      <TitleBarUsage v-for="id in shown" :key="id" :provider="id" />
    </div>
  </header>
</template>
