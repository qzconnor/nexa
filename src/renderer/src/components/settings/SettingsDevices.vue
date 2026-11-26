<script setup lang="ts">
import {
  CheckIcon,
  ClockAlertIcon,
  CopyIcon,
  EllipsisIcon,
  LogOutIcon,
  MonitorIcon,
  PencilIcon,
  PlusIcon,
  ShieldQuestionIcon,
  SmartphoneIcon,
  Trash2Icon,
} from '@lucide/vue'
import { useIntervalFn } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'
import { decodePairingCode, isPairingCode } from '@shared/nexa-server/pairing-code'
import { CLOCK_SKEW_WARN_MS, type DeviceInvite, type LinkedDevice, type ServerLinkState } from '@shared/server-link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { attempt, errorMessage } from '@/lib/errors'
import { formatClock, formatRelative, formatSpan } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useServerLinkStore } from '@/stores/server-link'
import { useUiStore } from '@/stores/ui'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'

/**
 * Einstellungen › Geräte: pairing with a nexa-server, the connection, and the devices of the namespace.
 * Unpaired the page is a form; paired it shows the connection and the list.
 */
const link = useServerLinkStore()
const ui = useUiStore()
// The template renders only once the state is loaded (`v-if="link.state"`); slots lose that narrowing.
const state = computed(() => link.state as ServerLinkState)
/** For the countdowns: the next attempt and the pairing code's validity. */
const now = ref(Date.now())
useIntervalFn(() => (now.value = Date.now()), 1000)

onMounted(() => void link.load())

// --- Pairing ---------------------------------------------------------------------------------------

const url = ref('')
const code = ref('')
const name = ref('')
const pairing = ref(false)
const pairError = ref<string | null>(null)
/** A pairing code holds the server's address: the field shows it and can't be changed. */
const codeUrl = computed(() => (isPairingCode(code.value) ? (decodePairingCode(code.value)?.url ?? '') : null))

async function pair(): Promise<void> {
  pairing.value = true
  pairError.value = null
  try {
    await link.pair({ url: url.value, code: code.value, name: name.value.trim() || (state.value?.defaultName ?? '') })
    url.value = code.value = name.value = ''
  } catch (error) {
    pairError.value = errorMessage(error)
  } finally {
    pairing.value = false
  }
}

// --- Connection ------------------------------------------------------------------------------------

const status = computed(() => {
  const s = state.value
  switch (s?.status) {
    case 'connecting':
      return { tone: 'bg-warning animate-pulse', text: 'Verbinde …' }
    case 'online':
      return { tone: 'bg-success', text: 'Verbunden' }
    case 'offline': {
      const wait = s.retryAt ? Math.max(0, Math.round((s.retryAt - now.value) / 1000)) : null
      return { tone: 'bg-destructive', text: wait === null ? 'Keine Verbindung' : `Keine Verbindung, neuer Versuch in ${wait} s` }
    }
    case 'paused':
      return { tone: 'bg-muted-foreground', text: 'Getrennt. Nexa verbindet sich erst wieder, wenn du es sagst.' }
    default:
      return { tone: 'bg-destructive', text: 'Angehalten' }
  }
})
const connected = computed(() => state.value?.status === 'online' || state.value?.status === 'connecting')

function clockOff(skew: number | null): skew is number {
  return skew !== null && Math.abs(skew) >= CLOCK_SKEW_WARN_MS
}

/** „7 Minuten vor“, „1 Stunde nach“. */
function skewText(skew: number): string {
  const minutes = Math.round(Math.abs(skew) / 60_000)
  const hours = Math.round(minutes / 60)
  const days = Math.round(hours / 24)
  const span =
    minutes < 90 ? `${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}` : hours < 48 ? `${hours} Stunden` : `${days} Tage`
  return `${span} ${skew > 0 ? 'vor' : 'nach'}`
}

const clockWarning = computed(() => (clockOff(state.value.clockSkew) ? skewText(state.value.clockSkew) : null))

async function unpair(): Promise<void> {
  const online = state.value?.status === 'online'
  const ok = await ui.confirm({
    title: 'Dieses Gerät abmelden?',
    description: online
      ? 'Nexa entfernt das Gerät beim Server und vergisst Server und Schlüssel. Um es wieder zu verbinden, koppelst du es neu.'
      : 'Der Server ist gerade nicht erreichbar. Nexa vergisst Server und Schlüssel trotzdem; bei den anderen Geräten steht dieses noch in der Liste, bis du es dort entfernst.',
    confirmText: 'Abmelden',
    destructive: true,
  })
  if (ok) await attempt(() => link.unpair(), 'Abmelden fehlgeschlagen')
}

// --- Devices ---------------------------------------------------------------------------------------

const invite = ref<DeviceInvite | null>(null)
const inviting = ref(false)
const copied = ref(false)
const inviteLeft = computed(() => (invite.value ? invite.value.expiresAt - now.value : 0))
/** The devices there when the code was made: a new one that shows the namespace's key used it. */
let devicesBefore = new Set<string>()
const joined = computed(() => (invite.value ? state.value.devices.find((d) => d.trusted && !devicesBefore.has(d.id)) : undefined))

async function addDevice(): Promise<void> {
  inviting.value = true
  devicesBefore = new Set(state.value.devices.map((d) => d.id))
  invite.value = (await attempt(() => link.invite(), 'Kein Kopplungscode')) ?? null
  inviting.value = false
}

function copyInvite(): void {
  if (!invite.value) return
  void navigator.clipboard.writeText(invite.value.code)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

function describe(device: LinkedDevice): string {
  const role = device.role === 'host' ? 'Rechner' : 'Steuerung'
  if (device.self) return `${role} · ${connected.value ? 'dieses Gerät' : 'dieses Gerät, nicht verbunden'}`
  if (device.online) return `${role} · online`
  if (state.value?.status !== 'online') return role
  return device.lastSeen ? `${role} · zuletzt online ${formatRelative(device.lastSeen, now.value)}` : `${role} · noch nie verbunden`
}

const UNTRUSTED_HINT =
  'Hat sich noch nicht mit dem Schlüssel des Namespace ausgewiesen. Ein neu gekoppeltes Gerät tut das, sobald es verbunden ist, und Nexa fragt immer wieder nach. Bleibt es dabei, kennst du es vermutlich nicht: Entferne es.'

/** Why a device isn't trusted, as far as its last hello tells: a line under its name and the badge's tooltip. */
function issueOf(device: LinkedDevice): { short: string; long: string } | null {
  const issue = device.issue
  if (!issue) return null
  if (issue.kind === 'key') {
    return {
      short: 'Anderer Schlüssel',
      long: `„${device.name}“ hat sich mit einem Schlüssel gemeldet, den dieses Gerät nicht hat. Wurde es mit dem Einladungscode des Servers statt mit einem Kopplungscode aus „Gerät hinzufügen“ gekoppelt? Dann melde es dort ab und kopple es mit einem neuen Kopplungscode.`,
    }
  }
  if (clockOff(issue.skew)) {
    return {
      short: `Seine Uhr geht ${skewText(issue.skew)}`,
      long: `Die Uhr von „${device.name}“ geht ${skewText(issue.skew)}. Geräte nehmen Nachrichten nur an, wenn ihre Uhren höchstens 5 Minuten auseinanderliegen. Schalte dort in den Windows-Einstellungen unter „Zeit und Sprache“ die Option „Uhrzeit automatisch festlegen“ ein; danach bestätigen sich die Geräte von selbst.`,
    }
  }
  return {
    short: 'Die Uhr dieses Geräts geht falsch',
    long: `Die Uhren dieses Geräts und von „${device.name}“ liegen mehr als 5 Minuten auseinander, und es liegt an diesem Gerät (siehe „Verbindung“).`,
  }
}

async function rename(device: LinkedDevice): Promise<void> {
  const next = await ui.ask({ title: 'Gerät umbenennen', input: { value: device.name }, confirmText: 'Umbenennen' })
  if (next && next !== device.name) await attempt(() => link.rename(device.self ? null : device.id, next), 'Umbenennen fehlgeschlagen')
}

async function remove(device: LinkedDevice): Promise<void> {
  const ok = await ui.confirm({
    title: `„${device.name}“ entfernen?`,
    description:
      'Der Server trennt das Gerät, und es muss neu gekoppelt werden. Die übrigen Geräte wechseln danach den Schlüssel des Namespace, damit es nichts mehr mitlesen kann.',
    confirmText: 'Entfernen',
    destructive: true,
  })
  if (ok) await attempt(() => link.remove(device.id), 'Entfernen fehlgeschlagen')
}
</script>

<template>
  <div v-if="link.state" class="flex flex-col gap-4">
    <!-- Unpaired: the form. -->
    <SettingsSection
      v-if="state.status === 'unpaired'"
      anchor="devices.server"
      title="Mit nexa-server koppeln"
      description="Ein eigener Server verbindet deine Geräte, damit eins das andere steuern kann. Er leitet nur weiter und sieht keine Inhalte: Die Geräte verschlüsseln selbst."
    >
      <p v-if="state.error" class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{{ state.error }}</p>
      <SettingField
        anchor="devices.code"
        label="Code"
        for="server-link-code"
        description="Fürs erste Gerät der Einladungscode des Servers („nexa-server namespace create …“), für jedes weitere der Kopplungscode, den ein gekoppeltes Gerät unter „Gerät hinzufügen“ zeigt."
      >
        <Input id="server-link-code" v-model="code" class="h-8 w-72 font-mono text-xs" placeholder="XXXX-XXXX-… oder nexa1:…" autocomplete="off" spellcheck="false" />
      </SettingField>
      <SettingField anchor="devices.url" label="Adresse des Servers" for="server-link-url" :description="codeUrl !== null ? 'Steht im Kopplungscode.' : undefined">
        <Input
          id="server-link-url"
          :model-value="codeUrl ?? url"
          :disabled="codeUrl !== null"
          class="h-8 w-72"
          placeholder="https://nexa.example.com"
          autocomplete="off"
          spellcheck="false"
          @update:model-value="(v: string | number) => (url = String(v))"
        />
      </SettingField>
      <SettingField anchor="devices.name" label="Name dieses Geräts" for="server-link-name" description="So steht es in der Liste der anderen Geräte.">
        <Input id="server-link-name" v-model="name" class="h-8 w-72" :placeholder="state.defaultName" maxlength="64" />
      </SettingField>
      <div class="flex items-center justify-end gap-3">
        <p v-if="pairError" class="min-w-0 flex-1 text-xs text-destructive">{{ pairError }}</p>
        <Button :disabled="pairing || !code.trim()" @click="pair">
          <Spinner v-if="pairing" data-icon="inline-start" />
          Koppeln
        </Button>
      </div>
    </SettingsSection>

    <template v-else>
      <SettingsSection anchor="devices.server" title="Verbindung" :description="`${state.url} · Namespace „${state.namespace}“`">
        <template #actions>
          <template v-if="!state.locked">
            <Button v-if="connected" variant="ghost" size="sm" @click="link.disconnect()">Trennen</Button>
            <Button v-else variant="outline" size="sm" @click="link.connect()">{{ state.status === 'offline' ? 'Jetzt verbinden' : 'Verbinden' }}</Button>
          </template>
          <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="unpair">
            <LogOutIcon data-icon="inline-start" />
            Abmelden
          </Button>
        </template>
        <div class="flex items-center gap-2 text-sm">
          <span :class="cn('size-2 shrink-0 rounded-full', status.tone)" />
          {{ status.text }}
        </div>
        <p v-if="state.error" class="text-xs text-destructive">{{ state.error }}</p>
        <p v-if="clockWarning" class="flex gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
          <ClockAlertIcon class="mt-px size-3.5 shrink-0" />
          <span>
            Die Uhr dieses Geräts geht {{ clockWarning }}. Andere Geräte nehmen seine Nachrichten dann nicht an. Schalte in den
            Windows-Einstellungen unter „Zeit und Sprache“ die Option „Uhrzeit automatisch festlegen“ ein; Nexa merkt es von selbst.
          </span>
        </p>
      </SettingsSection>

      <SettingsSection
        anchor="devices.list"
        title="Geräte"
        description="Alle Geräte deines Namespace. Nexa schickt nur denen etwas, die sich mit dem Schlüssel des Namespace ausgewiesen haben."
      >
        <template #actions>
          <Button variant="outline" size="sm" :disabled="state.status !== 'online' || inviting" @click="addDevice">
            <Spinner v-if="inviting" data-icon="inline-start" />
            <PlusIcon v-else data-icon="inline-start" />
            Gerät hinzufügen
          </Button>
        </template>

        <div v-if="invite" class="flex flex-col gap-2 rounded-lg border bg-background/40 p-3 text-sm">
          <p v-if="joined" class="flex items-center gap-2">
            <CheckIcon class="size-4 shrink-0 text-success" />
            „{{ joined.name }}“ ist gekoppelt.
          </p>
          <template v-else-if="inviteLeft > 0">
            <p>
              Füge diesen Kopplungscode auf dem neuen Gerät unter Einstellungen › Geräte ein. Er gilt einmal, bis
              {{ formatClock(invite.expiresAt) }} <span class="whitespace-nowrap">(noch {{ formatSpan(inviteLeft) }}).</span>
            </p>
            <div class="flex items-center gap-1 rounded-md border bg-(--code-bg) py-1 pr-1 pl-2.5">
              <code class="selectable min-w-0 flex-1 truncate font-mono text-xs">{{ invite.code }}</code>
              <Button variant="ghost" size="icon-xs" aria-label="Kopplungscode kopieren" @click="copyInvite">
                <CheckIcon v-if="copied" class="text-success" />
                <CopyIcon v-else />
              </Button>
            </div>
            <p class="text-xs text-muted-foreground">Der Code enthält den Schlüssel deines Namespace. Gib ihn nur auf deinen eigenen Geräten ein.</p>
          </template>
          <p v-else class="text-muted-foreground">Der Kopplungscode ist abgelaufen. Hol dir mit „Gerät hinzufügen“ einen neuen.</p>
          <div class="flex justify-end">
            <Button variant="ghost" size="sm" @click="invite = null">Fertig</Button>
          </div>
        </div>

        <ul class="flex flex-col divide-y">
          <li v-for="device in state.devices" :key="device.id" class="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
            <div class="relative shrink-0 text-muted-foreground">
              <component :is="device.role === 'host' ? MonitorIcon : SmartphoneIcon" class="size-4" />
              <span
                v-if="device.online"
                class="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-success ring-2 ring-card"
                aria-hidden="true"
              />
            </div>
            <div class="flex min-w-0 flex-1 flex-col">
              <div class="flex min-w-0 items-center gap-2 text-sm">
                <span class="truncate font-medium">{{ device.name }}</span>
                <Badge
                  v-if="!device.trusted && !device.self"
                  variant="outline"
                  class="text-warning"
                  v-tooltip="issueOf(device)?.long ?? UNTRUSTED_HINT"
                >
                  <ShieldQuestionIcon data-icon="inline-start" />
                  Nicht bestätigt
                </Badge>
              </div>
              <span class="truncate text-xs text-muted-foreground">
                {{ describe(device) }}
                <span v-if="issueOf(device)" class="text-warning"> · {{ issueOf(device)!.short }}</span>
              </span>
            </div>
            <DropdownMenu v-if="state.status === 'online'">
              <DropdownMenuTrigger as-child>
                <Button variant="ghost" size="icon-xs">
                  <EllipsisIcon />
                  <span class="sr-only">Aktionen für „{{ device.name }}“</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-48">
                <DropdownMenuItem @select="rename(device)"><PencilIcon /> Umbenennen</DropdownMenuItem>
                <template v-if="!device.self">
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" @select="remove(device)"><Trash2Icon /> Entfernen</DropdownMenuItem>
                </template>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ul>
      </SettingsSection>
    </template>
  </div>
</template>
