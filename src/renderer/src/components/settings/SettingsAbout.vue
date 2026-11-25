<script setup lang="ts">
import { FolderOpenIcon } from '@lucide/vue'
import AppLogo from '@/components/common/AppLogo.vue'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'
import SettingsSection from './SettingsSection.vue'

const app = useAppStore()
const openUserData = () => app.info && void window.api.app.openPath(app.info.userData)
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection anchor="about.app" title="Nexa" description="Claude Code, Codex und Gemini CLI in einer Oberfläche.">
      <div class="flex items-center gap-3">
        <AppLogo class="size-10" />
        <div class="flex flex-col">
          <span class="font-medium">Nexa {{ app.info?.version }}</span>
          <span class="selectable text-xs text-muted-foreground">{{ app.info?.userData }}</span>
        </div>
        <Button variant="outline" size="sm" class="ml-auto" @click="openUserData">
          <FolderOpenIcon data-icon="inline-start" />
          App-Daten öffnen
        </Button>
      </div>
    </SettingsSection>
  </div>
</template>
