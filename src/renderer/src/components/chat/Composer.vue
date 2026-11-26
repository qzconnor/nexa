<script setup lang="ts">
import { ArrowUpIcon, ChevronDownIcon, FolderIcon, MicIcon, SettingsIcon, SquareIcon, TerminalIcon, XIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ContextUsage, PermissionMode, ProviderId } from '@shared/chat'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
import type { CommandOption, ModelDefaults } from '@shared/types'
import { voiceAvailable } from '@shared/voice'
import ImageViewer from '@/components/common/ImageViewer.vue'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import { useProjectPath } from '@/composables/useProjectPath'
import { useVoiceInput } from '@/composables/useVoiceInput'
import { appCommandOf, appCommandOptions, mergeCommands, type AppCommand } from '@/lib/chat-commands'
import { applySuggestion, filterCommands, findPaths, triggerAt, type Suggestion, type SuggestTrigger } from '@/lib/composer-suggest'
import { effortLabel, effortTone } from '@/lib/effort'
import { attempt } from '@/lib/errors'
import { isWindows } from '@/lib/platform'
import { FILE_TREE_DRAG_TYPE, mentionOf } from '@/lib/file-tree'
import { fileImageUrl } from '@/lib/tools'
import { cn } from '@/lib/utils'
import { spokenText, voiceAnchor, withSpoken, type VoiceAnchor } from '@/lib/voice-text'
import { useAccountsStore } from '@/stores/accounts'
import { useComposerStore } from '@/stores/composer'
import { useDevice } from '@/stores/device'
import { useDevicesStore } from '@/stores/devices'
import { useProvidersStore } from '@/stores/providers'
import { useSettingsStore } from '@/stores/settings'
import ComposerAddMenu from './ComposerAddMenu.vue'
import ComposerControls from './ComposerControls.vue'
import ContextCard from './ContextCard.vue'
import ComposerSettings from './ComposerSettings.vue'
import ComposerSuggest from './ComposerSuggest.vue'
import VoiceMeter from './VoiceMeter.vue'

/**
 * Where prompts are written: text, pasted or dropped images (a click shows one large), commands,
 * skills and files completed as they are typed; below it the CLI and account, and by the send button
 * the gear with model, effort, Ultracode and permission mode. While the agent works a prompt is sent
 * as any other and waits in the chat until the agent takes it up; with the field empty, the button
 * stops the turn. `!` at the start turns it into the shell mode, as in Claude Code: the line runs
 * as a command in the chat's folder (on the start page in a new chat, as a first prompt would).
 * The microphone (Ctrl+M) writes what is said at the cursor while one speaks, for every CLI; it is
 * there while a Claude account is signed in (the recognition is Claude's).
 */
const props = defineProps<{
  provider: ProviderId
  /** The account of the chat for its CLI. */
  account?: string
  model: string
  effort: string
  mode: PermissionMode
  /** Claude's Ultracode for the chat; missing: as the CLI's settings say. */
  ultracode?: boolean
  busy?: boolean
  context?: ContextUsage
  /** The CLI compacts the chat's context right now (its ring turns meanwhile). */
  compacting?: boolean
  /** The open chat (none on the start page): its context in detail, its MCP servers. */
  sessionId?: string
  /** More folders the chat's agent works in (`SessionMeta.dirs`). */
  dirs?: string[]
  /** Kept per chat while it isn't sent. */
  draftKey?: string
  autofocus?: boolean
  disabled?: boolean
  /** Floats over the chat, frosted (in a `.frost-backing` wrapper). */
  floating?: boolean
  /** What the user will likely write next (`SessionRuntime.suggestion`): grey in the empty field, Tab takes it. */
  suggestion?: string
}>()
const emit = defineEmits<{
  send: [input: { text: string; images: string[] }]
  /** One of Nexa's own commands (lib/chat-commands.ts), in a chat only: the chat runs it, the CLI never sees it. */
  command: [input: { command: AppCommand; args: string }]
  /** A command typed in the shell mode (`!`): Nexa runs it, the next prompt tells the CLI. */
  shell: [command: string]
  /** Text put in from elsewhere (a file mentioned in the tree, review comments): it wants to be seen. */
  inserted: []
  stop: []
  'update:provider': [ProviderId]
  'update:account': [string]
  'update:model': [string]
  'update:effort': [string]
  'update:mode': [PermissionMode]
  'update:ultracode': [boolean]
  'update:dirs': [string[]]
}>()
const settings = useSettingsStore()
const providers = useProvidersStore()
const accounts = useAccountsStore()

const composer = useComposerStore()
/** In a chat of another device: its files and folders are there, not here. */
const device = useDevice()
/**
 * Another device that lets this one prompt but not more: how an open chat's agent runs (CLI, account,
 * model, effort, mode) stays as it is set there. A new chat may still pick them (`sessions:create`).
 */
const devices = useDevicesStore()
const agentLocked = computed(() => !!props.sessionId && !devices.can(device, 'full'))
const { relative, root: projectRoot } = useProjectPath()
const text = ref('')
const images = ref<string[]>([])
const input = ref<HTMLTextAreaElement | null>(null)
const dragging = ref(false)
/** The attached picture shown large; null while none is. */
const viewing = ref<number | null>(null)

/** `!` typed at the start: the line is a command for the shell, not a prompt (the `!` itself isn't kept). */
const shellMode = ref(false)
const SHELL_NAMES = { powershell: 'PowerShell', gitbash: 'Git Bash', cmd: 'cmd' } as const
const shellName = computed(() => (isWindows ? SHELL_NAMES[settings.settings.chat.shell] : 'Shell'))

const canSend = computed(() => !props.disabled && (text.value.trim().length > 0 || (!shellMode.value && images.value.length > 0)))
/** The guess at the next prompt stands in the field while nothing is written there. */
const suggested = computed(() => (!props.busy && !shellMode.value && !dictating.value && !text.value && !images.value.length ? props.suggestion?.trim() || null : null))
const placeholder = computed(() => {
  if (dictating.value) return 'Sprich jetzt …'
  if (shellMode.value) return `Befehl in ${shellName.value} ausführen …`
  if (suggested.value) return suggested.value
  return props.busy ? 'Nachricht senden, während der Agent arbeitet …' : `Nachricht an ${PROVIDERS[props.provider].name} …`
})
const sendHint = computed(() => (settings.settings.chat.enterSends ? 'Senden (Enter)' : 'Senden (Strg+Enter)'))

/** Tab writes the guess into the field, to send as it is or change first. */
function takeSuggestion(): void {
  if (!suggested.value) return
  text.value = suggested.value
  void nextTick(() => {
    const el = input.value
    el?.setSelectionRange(text.value.length, text.value.length)
    resize()
  })
}

function leaveShellMode(): void {
  shellMode.value = false
  void nextTick(() => input.value?.focus())
}

// ── Voice input: the words go in at the cursor while they are heard ──

/** Where the take writes: the text around the cursor when it started. */
let voiceAt: VoiceAnchor | null = null
/** The take's closed utterances, and the one still being heard. */
const heard: string[] = []
let hearing = ''

const voice = useVoiceInput({
  transcript: (words, final) => {
    if (!voiceAt) return
    if (final) {
      heard.push(words)
      hearing = ''
    } else {
      hearing = words
    }
    const next = withSpoken(voiceAt, spokenText(heard, hearing))
    text.value = next.text
    void nextTick(() => {
      resize()
      input.value?.setSelectionRange(next.cursor, next.cursor)
    })
  },
  // „Automatisch beenden“: done talking counts as a click on the microphone.
  paused: () => void finishVoice(),
})
const { state: voiceState, levels: voiceLevels } = voice
/** A take runs: the field only shows what is heard until it ends. */
const dictating = computed(() => voiceState.value !== 'idle')
/** Only with a Claude login: there is no other recognition, also not in Codex chats. */
const voiceReady = computed(() =>
  voiceAvailable(accounts.accounts, settings.settings.chat.voiceAccount, settings.settings.claude.enabled),
)

async function startVoice(): Promise<void> {
  if (props.disabled || dictating.value || !voiceReady.value) return
  const el = input.value
  const end = text.value.length
  voiceAt = voiceAnchor(text.value, el?.selectionStart ?? end, el?.selectionEnd ?? end)
  heard.length = 0
  hearing = ''
  closeSuggest()
  el?.focus()
  // The project's name is a word the recognition wouldn't guess.
  const project = projectRoot.value ? folderName(projectRoot.value) : null
  const { voiceMicrophone, voiceAutoStop } = settings.settings.chat
  await voice.start({ account: props.account, keyterms: project ? [project] : [] }, { microphone: voiceMicrophone, pause: voiceAutoStop })
}

/** The end under way: a second click, Enter or the pause waits for it instead of dropping its last words. */
let stopping: Promise<boolean> | null = null

/** Ends the take; `true` when it ended well and heard something. */
function stopVoice(): Promise<boolean> {
  stopping ??= (async () => {
    const ended = await voice.stop()
    const said = spokenText(heard, hearing) !== ''
    voiceAt = null
    input.value?.focus()
    return ended && said
  })().finally(() => (stopping = null))
  return stopping
}

/** The take is done (microphone, Strg+M, a pause): with „Automatisch abschicken“ the prompt goes too. */
async function finishVoice(): Promise<void> {
  if ((await stopVoice()) && settings.settings.chat.voiceAutoSend) send()
}

function toggleVoice(): void {
  if (dictating.value) void finishVoice()
  else void startVoice()
}

/** Sends; a take still running ends first, and its last words go along. */
function submit(): void {
  if (!dictating.value) return send()
  void stopVoice().then(() => send())
}

watch(
  () => props.draftKey,
  (next, previous) => {
    if (previous) {
      // A take belongs to the chat it was started in; what it wrote stays in that chat's draft.
      voice.cancel()
      composer.saveDraft(previous, { text: text.value, images: images.value })
      composer.detach(previous, insertText)
    }
    const draft = next ? composer.draftOf(next) : undefined
    text.value = draft?.text ?? ''
    images.value = draft?.images ? [...draft.images] : []
    shellMode.value = false
    if (next) composer.attach(next, insertText, readDraft)
    // The first draft comes with the composer; focus waits for onMounted then.
    if (previous === undefined) return
    void nextTick(() => {
      resize()
      input.value?.focus()
    })
  },
  { immediate: true },
)

onMounted(() => {
  resize()
  if (props.autofocus) input.value?.focus()
})

// Unsent words survive the chat being closed (the start page, another view).
onBeforeUnmount(() => {
  if (!props.draftKey) return
  composer.saveDraft(props.draftKey, { text: text.value, images: images.value })
  composer.detach(props.draftKey, insertText)
})

/** What the field holds now, for a chat that moves to another window with what is written. */
function readDraft(): { text: string; images: string[] } {
  return { text: text.value, images: [...images.value] }
}

/** Puts text at the cursor (a file mentioned in the tree, review comments), with a space before it. */
function insertText(snippet: string): void {
  // The take would write over it with the words it heard.
  voice.cancel()
  const el = input.value
  const start = el?.selectionStart ?? text.value.length
  const end = el?.selectionEnd ?? text.value.length
  const before = text.value.slice(0, start)
  const gap = before && !/\s$/.test(before) ? ' ' : ''
  text.value = `${before}${gap}${snippet}${text.value.slice(end)}`
  const cursor = before.length + gap.length + snippet.length
  closeSuggest()
  // First, so whatever hides the composer goes before it takes the keyboard.
  emit('inserted')
  void nextTick(() => {
    resize()
    input.value?.focus()
    input.value?.setSelectionRange(cursor, cursor)
  })
}

function resize(): void {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`
}

// ── Completing commands, skills and files at the cursor ──

const trigger = ref<SuggestTrigger | null>(null)
const active = ref(0)
const cliCommands = shallowRef<CommandOption[]>([])
/** In a chat, Nexa's own commands first; they are there at once, the CLI's come when it answered. */
const commandList = computed(() => (props.sessionId ? mergeCommands(appCommandOptions(props.provider), cliCommands.value) : cliCommands.value))
const fileList = shallowRef<readonly string[]>([])
const suggestLoading = ref(false)
/** The trigger closed with Esc: it stays closed until another one is typed. */
let dismissed: { kind: SuggestTrigger['kind']; from: number } | null = null
let loadToken = 0

const suggestions = computed<Suggestion[]>(() => {
  const t = trigger.value
  if (!t) return []
  if (t.kind === 'file') return findPaths(fileList.value, t.query).map((entry) => ({ type: 'file', ...entry }))
  return filterCommands(commandList.value, t.query, t.kind === 'skill' ? 'skill' : undefined).map((option) => ({ type: 'command', option }))
})
/** Open while something fits (or is still coming): with nothing to offer, Enter sends as always. */
const suggesting = computed(() => !!trigger.value && (suggestions.value.length > 0 || suggestLoading.value))

function closeSuggest(): void {
  trigger.value = null
  suggestLoading.value = false
}

function updateSuggest(): void {
  const el = input.value
  if (!el || props.disabled || shellMode.value || el.selectionStart !== el.selectionEnd || document.activeElement !== el) return closeSuggest()
  const next = triggerAt(text.value, el.selectionStart, props.provider)
  if (next && dismissed?.kind === next.kind && dismissed.from === next.from) return closeSuggest()
  dismissed = null
  if (!next) return closeSuggest()
  const before = trigger.value
  trigger.value = next
  if (!before || before.kind !== next.kind || before.from !== next.from) {
    active.value = 0
    void loadSuggestions(next.kind)
  } else if (before.query !== next.query) {
    active.value = 0
  }
}

async function loadSuggestions(kind: SuggestTrigger['kind']): Promise<void> {
  const token = ++loadToken
  suggestLoading.value = true
  try {
    if (kind === 'file') {
      const root = projectRoot.value
      const list = root ? await composer.filesOf(root, device) : []
      if (token === loadToken) fileList.value = list
    } else {
      const list = await providers.commands(props.provider, props.account, projectRoot.value)
      if (token === loadToken) cliCommands.value = list
    }
  } finally {
    if (token === loadToken) suggestLoading.value = false
  }
}

function pickSuggestion(index: number): void {
  const t = trigger.value
  const item = suggestions.value[index]
  if (!t || !item) return
  const next = applySuggestion(text.value, t, item)
  text.value = next.text
  closeSuggest()
  void nextTick(() => {
    resize()
    input.value?.focus()
    input.value?.setSelectionRange(next.cursor, next.cursor)
    // A folder goes on with its entries.
    updateSuggest()
  })
}

/** The keys of the open list; true when the key was its. */
function suggestKey(event: KeyboardEvent): boolean {
  if (!suggesting.value || event.isComposing) return false
  const count = suggestions.value.length
  const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && plain) {
    if (count) active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
  } else if ((event.key === 'Enter' || event.key === 'Tab') && plain) {
    if (!count) return false
    // A command typed out in full runs with Enter, as in the CLI; Tab only completes.
    if (event.key === 'Enter' && typedOut()) {
      closeSuggest()
      return false
    }
    pickSuggestion(active.value)
  } else if (event.key === 'Escape') {
    // Only the list closes; the chat's Esc (stop the agent, close a view) waits for the next one.
    event.stopPropagation()
    if (trigger.value) dismissed = { kind: trigger.value.kind, from: trigger.value.from }
    closeSuggest()
  } else {
    return false
  }
  event.preventDefault()
  return true
}

/** The command chosen in the list is what was typed already, to the letter. */
function typedOut(): boolean {
  const t = trigger.value
  const item = suggestions.value[active.value]
  return t?.kind === 'command' && item?.type === 'command' && item.option.insert === `/${t.query}` && text.value.slice(t.to).trim() === ''
}

// Another chat's draft: what was being completed belongs to the one before.
watch(() => props.draftKey, closeSuggest)

// Another CLI, account or folder has other commands.
watch(
  () => [props.provider, props.account, projectRoot.value] as const,
  () => {
    cliCommands.value = []
    closeSuggest()
  },
)

// ── Model, effort, Ultracode and permission mode behind the gear ──

const settingsOpen = ref(false)
const defaults = ref<ModelDefaults | null>(null)
/** Asked once the composer is used: Claude Code answers from a short start of its own. */
const warm = ref(false)

watch(
  () => [warm.value || settingsOpen.value, props.provider, props.account, props.model] as const,
  async ([wanted, provider, account, model]) => {
    if (!wanted) return
    const answer = await providers.modelDefaults(provider, account, model)
    if (provider === props.provider && account === props.account && model === props.model) defaults.value = answer
  },
  { immediate: true },
)

function onFocus(): void {
  if (warm.value) return
  warm.value = true
  // The commands are ready by the time `/` is typed.
  void providers.commands(props.provider, props.account, projectRoot.value)
}

/** What differs from the usual stays in sight with the panel closed. */
const chips = computed(() => {
  const list: { label: string; class: string }[] = []
  const effort = props.effort
  if (effort && effort !== defaults.value?.effort) list.push({ label: effortLabel(effort), class: effortTone(effort).text })
  if (props.provider === 'claude' && defaults.value?.ultracode?.available && (props.ultracode ?? defaults.value.ultracode.on)) {
    list.push({ label: 'Ultracode', class: 'text-foreground' })
  }
  if (props.mode === 'full') list.push({ label: PERMISSION_MODES.full.label, class: 'text-destructive' })
  if (props.mode === 'plan') list.push({ label: PERMISSION_MODES.plan.label, class: 'text-primary' })
  return list
})

function send(): void {
  if (!canSend.value) return
  if (shellMode.value) {
    const command = text.value.trim()
    text.value = ''
    // Back to prompts, as Claude Code does: a second command starts with `!` again.
    shellMode.value = false
    if (props.draftKey) composer.saveDraft(props.draftKey, { text: '', images: [...images.value] })
    void nextTick(resize)
    emit('shell', command)
    return
  }
  const command = props.sessionId ? appCommandOf(text.value, props.provider) : null
  const input = { text: text.value.trim(), images: [...images.value] }
  text.value = ''
  // Attached pictures wait for the next prompt when a command goes instead.
  if (!command) images.value = []
  closeSuggest()
  if (props.draftKey) composer.saveDraft(props.draftKey, { text: '', images: [...images.value] })
  void nextTick(resize)
  // Last: a command may put something into the field itself (`/help` the list of commands).
  if (command) emit('command', command)
  else emit('send', input)
}

function onInput(): void {
  // `!` at the start of the line (typed or pasted) switches to the shell mode.
  if (!shellMode.value && text.value.startsWith('!')) {
    shellMode.value = true
    text.value = text.value.slice(1)
    const el = input.value
    const cursor = Math.max(0, (el?.selectionStart ?? 1) - 1)
    void nextTick(() => el?.setSelectionRange(cursor, cursor))
  }
  resize()
  updateSuggest()
}

function onKeydown(event: KeyboardEvent): void {
  const ctrlOnly = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey
  if (ctrlOnly && event.key.toLowerCase() === 'm' && !shellMode.value) {
    event.preventDefault()
    toggleVoice()
    return
  }
  if (dictating.value && event.key === 'Escape') {
    // Ends the take (its words stay), not the agent's turn; never sends, also with „Automatisch abschicken“.
    event.preventDefault()
    event.stopPropagation()
    void stopVoice()
    return
  }
  if (suggestKey(event)) return
  if (event.key === 'Tab' && suggested.value && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    takeSuggestion()
    return
  }
  if (shellMode.value) {
    const el = input.value
    const atStart = !!el && el.selectionStart === 0 && el.selectionEnd === 0
    // Backspace before the first letter takes the `!` away, Esc the mode (not the agent's turn).
    if ((event.key === 'Backspace' && atStart) || event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      leaveShellMode()
      return
    }
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'u') {
    event.preventDefault()
    void pickFiles()
    return
  }
  if (event.key !== 'Enter' || event.isComposing) return
  const enterSends = settings.settings.chat.enterSends
  if ((enterSends && !event.shiftKey) || (!enterSends && (event.ctrlKey || event.metaKey))) {
    event.preventDefault()
    submit()
  }
}

async function addImageFile(file: File): Promise<void> {
  const path = window.api.app.pathForFile(file)
  if (path) {
    images.value.push(path)
    return
  }
  const saved = await attempt(async () => window.api.app.saveImage(new Uint8Array(await file.arrayBuffer()), file.type), 'Bild konnte nicht angehängt werden')
  if (saved) images.value.push(saved)
}

function onPaste(event: ClipboardEvent): void {
  const files = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  for (const file of files) void addImageFile(file)
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  // An entry of the file tree becomes a mention of it, relative to the project.
  const treePath = event.dataTransfer?.getData(FILE_TREE_DRAG_TYPE)
  if (treePath) {
    insertText(mentionOf(relative(treePath)))
    return
  }
  const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
  for (const file of files) void addImageFile(file)
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp)$/i

/** Files from the dialog: pictures are attached, the others mentioned (relative to the project, where they are in it). */
async function pickFiles(): Promise<void> {
  const picked = await attempt(() => window.api.app.pickFiles(projectRoot.value ?? undefined))
  if (!picked?.length) return
  const others: string[] = []
  for (const path of picked) {
    if (IMAGE_EXTENSIONS.test(path)) images.value.push(path)
    // A file of this device means nothing to an agent on another one; pictures go there with the prompt.
    else if (!device) others.push(path)
  }
  if (others.length) insertText(others.map((p) => mentionOf(relative(p)).trimEnd()).join(' ') + ' ')
  else void nextTick(() => input.value?.focus())
}

/** Another folder for the agent to work in (the chat's, kept with it). */
async function addFolder(): Promise<void> {
  const dir = await attempt(() => window.api.app.pickDirectory(projectRoot.value ?? undefined))
  if (!dir || props.dirs?.includes(dir)) return
  emit('update:dirs', [...(props.dirs ?? []), dir])
}

function removeFolder(dir: string): void {
  emit(
    'update:dirs',
    (props.dirs ?? []).filter((d) => d !== dir),
  )
}

/** The commands' list, as if `/` was typed at the start. */
function startCommand(): void {
  if (!text.value.startsWith('/')) text.value = `/${text.value}`
  void nextTick(() => {
    resize()
    input.value?.focus()
    input.value?.setSelectionRange(1, 1)
    updateSuggest()
  })
}

const folderName = (dir: string) => dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir

const addMenu = ref<InstanceType<typeof ComposerAddMenu> | null>(null)

defineExpose({
  focus: () => input.value?.focus(),
  openSettings: () => (settingsOpen.value = true),
  openConnectors: () => addMenu.value?.openConnectors(),
  showCommands: () => {
    text.value = ''
    startCommand()
  },
  addFolder: () => void addFolder(),
})
</script>

<template>
  <div
    data-composer
    :class="
      cn(
        'relative flex flex-col rounded-2xl border transition-colors focus-within:border-ring/60',
        floating ? 'bg-card/40 shadow-lg shadow-black/15 backdrop-blur-lg' : 'bg-card shadow-lg shadow-black/5',
        shellMode && 'border-(--tool-shell)/70 focus-within:border-(--tool-shell)',
        dragging && 'border-primary bg-primary/5',
      )
    "
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <ComposerSuggest
      v-if="suggesting && trigger"
      class="absolute inset-x-0 bottom-full z-30 mb-2"
      :kind="trigger.kind"
      :items="suggestions"
      :active="active"
      :loading="suggestLoading"
      @hover="active = $event"
      @pick="pickSuggestion"
    />
    <!-- Folders added to the chat: the agent works in them too, until they are taken out. -->
    <div v-if="dirs?.length" class="flex flex-wrap gap-1.5 px-3 pt-3">
      <span
        v-for="dir in dirs"
        :key="dir"
        class="flex max-w-60 items-center gap-1.5 rounded-md border bg-background/40 py-0.5 pr-1 pl-2 text-[0.78rem]"
        v-tooltip="`${dir} – der Agent arbeitet auch in diesem Ordner`"
      >
        <FolderIcon class="size-3.5 shrink-0 text-muted-foreground" />
        <span class="truncate">{{ folderName(dir) }}</span>
        <button type="button" class="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" :aria-label="`${folderName(dir)} entfernen`" @click="removeFolder(dir)">
          <XIcon class="size-3" />
        </button>
      </span>
    </div>
    <div v-if="images.length" class="flex flex-wrap gap-2 px-3 pt-3">
      <div v-for="(image, i) in images" :key="image" class="group/img relative">
        <button type="button" class="block cursor-zoom-in rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Bild groß ansehen" @click="viewing = i">
          <img :src="fileImageUrl(image)" alt="" draggable="false" class="size-16 rounded-lg border object-cover" />
        </button>
        <button
          type="button"
          class="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-popover opacity-0 transition-opacity group-hover/img:opacity-100"
          aria-label="Bild entfernen"
          @click="images.splice(i, 1)"
        >
          <XIcon class="size-3" />
        </button>
      </div>
    </div>
    <div class="relative flex">
      <!-- The mode's mark where the `!` was typed; a click on it goes back to prompts. -->
      <button
        v-if="shellMode"
        type="button"
        class="shrink-0 self-start pt-3.5 pl-4 font-mono text-[0.95rem] leading-relaxed font-semibold text-(--tool-shell)"
        aria-label="Shell-Modus beenden"
        v-tooltip="'Shell-Modus beenden (Esc)'"
        @click="leaveShellMode"
      >
        !
      </button>
      <textarea
        ref="input"
        v-model="text"
        data-composer-input
        rows="1"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="dictating"
        :spellcheck="!shellMode && !dictating"
        :class="
          cn(
            'max-h-[40vh] min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[0.95rem] leading-relaxed outline-none placeholder:text-muted-foreground/70',
            shellMode && 'pl-2 font-mono text-[0.9rem]',
            suggested && 'pr-24',
          )
        "
        @input="onInput"
        @keydown="onKeydown"
        @keyup="updateSuggest"
        @click="updateSuggest"
        @focus="onFocus"
        @blur="closeSuggest"
        @paste="onPaste"
      />
      <!-- The guess is the placeholder; this says how to take it. -->
      <span v-if="suggested" class="pointer-events-none absolute top-3.5 right-4 flex h-[1.65em] items-center gap-1 text-[0.72rem] text-muted-foreground/80">
        <Kbd>Tab</Kbd> übernimmt
      </span>
    </div>
    <!-- Shell mode: what happens with the line, instead of what only matters to prompts. -->
    <div v-if="shellMode" class="flex min-h-9 items-center gap-2 px-4 pb-2 text-[0.8rem] text-muted-foreground">
      <TerminalIcon class="size-3.5 shrink-0 text-(--tool-shell)" />
      <span class="shrink-0 font-medium text-(--tool-shell)">Shell-Modus</span>
      <span class="min-w-0 truncate" v-tooltip="`Nexa führt den Befehl aus; ${PROVIDERS[provider].name} bekommt ihn samt Ausgabe mit dem nächsten Prompt.`">
        · {{ shellName }} {{ sessionId ? 'im Ordner des Chats' : 'im Projektordner, in einem neuen Chat' }}
      </span>
      <span class="ml-auto shrink-0 text-[0.75rem] opacity-80">Esc beendet</span>
      <Button size="icon-sm" :disabled="!canSend" aria-label="Befehl ausführen" class="rounded-full bg-(--tool-shell) text-background hover:bg-(--tool-shell)/85" @click="send">
        <ArrowUpIcon />
      </Button>
    </div>
    <div v-else class="flex items-center gap-1 px-2 pb-2">
      <ComposerAddMenu ref="addMenu" :session-id="sessionId" :provider="provider" :disabled="disabled" @files="pickFiles" @folder="addFolder" @commands="startCommand" />
      <ComposerControls
        :provider="provider"
        :account="account"
        :model="model"
        :disabled="agentLocked"
        @update:provider="emit('update:provider', $event)"
        @update:account="emit('update:account', $event)"
      />
      <!-- The gear sits by the send button: what it sets (model, effort, permissions) goes with the prompt. -->
      <div class="ml-auto flex min-w-0 items-center gap-2">
        <!-- While one speaks, the level takes the place of what only matters to typing. -->
        <VoiceMeter v-if="dictating" :levels="voiceLevels" :resting="voiceState === 'finishing'" />
        <template v-else>
          <ContextCard v-if="context?.window" :session-id="sessionId" :provider="provider" :context="context" :busy="busy" :compacting="compacting" />
          <Button
            variant="ghost"
            size="sm"
            :class="cn('min-w-0 gap-1.5 px-2 text-muted-foreground', settingsOpen && 'bg-muted text-foreground')"
            :aria-expanded="settingsOpen"
            aria-label="Modell, Denkaufwand und Freigaben"
            v-tooltip="'Modell, Denkaufwand und Freigaben'"
            @click="settingsOpen = !settingsOpen"
          >
            <SettingsIcon class="size-3.5" />
            <span v-for="chip in chips" :key="chip.label" :class="cn('truncate text-[0.8rem]', chip.class)">{{ chip.label }}</span>
            <ChevronDownIcon :class="cn('size-3 opacity-60 transition-transform', settingsOpen && 'rotate-180')" />
          </Button>
        </template>
        <Button
          v-if="voiceReady || dictating"
          variant="ghost"
          size="icon-sm"
          :disabled="disabled && !dictating"
          :aria-pressed="dictating"
          :aria-label="dictating ? 'Spracheingabe beenden' : 'Spracheingabe'"
          v-tooltip="dictating ? 'Spracheingabe beenden (Strg+M)' : 'Spracheingabe (Strg+M)'"
          :class="cn('text-muted-foreground', dictating && 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary')"
          @click="toggleVoice"
        >
          <Spinner v-if="voiceState === 'finishing'" class="size-3.5" />
          <!-- Recording: the capsule filled, its stand as lines. -->
          <MicIcon v-else :class="cn('size-4', dictating && '[&_rect]:fill-current')" />
        </Button>
        <Button v-if="busy && !canSend && !dictating" size="icon-sm" variant="secondary" aria-label="Anhalten" v-tooltip="'Anhalten (Esc)'" @click="emit('stop')">
          <SquareIcon class="size-3 fill-current" />
        </Button>
        <!-- Also while the agent works: the chat shows the prompt waiting („Wartet“) until the agent takes it up. -->
        <Button v-else size="icon-sm" :disabled="!canSend" aria-label="Senden" v-tooltip="sendHint" class="rounded-full" @click="submit">
          <ArrowUpIcon />
        </Button>
      </div>
    </div>
    <!-- Opens downwards under the row, inside the card; closed it is out of reach of Tab too. -->
    <div :class="cn('grid transition-[grid-template-rows] duration-200 ease-out', settingsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')" :inert="!settingsOpen">
      <div class="min-h-0 overflow-hidden">
        <div class="mx-3 mb-2 border-t" />
        <ComposerSettings
          :provider="provider"
          :model="model"
          :effort="effort"
          :mode="mode"
          :ultracode="ultracode"
          :defaults="defaults"
          :disabled="disabled || agentLocked"
          @update:model="emit('update:model', $event)"
          @update:effort="emit('update:effort', $event)"
          @update:mode="emit('update:mode', $event)"
          @update:ultracode="emit('update:ultracode', $event)"
        />
      </div>
    </div>
    <ImageViewer v-model:index="viewing" :images="images" />
  </div>
</template>
