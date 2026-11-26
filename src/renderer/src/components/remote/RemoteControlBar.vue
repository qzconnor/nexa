<script setup lang="ts">
import { RadioTowerIcon, UnplugIcon } from '@lucide/vue'
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import type { RemoteController } from '@shared/remote-ipc'
import { Button } from '@/components/ui/button'
import { andList } from '@/lib/format'
import { attempt } from '@/lib/errors'
import { useRemoteStore } from '@/stores/remote'

/**
 * Over the page while other devices watch this one's chats (Remote Control): who, and „Trennen“, which
 * takes the device's level here to „Aus“ until the user raises it again in the settings.
 */
const remote = useRemoteStore()
remote.start()

const list = computed(() => remote.controllers)
const acting = computed(() => list.value.some((c) => c.level === 'prompt' || c.level === 'full'))
const text = computed(() => {
  const names = andList(list.value.map((c) => `„${c.name}“`))
  if (list.value.length === 1) return acting.value ? `${names} steuert dieses Gerät per Fernsteuerung` : `${names} sieht die Chats dieses Geräts`
  return acting.value ? `${names} steuern dieses Gerät per Fernsteuerung` : `${names} sehen die Chats dieses Geräts`
})

async function disconnect(controller: RemoteController): Promise<void> {
  const done = await attempt(async () => {
    await remote.disconnect(controller.id)
    return true
  }, 'Trennen fehlgeschlagen')
  if (done) toast.success(`„${controller.name}“ getrennt`, { description: 'Es darf hier nichts mehr, bis du es unter Einstellungen › Geräte › Fernsteuerung wieder erlaubst.' })
}
</script>

<template>
  <div v-if="list.length" class="flex shrink-0 items-center gap-2 border-b bg-primary/10 px-4 py-1 text-xs text-foreground" role="status">
    <RadioTowerIcon class="size-3.5 shrink-0 text-primary" />
    <span class="min-w-0 flex-1 truncate">{{ text }}</span>
    <Button
      v-for="controller in list"
      :key="controller.id"
      variant="ghost"
      size="xs"
      v-tooltip="`„${controller.name}“ darf hier nichts mehr, bis du es in den Einstellungen wieder erlaubst`"
      @click="disconnect(controller)"
    >
      <UnplugIcon data-icon="inline-start" />
      {{ list.length > 1 ? `${controller.name} trennen` : 'Trennen' }}
    </Button>
  </div>
</template>
