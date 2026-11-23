<script setup lang="ts">
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightLeftIcon,
  BrushCleaningIcon,
  CircleStopIcon,
  CopyIcon,
  FileDownIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitForkIcon,
  PanelLeftIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SearchIcon,
  SeparatorHorizontalIcon,
  SettingsIcon,
  SparklesIcon,
  SquarePenIcon,
  Trash2Icon,
} from '@lucide/vue'
import { computed } from 'vue'
import { PROVIDERS } from '@shared/providers'
import type { SessionUpdateInput } from '@shared/types'
import AccountDot from '@/components/accounts/AccountDot.vue'
import { SETTINGS_ICONS } from '@/components/settings/settings-icons'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'
import { useChatActions } from '@/composables/useChatActions'
import { SETTINGS } from '@/composables/useSettingsSearch'
import { attempt } from '@/lib/errors'
import type { SettingsEntry } from '@/lib/settings-index'
import { useAccountsStore } from '@/stores/accounts'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import PaletteInput from './PaletteInput.vue'

/** The commands mode of the quick open (`>`), like VS Code's command palette. */
const query = defineModel<string>('query', { required: true })
/** `keepFocus`: the action put the keyboard somewhere the closing dialog mustn't take it from. */
const emit = defineEmits<{ done: [keepFocus: boolean] }>()

const accounts = useAccountsStore()
const projects = useProjectsStore()
const providers = useProvidersStore()
const sessions = useSessionsStore()
const settings = useSettingsStore()
const ui = useUiStore()
const chat = useChatActions()

/** Closes the quick open first, so the keyboard is back in the window before the action runs. */
function run(action: () => unknown, keepFocus = false): void {
  emit('done', keepFocus)
  void action()
}

async function addProject(): Promise<void> {
  const path = await window.api.app.pickDirectory(settings.settings.defaults.projectsFolder || undefined)
  if (!path) return
  const project = await attempt(() => projects.create({ path }), 'Projekt ließ sich nicht anlegen')
  if (project) chat.newChat(project.id)
}

async function newSection(): Promise<void> {
  const name = await ui.ask({ title: 'Neuer Trenner', input: { placeholder: 'Name, z. B. Kunden' }, confirmText: 'Anlegen' })
  if (name) await attempt(() => projects.createSection({ name }), 'Trenner ließ sich nicht anlegen')
}

/**
 * Like VS Code's Reload Window: loads the page anew, e.g. when it draws something wrong. The CLIs run
 * in the main process and keep going; the chats show again with what they did meanwhile.
 */
function reloadWindow(): void {
  location.reload()
}

/** The settings scroll to the card or row; a row's control gets the keyboard. */
function openSetting(entry: SettingsEntry): void {
  run(() => ui.openSettings(entry.tab, entry.id), true)
}

/** The chat on screen, for the commands of that chat. */
const meta = computed(() => (ui.view === 'chat' ? sessions.active : null))
const runtime = computed(() => (meta.value ? sessions.runtime(meta.value.id) : null))
const busy = computed(() => runtime.value?.status === 'running' || runtime.value?.status === 'starting' || runtime.value?.status === 'waiting')

function update(patch: SessionUpdateInput): void {
  const id = meta.value?.id
  if (id) void attempt(() => sessions.update(id, patch), 'Ändern fehlgeschlagen')
}

function openFolder(): void {
  const cwd = sessions.cwdOf(meta.value)
  if (cwd) void attempt(() => window.api.app.openPath(cwd), 'Ordner ließ sich nicht öffnen')
}

/** Every account of the CLIs that are on, but the one the chat runs with: the chat can go on with it. */
const switchChoices = computed(() => {
  const current = meta.value ? accounts.sessionAccount(meta.value) : null
  const several = providers.available.length > 1
  return providers.available.flatMap((provider) =>
    accounts
      .ofProvider(provider)
      .filter((account) => account.id !== current)
      .map((account) => ({ account, label: several ? `${PROVIDERS[provider].short} · ${account.name}` : account.name })),
  )
})
</script>

<template>
  <Command class="rounded-none! p-0">
    <PaletteInput v-model="query" placeholder="Befehl eingeben…" hint="Strg+Umschalt+P" />
    <CommandList class="max-h-[min(30rem,calc(80vh-6rem))] p-1.5">
      <CommandEmpty>Kein Befehl passt.</CommandEmpty>

      <CommandGroup heading="Aktionen">
        <CommandItem value="new-chat" filter-text="Neuer Chat Startseite" @select="run(() => chat.newChat())">
          <SquarePenIcon />
          Neuer Chat
        </CommandItem>
        <CommandItem value="add-project" filter-text="Projekt hinzufügen Ordner öffnen anlegen" @select="run(addProject)">
          <FolderPlusIcon />
          Projekt hinzufügen…
        </CommandItem>
        <CommandItem value="new-section" filter-text="Neuer Trenner Abschnitt Gruppe Workspace Seitenleiste" @select="run(newSection, true)">
          <SeparatorHorizontalIcon />
          Neuer Trenner…
        </CommandItem>
        <CommandItem
          value="cleanup-chats"
          filter-text="Chats aufräumen löschen alte große Speicherplatz Transkripte Papierkorb mehrere"
          @select="run(() => (ui.cleanupProject = null), true)"
        >
          <BrushCleaningIcon />
          Chats aufräumen…
        </CommandItem>
        <CommandItem value="toggle-sidebar" filter-text="Seitenleiste ein- ausblenden Sidebar Projekte" @select="run(() => ui.toggleSidebar())">
          <PanelLeftIcon />
          {{ ui.sidebarOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden' }}
        </CommandItem>
        <CommandItem value="refresh-usage" filter-text="Usage aktualisieren Limits Verbrauch CLIs neu suchen" @select="run(() => providers.refresh())">
          <RefreshCwIcon />
          Usage aktualisieren
        </CommandItem>
        <CommandItem value="settings" filter-text="Einstellungen öffnen Optionen" @select="run(() => ui.openSettings(), true)">
          <SettingsIcon />
          Einstellungen
          <CommandShortcut>Strg+,</CommandShortcut>
        </CommandItem>
        <CommandItem value="updates" filter-text="Updates und Versionshinweise neue Version Changelog" @select="run(() => ui.openSettings('updates'), true)">
          <SparklesIcon />
          Updates und Versionshinweise
        </CommandItem>
        <CommandItem
          value="reload-window"
          filter-text="Fenster neu laden Reload Window neu rendern neu zeichnen Entwickler Developer"
          @select="run(reloadWindow)"
        >
          <RotateCwIcon />
          Fenster neu laden
        </CommandItem>
      </CommandGroup>

      <template v-if="meta">
        <CommandSeparator />
        <CommandGroup :heading="`Chat „${meta.title}“`">
          <CommandItem value="chat-rename" filter-text="Chat umbenennen Name Titel" @select="run(() => chat.rename(meta!), true)">
            <PencilIcon />
            Chat umbenennen…
          </CommandItem>
          <CommandItem
            v-if="ui.view === 'chat'"
            value="chat-find"
            filter-text="Im Chat suchen finden Suche Text Strg+F find"
            @select="run(() => ui.findInChat(), true)"
          >
            <SearchIcon />
            Im Chat suchen
            <CommandShortcut>Strg+F</CommandShortcut>
          </CommandItem>
          <CommandItem value="chat-pin" filter-text="Chat anheften lösen oben halten" @select="run(() => update({ pinned: !meta!.pinned }))">
            <PinOffIcon v-if="meta.pinned" />
            <PinIcon v-else />
            {{ meta.pinned ? 'Chat lösen' : 'Chat anheften' }}
          </CommandItem>
          <CommandItem value="chat-archive" filter-text="Chat archivieren wiederherstellen Archiv" @select="run(() => update({ archived: !meta!.archived }))">
            <ArchiveRestoreIcon v-if="meta.archived" />
            <ArchiveIcon v-else />
            {{ meta.archived ? 'Aus dem Archiv holen' : 'Chat archivieren' }}
          </CommandItem>
          <CommandItem v-if="busy" value="chat-interrupt" filter-text="Abbrechen stoppen anhalten Antwort Turn" @select="run(() => sessions.interrupt(meta!.id))">
            <CircleStopIcon />
            Antwort abbrechen
          </CommandItem>
          <CommandItem
            v-if="runtime?.connected"
            value="chat-stop"
            filter-text="CLI beenden Prozess stoppen Claude Codex neu starten"
            @select="run(() => sessions.stop(meta!.id))"
          >
            <PowerIcon />
            CLI des Chats beenden
          </CommandItem>
          <CommandItem value="chat-folder" filter-text="Ordner des Chats öffnen Explorer Projektordner" @select="run(openFolder)">
            <FolderOpenIcon />
            Ordner öffnen
          </CommandItem>
          <CommandItem v-if="!busy" value="chat-fork" filter-text="Chat abzweigen Abzweig fork branch kopieren verzweigen" @select="run(() => chat.fork(meta!.id))">
            <GitForkIcon />
            Chat abzweigen
          </CommandItem>
          <CommandItem value="chat-copy-answer" filter-text="Letzte Antwort kopieren Zwischenablage copy" @select="run(() => chat.copyLastAnswer(meta!.id))">
            <CopyIcon />
            Letzte Antwort kopieren
          </CommandItem>
          <CommandItem value="chat-export" filter-text="Chat als Markdown speichern exportieren Export Datei" @select="run(() => chat.exportMarkdown(meta!.id))">
            <FileDownIcon />
            Als Markdown speichern …
          </CommandItem>
          <CommandItem
            v-for="choice in switchChoices"
            :key="choice.account.id"
            :value="`chat-switch-${choice.account.id}`"
            :filter-text="`Weiter mit ${choice.label} Account wechseln CLI wechseln ${PROVIDERS[choice.account.provider].name}`"
            @select="run(() => update({ account: choice.account.id }))"
          >
            <ArrowRightLeftIcon />
            <span class="min-w-0 truncate">Weiter mit „{{ choice.label }}“</span>
            <CommandShortcut class="tracking-normal"><AccountDot :color="choice.account.color" /></CommandShortcut>
          </CommandItem>
          <CommandItem value="chat-delete" filter-text="Chat löschen entfernen Verlauf Transkript Papierkorb" @select="run(() => chat.remove(meta!))">
            <Trash2Icon />
            Chat löschen
          </CommandItem>
        </CommandGroup>
      </template>

      <!-- Every card and row of the settings, only while searching: too many to list otherwise. -->
      <CommandGroup heading="Einstellungen" search-only>
        <CommandItem
          v-for="entry in SETTINGS"
          :key="entry.id"
          :value="`setting-${entry.id}`"
          :filter-text="entry.text"
          search-only
          @select="openSetting(entry)"
        >
          <component :is="SETTINGS_ICONS[entry.tab]" />
          <span class="min-w-0 truncate">{{ entry.label }}</span>
          <CommandShortcut class="max-w-[50%] truncate tracking-normal">{{ entry.path.join(' › ') }}</CommandShortcut>
        </CommandItem>
      </CommandGroup>

      <!-- A new chat in every project, only while searching, as in the Claude Manager's recent folders. -->
      <CommandGroup heading="Neuer Chat in Projekt" search-only>
        <CommandItem
          v-for="project in projects.projects"
          :key="project.id"
          :value="`project-${project.id}`"
          :filter-text="`Neuer Chat in ${project.name} ${project.path}`"
          search-only
          @select="run(() => chat.newChat(project.id))"
        >
          <FolderIcon />
          <span class="min-w-0 truncate">Neuer Chat in {{ project.name }}</span>
          <CommandShortcut class="max-w-[45%] truncate tracking-normal">{{ project.path }}</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
</template>
