<script setup lang="ts">
import { ChevronDownIcon, FolderIcon, FolderPlusIcon, RefreshCwIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { PROVIDER_IDS, type PermissionMode, type ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import type { AppSettings, DeepPartial } from '@shared/types'
import AppLogo from '@/components/common/AppLogo.vue'
import Composer from '@/components/chat/Composer.vue'
import ProviderCard from '@/components/home/ProviderCard.vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { useAccountsStore } from '@/stores/accounts'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

/**
 * The start: which CLIs are there (installed, logged in), the project to work in, and the first
 * prompt of a new chat.
 */
const providers = useProvidersStore()
const accounts = useAccountsStore()
const projects = useProjectsStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()

/** A mode the CLI knows: Codex has no "auto", for example. */
function supportedMode(id: ProviderId, value: PermissionMode): PermissionMode {
  return PROVIDERS[id].permissionModes.includes(value) ? value : 'ask'
}

const provider = ref<ProviderId>(settings.settings.defaults.provider)
const model = ref(settings.settings[provider.value].model)
const effort = ref(settings.settings[provider.value].effort)
const mode = ref<PermissionMode>(supportedMode(provider.value, settings.settings.defaults.permissionMode))
const account = ref(accounts.defaultId(provider.value))
const starting = ref(false)

// The default CLI isn't installed but the other one is: take that one (without making it the default).
watch(
  () => providers.installed,
  (installed) => {
    if (installed.length && !installed.includes(provider.value)) provider.value = installed[0]
  },
  { immediate: true },
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
function pickProvider(id: ProviderId): void {
  provider.value = id
  void attempt(() => settings.update({ defaults: { provider: id } }), 'Vorgabe ließ sich nicht speichern')
}

function pickModel(value: string): void {
  model.value = value
  const patch: DeepPartial<AppSettings> = {}
  patch[provider.value] = { model: value }
  void attempt(() => settings.update(patch), 'Vorgabe ließ sich nicht speichern')
}

function pickEffort(value: string): void {
  effort.value = value
  const patch: DeepPartial<AppSettings> = {}
  patch[provider.value] = { effort: value }
  void attempt(() => settings.update(patch), 'Vorgabe ließ sich nicht speichern')
}

function pickMode(value: PermissionMode): void {
  mode.value = value
  void attempt(() => settings.update({ defaults: { permissionMode: value } }), 'Vorgabe ließ sich nicht speichern')
}

function pickAccount(id: string): void {
  account.value = id
  const chosen = accounts.get(id)
  if (chosen) void attempt(() => accounts.setDefault(chosen), 'Vorgabe ließ sich nicht speichern')
}

const project = computed(() => projects.get(ui.homeProjectId) ?? projects.projects[0])
const anyReady = computed(() => providers.installed.length > 0)

async function pickFolder(): Promise<void> {
  const path = await window.api.app.pickDirectory(settings.settings.defaults.projectsFolder || undefined)
  if (!path) return
  const created = await attempt(() => projects.create({ path }), 'Projekt ließ sich nicht anlegen')
  if (created) ui.homeProjectId = created.id
}

async function start(input: { text: string; images: string[] }): Promise<void> {
  let target = project.value
  if (!target) {
    await pickFolder()
    target = project.value
    if (!target) return
  }
  starting.value = true
  try {
    const meta = await attempt(
      () => sessions.create({ projectId: target.id, provider: provider.value, account: account.value, model: model.value, effort: effort.value, permissionMode: mode.value }),
      'Chat ließ sich nicht anlegen',
    )
    if (!meta) return
    ui.view = 'chat'
    await attempt(() => sessions.send(meta.id, input), 'Senden fehlgeschlagen')
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
    <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-8 px-6 py-10">
      <div class="flex flex-col items-center gap-3 text-center">
        <AppLogo class="size-12" />
        <h1 class="text-2xl font-semibold tracking-tight">Woran arbeiten wir?</h1>
        <p class="text-sm text-muted-foreground">Claude Code und Codex in einer Oberfläche – wechsle mitten im Chat, der Verlauf geht mit.</p>
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="outline" size="sm" class="max-w-full gap-2 bg-card/60">
                <FolderIcon class="text-muted-foreground" />
                <span class="truncate">{{ project?.name ?? 'Projekt wählen' }}</span>
                <span v-if="project" class="hidden truncate text-xs text-muted-foreground sm:inline">{{ project.path }}</span>
                <ChevronDownIcon class="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="max-h-80 w-80 overflow-y-auto">
              <DropdownMenuLabel>Projekt</DropdownMenuLabel>
              <DropdownMenuItem v-for="p in projects.projects" :key="p.id" class="flex-col items-start gap-0" @select="ui.homeProjectId = p.id">
                <span>{{ p.name }}</span>
                <span class="max-w-full truncate text-xs text-muted-foreground">{{ p.path }}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator v-if="projects.projects.length" />
              <DropdownMenuItem @select="pickFolder"><FolderPlusIcon /> Ordner wählen …</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Spinner v-if="starting" class="size-4 text-muted-foreground" />
        </div>
        <Composer
          :provider="provider"
          :account="account"
          :model="model"
          :effort="effort"
          :mode="mode"
          @update:provider="pickProvider"
          @update:account="pickAccount"
          @update:model="pickModel"
          @update:effort="pickEffort"
          @update:mode="pickMode"
          :disabled="!anyReady || starting"
          autofocus
          @send="start"
        />
        <p v-if="!project" class="text-xs text-muted-foreground">Mit dem ersten Prompt fragt Nexa nach dem Ordner, in dem gearbeitet wird.</p>
      </div>

      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-medium text-muted-foreground">Installierte CLIs</h2>
          <Button variant="ghost" size="xs" :disabled="providers.detecting" @click="providers.refresh()">
            <Spinner v-if="providers.detecting" />
            <RefreshCwIcon v-else />
            Erneut prüfen
          </Button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <ProviderCard v-for="id in PROVIDER_IDS" :key="id" :provider="id" compact />
        </div>
      </div>
    </div>
  </div>
</template>
