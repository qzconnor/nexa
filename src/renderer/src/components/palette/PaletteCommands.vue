<script setup lang="ts">
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightLeftIcon,
  BrushCleaningIcon,
  CalendarClockIcon,
  CalendarPlusIcon,
  CircleStopIcon,
  CopyIcon,
  FileDownIcon,
  FileInputIcon,
  FileOutputIcon,
  FolderGit2Icon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitForkIcon,
  HandIcon,
  HistoryIcon,
  InboxIcon,
  MonitorIcon,
  PanelLeftIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  PowerIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SearchIcon,
  SeparatorHorizontalIcon,
  SettingsIcon,
  ShapesIcon,
  SparklesIcon,
  SquareArrowOutUpRightIcon,
  SquarePenIcon,
  SquareTerminalIcon,
  TagIcon,
  TerminalIcon,
  Trash2Icon,
} from '@lucide/vue'
import { computed } from 'vue'
import { PROVIDERS } from '@shared/providers'
import { startCommandLabel } from '@shared/start-commands'
import type { SessionUpdateInput, StartCommand } from '@shared/types'
import AccountDot from '@/components/accounts/AccountDot.vue'
import { SETTINGS_ICONS } from '@/components/settings/settings-icons'
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@/components/ui/command'
import { useChatActions } from '@/composables/useChatActions'
import { useSettingsTransfer } from '@/composables/useSettingsTransfer'
import { SETTINGS } from '@/composables/useSettingsSearch'
import { isChatWindow } from '@/lib/chat-window'
import { chatSources, startsChats } from '@/lib/device-chats'
import { attempt } from '@/lib/errors'
import { nextWaiting, type InboxRow } from '@/lib/inbox'
import { chatKey } from '@/lib/session-tree'
import type { SettingsEntry } from '@/lib/settings-index'
import { startShellId } from '@/lib/shells'
import { useAccountsStore } from '@/stores/accounts'
import { useShownDeviceStore } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { useInboxStore } from '@/stores/inbox'
import { useProjectsStore } from '@/stores/projects'
import { useProvidersStore } from '@/stores/providers'
import { useScheduledStore } from '@/stores/scheduled'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import { useStartCommandsStore } from '@/stores/start-commands'
import { useTerminalsStore } from '@/stores/terminals'
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
const startCommands = useStartCommandsStore()
const terminals = useTerminalsStore()
const scheduled = useScheduledStore()
const devices = useDevicesStore()
const shown = useShownDeviceStore()
const chat = useChatActions()
const transfer = useSettingsTransfer()

/** Closes the quick open first, so the keyboard is back in the window before the action runs. */
function run(action: () => unknown, keepFocus = false): void {
  emit('done', keepFocus)
  void action()
}

/** The page of the tasks behind the dialog, so the new one shows in its list once saved. */
function newTask(): void {
  ui.view = 'scheduled'
  scheduled.dialog = { kind: 'new' }
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

/** Where Ctrl+Shift+J goes: the next chat, of any device, that waits for an answer. A chat's own window has no inbox. */
const waitingNext = computed(() => {
  if (isChatWindow) return null
  const rows = useInboxStore().rows
  const id = ui.view === 'chat' ? useSessionsStore(shown.device).activeId : null
  const key = nextWaiting(rows, id ? chatKey(shown.device, id) : null)
  return rows.find((r) => r.key === key) ?? null
})
function openWaiting(row: InboxRow): void {
  void useChatActions(row.device).open(row.entry.id)
}
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

/** The project of the chat on screen, for its start commands. */
const chatProject = computed(() => projects.get(meta.value?.projectId))

/** Ends it, or starts it and shows it beside the chat. */
function toggleStart(command: StartCommand): void {
  const projectId = chatProject.value?.id
  if (!projectId) return
  if (startCommands.isRunning(projectId, command.id)) {
    void startCommands.stop(projectId, command.id)
    return
  }
  ui.shellId = startShellId(command.id)
  void startCommands.start(projectId, command.id)
}

function editStartCommands(): void {
  if (chatProject.value) ui.startCommandsProject = chatProject.value.id
}
/** A worktree of the repository the chat on screen works in, else of the project the start page shows. */
const worktreeRequest = computed(() => {
  const project = meta.value ? projects.get(meta.value.projectId) : (projects.get(ui.homeProjectId) ?? projects.projects[0])
  if (!project) return null
  return { projectId: project.id, folder: (meta.value && sessions.cwdOf(meta.value)) || project.path }
})

/**
 * A new chat in every project of this device, and of every other one shown in the sidebar that lets
 * this one start chats there (Remote Control); the hidden ones are not among `devices.devices`.
 */
const projectChoices = computed(() =>
  chatSources(devices.devices)
    .filter(startsChats)
    .flatMap(({ id, name }) =>
      useProjectsStore(id).projects.map((project) => ({ key: id ? chatKey(id, project.id) : project.id, device: id, deviceName: name, project })),
    ),
)

/** The start page of the project's device, as its „Neuer Chat“ in the sidebar opens it. */
function newChatIn(choice: { device: string | null; project: { id: string } }): void {
  if (choice.device) useChatActions(choice.device).newChat(choice.project.id)
  else chat.newChat(choice.project.id)
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
        <CommandItem
          v-if="worktreeRequest"
          value="new-chat-worktree"
          filter-text="Neuer Chat in Worktree git branch parallel claude --worktree isoliert"
          @select="run(() => (ui.worktreeRequest = worktreeRequest), true)"
        >
          <FolderGit2Icon />
          Neuer Chat in Worktree …
        </CommandItem>
        <CommandItem value="inbox" filter-text="Posteingang Inbox wartet Rückfragen Fehler ungelesen fertig Aufmerksamkeit" @select="run(() => (ui.view = 'inbox'))">
          <InboxIcon />
          Posteingang
        </CommandItem>
        <CommandItem
          v-if="waitingNext"
          value="next-waiting"
          filter-text="Zum Chat, der auf dich wartet springen Rückfrage Freigabe Frage Plan nächster"
          @select="run(() => openWaiting(waitingNext!))"
        >
          <HandIcon />
          Zum Chat, der auf dich wartet
          <CommandShortcut>Strg+Umschalt+J</CommandShortcut>
        </CommandItem>
        <CommandItem value="artifacts" filter-text="Artefakte Seiten Dokumente claude.ai veröffentlicht Artifact" @select="run(() => (ui.view = 'artifacts'))">
          <ShapesIcon />
          Artefakte
        </CommandItem>
        <CommandItem value="scheduled" filter-text="Geplante Aufgaben Zeitplan wiederkehrend automatisch täglich" @select="run(() => (ui.view = 'scheduled'))">
          <CalendarClockIcon />
          Geplante Aufgaben
        </CommandItem>
        <CommandItem
          value="new-scheduled"
          filter-text="Neue geplante Aufgabe Zeitplan anlegen wiederkehrend"
          @select="run(newTask, true)"
        >
          <CalendarPlusIcon />
          Neue geplante Aufgabe…
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
        <CommandItem
          value="import-cli-sessions"
          filter-text="Sessions der CLIs übernehmen importieren Import Claude Code Codex Terminal IDE vorhandene bestehende Unterhaltungen"
          @select="run(() => ui.openSettings('accounts', 'accounts.cliImport'), true)"
        >
          <HistoryIcon />
          Sessions der CLIs übernehmen…
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
        <CommandItem
          value="settings-export"
          filter-text="Einstellungen exportieren Export sichern Sicherung Backup Datei anderer Computer Themes"
          @select="run(transfer.exportSettings)"
        >
          <FileOutputIcon />
          Einstellungen exportieren…
        </CommandItem>
        <CommandItem
          value="settings-import"
          filter-text="Einstellungen importieren Import übernehmen wiederherstellen Datei anderer Computer vergleichen Themes"
          @select="run(transfer.importSettings, true)"
        >
          <FileInputIcon />
          Einstellungen importieren…
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
          <CommandItem
            v-if="ui.view === 'chat'"
            value="chat-terminal"
            filter-text="Terminal öffnen ausblenden Shell Konsole PowerShell Bash Kommandozeile"
            @select="run(() => terminals.toggle(meta!.id), true)"
          >
            <TerminalIcon />
            {{ terminals.isOpen(meta.id) ? 'Terminal ausblenden' : 'Terminal öffnen' }}
            <CommandShortcut>Strg+Ö</CommandShortcut>
          </CommandItem>
          <CommandItem value="chat-pin" filter-text="Chat anheften lösen oben halten" @select="run(() => update({ pinned: !meta!.pinned }))">
            <PinOffIcon v-if="meta.pinned" />
            <PinIcon v-else />
            {{ meta.pinned ? 'Chat lösen' : 'Chat anheften' }}
          </CommandItem>
          <CommandItem
            value="chat-tags"
            filter-text="Schlagwörter bearbeiten Tags Etiketten Label markieren Filter"
            @select="run(() => (ui.tagsRequest = { device: null, id: meta!.id }), true)"
          >
            <TagIcon />
            Schlagwörter bearbeiten…
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
            value="chat-restart"
            filter-text="Chat neu starten Neustart CLI Prozess Claude Codex Einstellungen übernehmen restart"
            @select="run(() => chat.restart(meta!))"
          >
            <RotateCwIcon />
            Chat neu starten
          </CommandItem>
          <CommandItem
            value="chat-window"
            filter-text="In eigenem Fenster öffnen Fenster Popout auslagern abdocken loslösen separat zweiter Bildschirm"
            @select="run(() => chat.popOut(meta!))"
          >
            <SquareArrowOutUpRightIcon />
            In eigenem Fenster öffnen
          </CommandItem>
          <CommandItem value="chat-end" filter-text="Chat beenden schließen CLI Prozess stoppen Claude Codex Startseite exit" @select="run(() => chat.end(meta!))">
            <PowerIcon />
            Chat beenden
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

      <template v-if="chatProject">
        <CommandSeparator />
        <CommandGroup :heading="`Startbefehle von „${chatProject.name}“`">
          <CommandItem
            v-for="c in startCommands.commandsOf(chatProject.id)"
            :key="c.id"
            :value="`start-command-${c.id}`"
            :filter-text="`Startbefehl ${startCommandLabel(c)} ${c.command} starten beenden Shell Dev-Server`"
            @select="run(() => toggleStart(c))"
          >
            <CircleStopIcon v-if="startCommands.isRunning(chatProject.id, c.id)" />
            <PlayIcon v-else />
            <span class="min-w-0 truncate">
              „{{ startCommandLabel(c) }}“ {{ startCommands.isRunning(chatProject.id, c.id) ? 'beenden' : 'starten' }}
            </span>
          </CommandItem>
          <CommandItem
            value="start-commands-edit"
            filter-text="Startbefehle bearbeiten einrichten Dev-Server npm run dev Shell Projekt automatisch starten"
            @select="run(editStartCommands, true)"
          >
            <SquareTerminalIcon />
            Startbefehle bearbeiten…
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
          v-for="choice in projectChoices"
          :key="choice.key"
          :value="`project-${choice.key}`"
          :filter-text="`Neuer Chat in ${choice.project.name} ${choice.project.path} ${choice.deviceName ?? ''}`"
          search-only
          @select="run(() => newChatIn(choice))"
        >
          <FolderIcon />
          <span class="min-w-0 truncate">Neuer Chat in {{ choice.project.name }}</span>
          <span v-if="choice.deviceName" class="flex min-w-0 shrink items-center gap-1 text-xs text-muted-foreground" :title="`Auf ${choice.deviceName}`">
            <MonitorIcon class="size-3" />
            <span class="truncate">{{ choice.deviceName }}</span>
          </span>
          <CommandShortcut class="max-w-[45%] truncate tracking-normal">{{ choice.project.path }}</CommandShortcut>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </Command>
</template>
