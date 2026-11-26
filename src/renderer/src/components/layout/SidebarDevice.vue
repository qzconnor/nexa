<script setup lang="ts">
import { ChevronRightIcon, EyeOffIcon, LoaderCircleIcon, MonitorIcon, RotateCwIcon, SettingsIcon, SquarePenIcon } from '@lucide/vue'
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useChatActions } from '@/composables/useChatActions'
import { cn } from '@/lib/utils'
import { useShownDeviceStore } from '@/stores/device'
import { useDevicesStore, type RemoteDevice } from '@/stores/devices'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import SidebarTree from './SidebarTree.vue'

/**
 * Another device in the sidebar (Remote Control), inside a `DeviceScope` of it: its name, and below it
 * its projects and chats as this device's show above, or why they don't show. Right-click hides it.
 */
const props = defineProps<{ device: RemoteDevice; now: number }>()
const devices = useDevicesStore()
const ui = useUiStore()
const shown = useShownDeviceStore()
const sessions = useSessionsStore()
const chat = useChatActions()

const open = computed(() => !ui.foldedDevices.has(props.device.id))
/** Its start page is on screen: the button for a new chat shows it, as the one on top does for this device. */
const onStartPage = computed(
  () => shown.device === props.device.id && !(ui.view === 'chat' && sessions.active) && !['artifacts', 'scheduled'].includes(ui.view),
)
const canStart = computed(() => props.device.state === 'ready' && devices.can(props.device.id, 'prompt'))

/** Gone from the sidebar at once; the toast takes it back, Einstellungen › Geräte later. */
function hide(): void {
  const { id, name } = props.device
  ui.setDeviceHidden(id, true)
  toast(`„${name}“ ausgeblendet`, {
    description: 'Unter Einstellungen › Geräte blendest du es wieder ein.',
    action: { label: 'Rückgängig', onClick: () => ui.setDeviceHidden(id, false) },
  })
}
</script>

<template>
  <section data-list-group class="mt-2 border-t border-sidebar-border pt-1">
    <ContextMenu>
      <ContextMenuTrigger as-child>
        <div class="group/device flex items-center gap-1 rounded-lg pt-1.5 pr-1 pb-1 pl-2">
          <button
            type="button"
            data-list-row
            :aria-expanded="open"
            class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            @click="ui.toggleDevice(device.id)"
          >
            <MonitorIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate text-[0.8rem] font-medium">{{ device.name }}</span>
            <span
              :class="cn('size-1.5 shrink-0 rounded-full', device.online ? 'bg-success' : 'bg-muted-foreground/40')"
              :aria-label="device.online ? 'Verbunden' : 'Nicht verbunden'"
              v-tooltip="device.online ? 'Verbunden' : 'Nicht verbunden'"
            />
            <ChevronRightIcon
              :class="cn('size-3 shrink-0 text-muted-foreground transition-[transform,opacity]', open && 'rotate-90 opacity-0 group-hover/device:opacity-100')"
            />
          </button>
          <Button
            v-if="canStart"
            variant="ghost"
            size="icon-xs"
            :class="onStartPage && 'bg-sidebar-accent'"
            :aria-label="`Neuer Chat auf ${device.name}`"
            :aria-current="onStartPage ? 'page' : undefined"
            v-tooltip="'Neuer Chat'"
            @click="chat.newChat()"
          >
            <SquarePenIcon />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent class="w-56">
        <ContextMenuItem v-if="canStart" @select="chat.newChat()"><SquarePenIcon /> Neuer Chat</ContextMenuItem>
        <ContextMenuItem @select="ui.openSettings('devices', 'devices.list')"><SettingsIcon /> Geräte verwalten …</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem @select="hide"><EyeOffIcon /> Ausblenden</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

    <template v-if="open">
      <SidebarTree v-if="device.state === 'ready'" :now="now" />
      <p v-else-if="device.state === 'loading'" class="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
        <LoaderCircleIcon class="size-3.5 animate-spin" /> Lädt …
      </p>
      <p v-else-if="device.state === 'offline'" class="px-2 py-1 text-xs text-muted-foreground">Nicht verbunden. Die Chats zeigen sich, sobald es online ist.</p>
      <p v-else-if="device.state === 'off'" class="px-2 py-1 text-xs text-muted-foreground">
        „{{ device.name }}“ lässt sich von hier nicht steuern. Freigeben lässt es sich dort unter Einstellungen › Geräte › Fernsteuerung.
      </p>
      <div v-else class="flex flex-col items-start gap-1 px-2 py-1">
        <p class="text-xs text-destructive">{{ device.error || 'Die Chats ließen sich nicht laden.' }}</p>
        <Button variant="ghost" size="xs" class="-ml-2" @click="devices.load(device.id)"><RotateCwIcon /> Erneut versuchen</Button>
      </div>
    </template>
  </section>
</template>
