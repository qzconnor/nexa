<script setup lang="ts">
import { BellRingIcon } from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PUSH_AWAY_MINUTES, SETTING_RANGES } from '@shared/defaults'
import { pushPhones } from '@shared/server-link'
import type { NotificationSettings, NotifyWhen, PushWhen } from '@shared/types'
import SegmentedControl from '@/components/common/SegmentedControl.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { attempt } from '@/lib/errors'
import { isWindows } from '@/lib/platform'
import { useServerLinkStore } from '@/stores/server-link'
import { useSettingsStore } from '@/stores/settings'
import SettingField from './SettingField.vue'
import SettingsSection from './SettingsSection.vue'
import SliderControl from './SliderControl.vue'

const store = useSettingsStore()
const n = computed(() => store.settings.notifications)

function set(patch: Partial<NotificationSettings>): void {
  void attempt(() => store.update({ notifications: patch }), 'Speichern fehlgeschlagen')
}

/** A v-model for one notification setting. */
function bind<K extends keyof NotificationSettings>(key: K) {
  return computed({ get: () => n.value[key], set: (value: NotificationSettings[K]) => set({ [key]: value } as Partial<NotificationSettings>) })
}

const timers: ReturnType<typeof setTimeout>[] = []
/**
 * A slider's v-model that saves once the slider rests: a threshold passed while dragging would
 * otherwise warn about every limit on the way.
 */
function bindRested(key: 'minBusySeconds' | 'nearLimitPercent', index: number) {
  const local = ref(n.value[key])
  watch(
    () => n.value[key],
    (value) => (local.value = value),
  )
  return computed({
    get: () => local.value,
    set: (value: number) => {
      local.value = value
      clearTimeout(timers[index])
      timers[index] = setTimeout(() => set({ [key]: value }), 300)
    },
  })
}
onBeforeUnmount(() => timers.forEach((timer) => clearTimeout(timer)))

const enabled = bind('enabled')
const onDone = bind('onDone')
const minBusySeconds = bindRested('minBusySeconds', 0)
const onInput = bind('onInput')
const onLimit = bind('onLimit')
const onNearLimit = bind('onNearLimit')
const nearLimitPercent = bindRested('nearLimitPercent', 1)
const onLoginLost = bind('onLoginLost')
const fromAgents = bind('fromAgents')
const when = bind('when')
const preview = bind('preview')
const sound = bind('sound')
const flashTaskbar = bind('flashTaskbar')
const push = bind('push')

const off = computed(() => !enabled.value)
const notificationName = isWindows ? 'Windows-Benachrichtigung' : 'Systembenachrichtigung'

const WHEN: { value: NotifyWhen; label: string }[] = [
  { value: 'background', label: 'Im Hintergrund' },
  { value: 'hidden', label: 'Chat nicht offen' },
]
const whenDescription = computed(() =>
  when.value === 'background'
    ? 'Nur, solange du in einem anderen Programm bist oder Nexa minimiert ist.'
    : 'Auch, wenn Nexa vorne ist, aber gerade einen anderen Chat oder die Startseite zeigt.',
)

const PUSH: { value: PushWhen; label: string }[] = [
  { value: 'off', label: 'Aus' },
  { value: 'away', label: 'Wenn du weg bist' },
  { value: 'always', label: 'Immer' },
]
const pushDescription = computed(
  () =>
    ({
      off: 'Benachrichtigungen nur auf diesem Rechner.',
      away: `Wenn der Bildschirm gesperrt ist oder du seit ${PUSH_AWAY_MINUTES} Minuten nichts eingegeben hast.`,
      always: 'Bei jedem Ereignis, auch wenn du am Rechner sitzt.',
    })[push.value],
)

const link = useServerLinkStore()
onMounted(() => void link.load())
/** Whether pushes reach a phone, and if not, what is missing for it. */
const phoneStatus = computed(() => {
  const state = link.state
  if (!state || state.status === 'unpaired') {
    return 'Dafür koppelst du Nexa unter Einstellungen › Geräte mit einem nexa-server und dort dein Handy mit der Web-App.'
  }
  if (!state.devices.some((d) => d.role === 'controller' && !d.self)) {
    return 'Noch kein Handy gekoppelt. Unter Einstellungen › Geräte › „Gerät hinzufügen“ geht das per QR-Code.'
  }
  if (!state.remoteEnabled) return 'Die Fernsteuerung ist aus (Einstellungen › Geräte). Ohne sie bekommen die Handys nichts.'
  const phones = pushPhones(state)
  if (!phones.length) return 'Deine Handys dürfen auf diesem Rechner nichts sehen (Stufe „Aus“ unter Einstellungen › Geräte).'
  return `Geht an ${phones.map((d) => `„${d.name}“`).join(', ')}, sobald dort in der Web-App Benachrichtigungen an sind.`
})

const testing = ref(false)
async function sendTest(): Promise<void> {
  testing.value = true
  await attempt(() => window.api.notifications.test(), 'Benachrichtigung konnte nicht angezeigt werden')
  testing.value = false
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <SettingsSection
      anchor="notifications.main"
      title="Benachrichtigungen"
      description="Hinweise auf Chats, in denen der Agent fertig ist oder dich braucht, und auf Limits und Logins der Accounts. Ein Klick auf die Benachrichtigung öffnet den Chat."
    >
      <SettingField
        anchor="notifications.enabled"
        for="notifications-enabled"
        label="Benachrichtigungen"
        description="Aus: keine Benachrichtigung und kein Blinken. Schnell umschalten geht auch mit der Glocke in der Titelleiste."
      >
        <Switch id="notifications-enabled" v-model="enabled" />
      </SettingField>
      <SettingField anchor="notifications.test" label="Ausprobieren" description="Zeigt eine Beispiel-Benachrichtigung mit den Einstellungen unten.">
        <Button variant="outline" size="sm" :disabled="testing || off" @click="sendTest">
          <Spinner v-if="testing" data-icon="inline-start" />
          <BellRingIcon v-else data-icon="inline-start" />
          Test-Benachrichtigung
        </Button>
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="notifications.events" title="Ereignisse" description="Worauf Nexa hinweist.">
      <SettingField anchor="notifications.onDone" for="notify-done" label="Chat ist fertig" description="Der Agent hat seine Antwort beendet oder ist auf einen Fehler gestoßen.">
        <Switch id="notify-done" v-model="onDone" :disabled="off" />
      </SettingField>
      <SettingField
        anchor="notifications.minBusy"
        for="notify-min-busy"
        label="Erst nach längerer Arbeit"
        description="Schnelle Antworten kommen, während du ohnehin zusiehst; erst wer länger arbeitet, bekommt eine Benachrichtigung."
      >
        <SliderControl
          id="notify-min-busy"
          v-model="minBusySeconds"
          v-bind="SETTING_RANGES['notifications.minBusySeconds']"
          :format="(v) => (v === 0 ? 'immer' : `ab ${v} s`)"
          :disabled="off || !onDone"
        />
      </SettingField>
      <SettingField
        anchor="notifications.onInput"
        for="notify-input"
        label="Agent braucht dich"
        description="Er wartet auf eine Erlaubnis, auf die Antwort auf eine Frage oder auf die Freigabe eines Plans."
      >
        <Switch id="notify-input" v-model="onInput" :disabled="off" />
      </SettingField>
      <SettingField anchor="notifications.onLimit" for="notify-limit" label="Limit erreicht" description="Der Chat ist an einem Nutzungslimit stehen geblieben, mit der Uhrzeit des Resets.">
        <Switch id="notify-limit" v-model="onLimit" :disabled="off" />
      </SettingField>
      <SettingField
        anchor="notifications.onNearLimit"
        for="notify-near-limit"
        label="Limit fast verbraucht"
        description="Ein Limit eines Accounts hat die Schwelle erreicht: einmal je Account und Zeitraum. Ein Klick zeigt den Verbrauch."
      >
        <Switch id="notify-near-limit" v-model="onNearLimit" :disabled="off" />
      </SettingField>
      <SettingField
        anchor="notifications.nearLimitPercent"
        for="notify-near-limit-percent"
        label="Schwelle"
        description="Die Werte kommen mit jeder Abfrage der Limits und aus laufenden Chats."
      >
        <SliderControl
          id="notify-near-limit-percent"
          v-model="nearLimitPercent"
          v-bind="SETTING_RANGES['notifications.nearLimitPercent']"
          :format="(v) => `${v} %`"
          :disabled="off || !onNearLimit"
        />
      </SettingField>
      <SettingField
        anchor="notifications.onLoginLost"
        for="notify-login-lost"
        label="Login abgelaufen"
        description="Der Browser-Login eines Accounts lässt sich nicht mehr erneuern, nur neu anmelden hilft. Einmal je Login, ein Klick zeigt die Accounts."
      >
        <Switch id="notify-login-lost" v-model="onLoginLost" :disabled="off" />
      </SettingField>
      <SettingField
        anchor="notifications.fromAgents"
        for="notify-from-agents"
        label="Von den Agents"
        description="Agents dürfen dich über Nexa benachrichtigen (Werkzeug „notify“), etwa wenn eine geplante Aufgabe etwas gefunden hat. Mit Knöpfen wartet der Agent auf deine Wahl; ein Klick öffnet den Chat."
      >
        <Switch id="notify-from-agents" v-model="fromAgents" :disabled="off" />
      </SettingField>
    </SettingsSection>

    <SettingsSection anchor="notifications.hints" title="Hinweise" description="Wie Nexa auf den Chat hinweist.">
      <SettingField anchor="notifications.when" label="Benachrichtigen, wenn" :description="whenDescription">
        <SegmentedControl v-model="when" :options="WHEN" :disabled="off" aria-label="Benachrichtigen, wenn" />
      </SettingField>
      <SettingField
        anchor="notifications.preview"
        for="notify-preview"
        label="Vorschau"
        :description="`Die ${notificationName} zeigt den Anfang der Antwort, den Befehl, der auf deine Erlaubnis wartet, oder die Frage. Aus: nur was passiert ist und der Chat.`"
      >
        <Switch id="notify-preview" v-model="preview" :disabled="off" />
      </SettingField>
      <SettingField anchor="notifications.sound" for="notify-sound" label="Ton" description="Der Benachrichtigungston des Systems.">
        <Switch id="notify-sound" v-model="sound" :disabled="off" />
      </SettingField>
      <SettingField
        anchor="notifications.flash"
        for="notify-flash"
        :label="isWindows ? 'Taskleiste blinkt' : 'Fenster in der Taskleiste markieren'"
        description="Nur, wenn Nexa im Hintergrund ist, und bis du das Fenster nach vorne holst."
      >
        <Switch id="notify-flash" v-model="flashTaskbar" :disabled="off" />
      </SettingField>
    </SettingsSection>

    <SettingsSection
      anchor="notifications.phone"
      title="Aufs Handy"
      description="Dieselben Benachrichtigungen über deinen nexa-server an die Web-App auf dem Handy, Ende-zu-Ende verschlüsselt. Die Ereignisse und die Vorschau oben gelten auch hier; ein Tipp öffnet den Chat."
    >
      <SettingField anchor="notifications.push" label="Aufs Handy schicken" :description="pushDescription">
        <SegmentedControl v-model="push" :options="PUSH" :disabled="off" aria-label="Aufs Handy schicken" />
      </SettingField>
      <p class="text-xs text-muted-foreground">{{ phoneStatus }}</p>
    </SettingsSection>
  </div>
</template>
