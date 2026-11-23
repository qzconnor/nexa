<script setup lang="ts">
import { BellIcon, BellOffIcon } from '@lucide/vue'
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { attempt } from '@/lib/errors'
import { useSettingsStore } from '@/stores/settings'

/** Notifications on and off with one click, e.g. for a meeting; the details are in the settings. */
const settings = useSettingsStore()
const on = computed(() => settings.settings.notifications.enabled)
const label = computed(() => (on.value ? 'Benachrichtigungen an · Klick schaltet sie stumm' : 'Benachrichtigungen stumm · Klick schaltet sie ein'))

function toggle(): void {
  void attempt(() => settings.update({ notifications: { enabled: !on.value } }), 'Benachrichtigungen ließen sich nicht umschalten')
}
</script>

<template>
  <Button variant="ghost" size="icon-sm" class="app-no-drag text-muted-foreground" :aria-label="label" :aria-pressed="on" v-tooltip="label" @click="toggle">
    <BellIcon v-if="on" />
    <BellOffIcon v-else />
  </Button>
</template>
