<script setup lang="ts">
import { MonitorIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { PermissionMode, ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type { AppSettings, DeepPartial } from '@shared/types'
import AppLogo from '@/components/common/AppLogo.vue'
import Composer from '@/components/chat/Composer.vue'
import ProjectPicker from '@/components/common/ProjectPicker.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { andList } from '@/lib/format'
import { provideProjectPath } from '@/composables/useProjectPath'
import { useAccountsStore } from '@/stores/accounts'
import { useDevice, useDeviceApi } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/**
 * The start: the project to work in and the first prompt of a new chat. Which CLIs are there and in
 * use is the setup's and the settings' matter.
 */
const providers = useProvidersStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
/** The start page of another device (Remote Control): its projects, CLIs and defaults; the chat runs there. */
const device = useDevice()
const api = useDeviceApi()
const devices = useDevicesStore()
const deviceName = computed(() => (device ? (devices.devices.find((d) => d.id === device)?.name ?? 'dem anderen Gerät') : null))
/** Its settings change only where it gives this device everything: elsewhere what is picked here stays here. */
const canSaveDefaults = computed(() => devices.can(device, 'full'))
const canStart = computed(() => devices.can(device, 'prompt'))

/** A mode the CLI knows: Codex has no "auto", for example. */
function supportedMode(id: ProviderId, value: PermissionMode): PermissionMode {
  return PROVIDERS[id].permissionModes.includes(value) ? value : 'ask'
}

const provider = ref<ProviderId>(settings.settings.defaults.provider)
const model = ref(settings.settings[provider.value].model)
const effort = ref(settings.settings[provider.value].effort)
const mode = ref<PermissionMode>(supportedMode(provider.value, settings.settings.defaults.permissionMode))
const account = ref(accounts.defaultId(provider.value))
/** Claude's Ultracode for the chat to start; missing: as the CLI's settings say. */
const ultracode = ref<boolean | undefined>(undefined)
const starting = ref(false)

// The default CLI isn't usable but another one is: take that one (without making it the default).
watch(
  () => providers.available,
  (available) => {
    if (available.length && !available.includes(provider.value)) provider.value = available[0]
  },
  { immediate: true },
)
// The default changed elsewhere (a CLI switched off in the settings moves it).
watch(
  () => settings.settings.defaults.provider,
  (id) => (provider.value = id),
)
// Follow the defaults of the chosen CLI, also when the settings dialog changes them.
watch(
  () => settings.settings[provider.value].model,
  (value) => (model.value = value),
)
watch(
  () => settings.settings[provider.value].effort,
  (value) => (effort.value = value),
)
watch(
  () => accounts.defaultId(provider.value),
  (id) => (account.value = id),
)
watch(
  () => [provider.value, settings.settings.defaults.permissionMode] as const,
  ([id, value]) => (mode.value = supportedMode(id, value)),
)

/*
 * What the start page picks becomes the default for new chats: it is what the next chat should start
 * with, and it stays after a restart. Chats keep their own choice in their session.
 */
function saveDefault(patch: DeepPartial<AppSettings>): void {
  if (canSaveDefaults.value) void attempt(() => settings.update(patch), 'Vorgabe ließ sich nicht speichern')
}

function pickProvider(id: ProviderId): void {
  provider.value = id
  saveDefault({ defaults: { provider: id } })
}

function pickModel(value: string): void {
  model.value = value
  const patch: DeepPartial<AppSettings> = {}
  patch[provider.value] = { model: value }
  saveDefault(patch)
}

function pickEffort(value: string): void {
  effort.value = value
  const patch: DeepPartial<AppSettings> = {}
  patch[provider.value] = { effort: value }
  saveDefault(patch)
}

function pickMode(value: PermissionMode): void {
  mode.value = value
  saveDefault({ defaults: { permissionMode: value } })
}

function pickAccount(id: string): void {
  account.value = id
  const chosen = accounts.get(id)
  if (chosen && canSaveDefaults.value) void attempt(() => accounts.setDefault(chosen), 'Vorgabe ließ sich nicht speichern')
}

const project = computed(() => projects.get(ui.homeProjectId) ?? projects.projects[0])
// `@` completes files of the project picked here.
provideProjectPath(computed(() => project.value?.path ?? null))
const anyReady = computed(() => providers.available.length > 0)
/** The switch mid-chat is only worth telling about with more than one CLI on. */
const tagline = computed(() => {
  const names = providers.offered.map((id) => PROVIDERS[id].name)
  return names.length > 1
    ? `${andList(names)} in einer Oberfläche – wechsle mitten im Chat, der Verlauf geht mit.`
    : `${names[0] ?? 'Deine CLI'} in einer eigenen Oberfläche, mit Dateien, Browser und Verlauf.`
})

async function pickFolder(): Promise<void> {
  const path = await window.api.app.pickDirectory(settings.settings.defaults.projectsFolder || undefined)
  if (!path) return
  const created = await attempt(() => projects.create({ path }), 'Projekt ließ sich nicht anlegen')
  if (created) ui.homeProjectId = created.id
}

/** A new chat in the picked project (the folder asked for first when there is none), then `first` in it. */
async function start(first: (id: string) => Promise<unknown>, failed: string): Promise<void> {
  let target = project.value
  // Another device's folders aren't picked from here: it needs a project first (sidebar, on it).
  if (!target && device) return
  if (!target) {
    await pickFolder()
    target = project.value
    if (!target) return
  }
  starting.value = true
  try {
    const meta = await attempt(
      () =>
        sessions.create({
          projectId: target.id,
          provider: provider.value,
          account: account.value,
          model: model.value,
          effort: effort.value,
          permissionMode: mode.value,
          ultracode: provider.value === 'claude' ? ultracode.value : undefined,
        }),
      'Chat ließ sich nicht anlegen',
    )
    if (!meta) return
    ui.view = 'chat'
    await attempt(() => first(meta.id), failed)
  } finally {
    starting.value = false
  }
}

const send = (input: { text: string; images: string[] }) => start((id) => sessions.send(id, input), 'Senden fehlgeschlagen')
// A command first (`!`): the chat begins with it, the first prompt then hands it to the CLI.
const runShell = (command: string) => start((id) => api.sessions.runShell(id, command), 'Befehl ließ sich nicht ausführen')
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-10">
      <div class="flex flex-col items-center gap-3 text-center">
        <AppLogo class="size-12" />
        <h1 class="text-2xl font-semibold tracking-tight">Woran arbeiten wir?</h1>
        <!-- Whose start page this is: the chat runs there, with its folders and CLIs. -->
        <p v-if="deviceName" class="flex items-center gap-1.5 rounded-full border bg-card/60 px-2.5 py-0.5 text-xs text-muted-foreground">
          <MonitorIcon class="size-3.5" /> Auf {{ deviceName }}
        </p>
        <p class="text-sm text-muted-foreground">{{ tagline }}</p>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <ProjectPicker :project="project" @select="(id) => (ui.homeProjectId = id)" @pick-folder="pickFolder" />
          <Spinner v-if="starting" class="size-4 text-muted-foreground" />
        </div>
        <Composer
          :provider="provider"
          :account="account"
          :model="model"
          :effort="effort"
          :mode="mode"
          :ultracode="ultracode"
          @update:provider="pickProvider"
          @update:account="pickAccount"
          @update:model="pickModel"
          @update:effort="pickEffort"
          @update:mode="pickMode"
          @update:ultracode="ultracode = $event"
          :disabled="!anyReady || starting || !canStart || (!project && !!device)"
          autofocus
          @send="send"
          @shell="runShell"
        />
        <p v-if="!canStart" class="text-xs text-muted-foreground">{{ deviceName }} lässt dieses Gerät nur mitlesen: Neue Chats startest du dort.</p>
        <p v-else-if="!project && device" class="text-xs text-muted-foreground">Auf {{ deviceName }} gibt es noch kein Projekt. Leg dort eins an, dann geht es hier weiter.</p>
        <p v-else-if="!project && anyReady" class="text-xs text-muted-foreground">Mit dem ersten Prompt fragt Nexa nach dem Ordner, in dem gearbeitet wird.</p>
        <!-- What the CLIs lack is in the settings; here only that something does. -->
        <div v-if="providers.checked && !anyReady" class="flex items-center gap-3 rounded-xl border border-warning/40 bg-card/60 px-4 py-3 text-sm">
          <TriangleAlertIcon class="size-4 shrink-0 text-warning" />
          <span v-if="device" class="min-w-0 flex-1 text-muted-foreground">Auf {{ deviceName }} ist keine CLI bereit. Dort unter Einstellungen › CLIs steht, was fehlt.</span>
          <template v-else>
            <span class="min-w-0 flex-1 text-muted-foreground">Keine CLI ist bereit. Unter Einstellungen › CLIs siehst du, was fehlt.</span>
            <Button variant="outline" size="sm" @click="ui.openSettings('providers')">Öffnen</Button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
