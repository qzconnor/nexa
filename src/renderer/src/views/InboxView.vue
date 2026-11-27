<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, HandIcon, InboxIcon, LoaderCircleIcon } from '@lucide/vue'
import { computed, type Component } from 'vue'
import type { InboxSection } from '@shared/inbox'
import InboxEntryRow from '@/components/inbox/InboxEntryRow.vue'
import DeviceScope from '@/components/layout/DeviceScope.vue'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useClock } from '@/composables/useClock'
import { useDevicesStore } from '@/stores/devices'
import { useInboxStore } from '@/stores/inbox'

/**
 * What needs the user, on this device and every other one loaded here, as the PWA's inbox: questions
 * to answer right here, what failed or stopped at a limit, finished turns not read yet, what works.
 */
const inbox = useInboxStore()
const devices = useDevicesStore()
const now = useClock(60_000)

/** The colours of a chat's marks in the sidebar. */
const SECTIONS: Record<InboxSection, { title: string; icon: Component; tone: string }> = {
  waiting: { title: 'Wartet auf dich', icon: HandIcon, tone: 'text-warning' },
  trouble: { title: 'Fehler und Limit', icon: CircleAlertIcon, tone: 'text-destructive' },
  unread: { title: 'Fertig, ungelesen', icon: CircleCheckIcon, tone: 'text-primary' },
  running: { title: 'Läuft gerade', icon: LoaderCircleIcon, tone: 'text-muted-foreground' },
}

/** With chats of several devices each row names its device. */
const many = computed(() => new Set(inbox.rows.map((r) => r.device)).size > 1)
const deviceName = (device: string | null) => (device ? devices.devices.find((d) => d.id === device)?.name : 'Dieses Gerät')
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-8">
      <header class="flex flex-col gap-1">
        <h1 class="text-xl font-semibold tracking-tight">Posteingang</h1>
        <p class="text-sm text-muted-foreground">Was in deinen Chats auf dich wartet. Rückfragen beantwortest du gleich hier.</p>
      </header>

      <div v-if="!inbox.loaded" class="flex flex-col divide-y rounded-xl border">
        <div v-for="i in 3" :key="i" class="flex items-center gap-3 px-4 py-3.5">
          <Skeleton class="size-8 rounded-lg" />
          <div class="flex flex-1 flex-col gap-2">
            <Skeleton class="h-4 w-1/3" />
            <Skeleton class="h-3 w-1/2" />
          </div>
        </div>
      </div>

      <Empty v-else-if="!inbox.sections.length" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon"><InboxIcon /></EmptyMedia>
          <EmptyTitle>Nichts wartet auf dich</EmptyTitle>
          <EmptyDescription>Was deine Agents fragen, was abbricht und was fertig wird, erscheint hier.</EmptyDescription>
        </EmptyHeader>
      </Empty>

      <template v-else>
        <section v-for="section in inbox.sections" :key="section.id" :aria-labelledby="`inbox-${section.id}`" class="flex flex-col gap-2">
          <h2 :id="`inbox-${section.id}`" class="flex items-center gap-2 px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <component :is="SECTIONS[section.id].icon" :class="['size-4', SECTIONS[section.id].tone]" />
            {{ SECTIONS[section.id].title }}
            <span class="ml-auto font-normal tabular-nums">{{ section.rows.length }}</span>
          </h2>
          <ul class="flex flex-col divide-y overflow-hidden rounded-xl border bg-card/40">
            <DeviceScope v-for="row in section.rows" :key="row.key" :device="row.device">
              <InboxEntryRow :row="row" :now="now" :device-name="many ? deviceName(row.device) : undefined" />
            </DeviceScope>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>
