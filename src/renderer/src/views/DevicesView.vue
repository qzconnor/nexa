<script setup lang="ts">
import { MessageSquareIcon, MonitorIcon, MonitorSmartphoneIcon, PinIcon, RefreshCwIcon, SettingsIcon, SmartphoneIcon } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { REMOTE_LEVEL_LABELS, remoteChatId, type RemoteSession } from '@shared/remote'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import RemoteChat from '@/components/remote/RemoteChat.vue'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useClock } from '@/composables/useClock'
import { attempt } from '@/lib/errors'
import { formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRemoteStore } from '@/stores/remote'
import { useServerLinkStore } from '@/stores/server-link'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'

/**
 * Page „Geräte“: the chats of the other devices of the namespace (Remote Control). Left the devices and
 * the chats of the picked one, by project; right the open chat. What a device shows and allows, it
 * decides itself (Einstellungen › Geräte › Fernsteuerung there).
 */
const remote = useRemoteStore()
const link = useServerLinkStore()
const sessions = useSessionsStore()
const ui = useUiStore()
const now = useClock(30_000)

const state = computed(() => link.state)
const online = computed(() => state.value?.status === 'online')
/** Devices that showed the namespace's key: only these get and answer requests. */
const devices = computed(() => (state.value?.devices ?? []).filter((d) => !d.self && d.trusted))
const device = computed(() => devices.value.find((d) => d.id === remote.device) ?? null)

onMounted(() => {
  remote.start()
  void link.load().then(() => {
    const pick = remote.device && devices.value.some((d) => d.id === remote.device) ? remote.device : (devices.value.find((d) => d.online) ?? devices.value[0])?.id
    void remote.show(pick ?? null)
  })
})
onBeforeUnmount(() => remote.hide())

// The first device that showed the key while the page was open: show it rather than nothing.
watch(
  () => devices.value[0]?.id,
  (first) => {
    if (first && !device.value) void remote.show((devices.value.find((d) => d.online) ?? devices.value[0]).id)
  },
)

function pick(id: string): void {
  if (id !== remote.device) void remote.show(id)
}

// Back online (this device or the picked one): read it anew, what it shows may be old or missing.
watch(
  () => online.value && !!device.value?.online,
  (reachable, before) => {
    if (reachable && before === false) void remote.reload()
  },
)

interface Group {
  key: string
  title: string
  sessions: RemoteSession[]
}

const groups = computed<Group[]>(() => {
  const chats = remote.host?.chats
  if (!chats) return []
  const pinned = chats.sessions.filter((s) => s.pinned)
  const result: Group[] = pinned.length ? [{ key: 'pinned', title: 'Angeheftet', sessions: pinned }] : []
  for (const project of chats.projects) {
    const list = chats.sessions.filter((s) => s.projectId === project.id && !s.pinned)
    if (list.length) result.push({ key: project.id, title: project.section ? `${project.section} › ${project.name}` : project.name, sessions: list })
  }
  return result
})

function statusOf(session: RemoteSession): 'running' | 'waiting' | null {
  const status = remote.device ? sessions.runtime(remoteChatId(remote.device, session.id)).status : 'idle'
  if (status === 'waiting') return 'waiting'
  return status === 'running' || status === 'starting' ? 'running' : null
}

function open(session: RemoteSession): void {
  void attempt(() => remote.openChat(session.id), 'Chat ließ sich nicht öffnen')
}

/** Why the picked device shows no chats, for the user; null while it does (or is loading). */
const blocked = computed(() => {
  const d = device.value
  if (!d) return null
  if (!online.value) return 'Dieses Gerät ist nicht mit dem Server verbunden.'
  if (!d.online) return `„${d.name}“ ist gerade nicht verbunden. Sobald es online ist, erscheinen seine Chats hier.`
  const host = remote.host
  if (host?.error) return host.error
  if (!host?.info) return null
  if (!host.info.enabled) return `Auf „${d.name}“ ist die Fernsteuerung aus. Schalte sie dort unter Einstellungen › Geräte › Fernsteuerung ein.`
  if (host.info.level === 'off') return `„${d.name}“ lässt dieses Gerät nichts sehen. Das änderst du dort unter Einstellungen › Geräte › Fernsteuerung.`
  return null
})
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <Empty v-if="state && state.status === 'unpaired'" class="m-auto max-w-md">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MonitorSmartphoneIcon /></EmptyMedia>
        <EmptyTitle>Kein Server gekoppelt</EmptyTitle>
        <EmptyDescription>Mit einem eigenen nexa-server siehst und steuerst du hier die Chats deiner anderen Rechner.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" @click="ui.openSettings('devices')"><SettingsIcon data-icon="inline-start" /> Einstellungen › Geräte</Button>
      </EmptyContent>
    </Empty>

    <Empty v-else-if="state && !devices.length" class="m-auto max-w-md">
      <EmptyHeader>
        <EmptyMedia variant="icon"><MonitorSmartphoneIcon /></EmptyMedia>
        <EmptyTitle>Noch kein anderes Gerät</EmptyTitle>
        <EmptyDescription>Kopple einen weiteren Rechner unter Einstellungen › Geräte › „Gerät hinzufügen“. Sobald er sich ausgewiesen hat, steht er hier.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" @click="ui.openSettings('devices')"><SettingsIcon data-icon="inline-start" /> Einstellungen › Geräte</Button>
      </EmptyContent>
    </Empty>

    <template v-else-if="state">
      <aside class="flex w-72 shrink-0 flex-col border-r">
        <div class="flex flex-col gap-1 border-b p-2">
          <button
            v-for="d in devices"
            :key="d.id"
            type="button"
            :aria-current="d.id === remote.device ? 'page' : undefined"
            :class="cn('flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60', d.id === remote.device && 'bg-accent')"
            @click="pick(d.id)"
          >
            <span class="relative shrink-0 text-muted-foreground">
              <component :is="d.role === 'host' ? MonitorIcon : SmartphoneIcon" class="size-4" />
              <span v-if="d.online" class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-success ring-2 ring-background" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1 truncate">{{ d.name }}</span>
            <span v-if="!d.online" class="shrink-0 text-[0.7rem] text-muted-foreground">offline</span>
          </button>
        </div>

        <div v-if="device" class="flex items-center gap-2 px-4 pt-3 pb-1 text-xs text-muted-foreground">
          <span class="min-w-0 flex-1 truncate">{{ remote.host?.info ? REMOTE_LEVEL_LABELS[remote.level] : '' }}</span>
          <Button variant="ghost" size="icon-xs" aria-label="Neu laden" v-tooltip="'Neu laden'" :disabled="remote.host?.loading" @click="remote.reload()">
            <RefreshCwIcon :class="cn(remote.host?.loading && 'animate-spin')" />
          </Button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <p v-if="blocked" class="selectable m-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{{ blocked }}</p>
          <div v-else-if="remote.host?.loading && !remote.host.chats" class="flex flex-col gap-2 p-2">
            <Skeleton v-for="i in 6" :key="i" class="h-7 w-full" />
          </div>
          <p v-else-if="remote.host?.chats && !groups.length" class="m-2 text-xs text-muted-foreground">Dort gibt es noch keine Chats.</p>
          <section v-for="group in groups" v-else :key="group.key" class="mt-2">
            <h3 class="flex items-center gap-1.5 truncate px-2.5 py-1 text-[0.7rem] font-medium text-muted-foreground">
              <PinIcon v-if="group.key === 'pinned'" class="size-3" />
              {{ group.title }}
            </h3>
            <button
              v-for="s in group.sessions"
              :key="s.id"
              type="button"
              :aria-current="s.id === remote.chatId ? 'page' : undefined"
              :class="cn('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60', s.id === remote.chatId && 'bg-accent')"
              :title="s.preview || s.title"
              @click="open(s)"
            >
              <ProviderIcon :provider="s.provider" class="size-3.5 shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ s.title }}</span>
              <span v-if="statusOf(s) === 'waiting'" class="size-1.5 shrink-0 rounded-full bg-warning" v-tooltip="'Wartet auf eine Antwort'" />
              <span v-else-if="statusOf(s) === 'running'" class="size-1.5 shrink-0 animate-pulse rounded-full bg-(--tool-run)" v-tooltip="'Arbeitet'" />
              <span v-else class="shrink-0 text-[0.7rem] text-muted-foreground tabular-nums">{{ formatRelative(s.updatedAt, now) }}</span>
            </button>
          </section>
        </div>
      </aside>

      <RemoteChat v-if="remote.openId && device && !blocked" :key="remote.openId" :device-name="device.name" />
      <Empty v-else class="m-auto max-w-md">
        <EmptyHeader>
          <EmptyMedia variant="icon"><MessageSquareIcon /></EmptyMedia>
          <EmptyTitle>{{ device ? `Chats auf „${device.name}“` : 'Geräte' }}</EmptyTitle>
          <EmptyDescription>Wähle links einen Chat. Was du hier siehst und tun darfst, legst du auf dem anderen Gerät fest.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </template>
  </div>
</template>
