<script setup lang="ts">
import { ArrowUpIcon, ChevronDownIcon, CornerDownRightIcon, PaperclipIcon, SettingsIcon, SquareIcon, XIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ContextUsage, PermissionMode, ProviderId } from '@shared/chat'
import { PERMISSION_MODES, PROVIDERS } from '@shared/providers'
import type { CommandOption, ModelDefaults } from '@shared/types'
import UsageRing from '@/components/common/UsageRing.vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useProjectPath } from '@/composables/useProjectPath'
import { applySuggestion, filterCommands, findPaths, triggerAt, type Suggestion, type SuggestTrigger } from '@/lib/composer-suggest'
import { effortLabel, effortTone } from '@/lib/effort'
import { attempt } from '@/lib/errors'
import { FILE_TREE_DRAG_TYPE, mentionOf } from '@/lib/file-tree'
import { formatTokens } from '@/lib/format'
import { fileImageUrl } from '@/lib/tools'
import { cn } from '@/lib/utils'
import { useComposerStore } from '@/stores/composer'
import { useProvidersStore } from '@/stores/providers'
import { useSettingsStore } from '@/stores/settings'
import ComposerControls from './ComposerControls.vue'
import ComposerSettings from './ComposerSettings.vue'
import ComposerSuggest from './ComposerSuggest.vue'

/**
 * Where prompts are written: text, pasted or dropped images, commands, skills and files completed
 * as they are typed; below it the CLI and account, and behind the gear model, effort, Ultracode and
 * permission mode. While the agent works, sending steers it (Codex) or queues the prompt (Claude),
 * and the button next to it stops the turn.
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
  /** Kept per chat while it isn't sent. */
  draftKey?: string
  autofocus?: boolean
  disabled?: boolean
  /** Floats over the chat, frosted (in a `.frost-backing` wrapper). */
  floating?: boolean
}>()
const emit = defineEmits<{
  send: [input: { text: string; images: string[] }]
  /** Text put in from elsewhere (a file mentioned in the tree, review comments): it wants to be seen. */
  inserted: []
  stop: []
  'update:provider': [ProviderId]
  'update:account': [string]
  'update:model': [string]
  'update:effort': [string]
  'update:mode': [PermissionMode]
  'update:ultracode': [boolean]
}>()
const settings = useSettingsStore()
const providers = useProvidersStore()

const composer = useComposerStore()
const { relative, root: projectRoot } = useProjectPath()
const text = ref('')
const images = ref<string[]>([])
const input = ref<HTMLTextAreaElement | null>(null)
const dragging = ref(false)

const canSend = computed(() => !props.disabled && (text.value.trim().length > 0 || images.value.length > 0))
const contextPercent = computed(() => (props.context?.window ? (props.context.used / props.context.window) * 100 : 0))
const placeholder = computed(() => (props.busy ? 'Nachricht senden, während der Agent arbeitet …' : `Nachricht an ${PROVIDERS[props.provider].name} …`))

watch(
  () => props.draftKey,
  (next, previous) => {
    if (previous) {
      composer.saveDraft(previous, { text: text.value, images: images.value })
      composer.detach(previous, insertText)
    }
    const draft = next ? composer.draftOf(next) : undefined
    text.value = draft?.text ?? ''
    images.value = draft?.images ? [...draft.images] : []
    if (next) composer.attach(next, insertText)
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

/** Puts text at the cursor (a file mentioned in the tree, review comments), with a space before it. */
function insertText(snippet: string): void {
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
const commandList = shallowRef<CommandOption[]>([])
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
  if (!el || props.disabled || el.selectionStart !== el.selectionEnd || document.activeElement !== el) return closeSuggest()
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
      const list = root ? await composer.filesOf(root) : []
      if (token === loadToken) fileList.value = list
    } else {
      const list = await providers.commands(props.provider, props.account, projectRoot.value)
      if (token === loadToken) commandList.value = list
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

// Another chat's draft: what was being completed belongs to the one before.
watch(() => props.draftKey, closeSuggest)

// Another CLI, account or folder has other commands.
watch(
  () => [props.provider, props.account, projectRoot.value] as const,
  () => {
    commandList.value = []
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
  emit('send', { text: text.value.trim(), images: [...images.value] })
  text.value = ''
  images.value = []
  closeSuggest()
  if (props.draftKey) composer.saveDraft(props.draftKey, { text: '', images: [] })
  void nextTick(resize)
}

function onInput(): void {
  resize()
  updateSuggest()
}

function onKeydown(event: KeyboardEvent): void {
  if (suggestKey(event)) return
  if (event.key !== 'Enter' || event.isComposing) return
  const enterSends = settings.settings.chat.enterSends
  if ((enterSends && !event.shiftKey) || (!enterSends && (event.ctrlKey || event.metaKey))) {
    event.preventDefault()
    send()
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

async function pickImages(): Promise<void> {
  const picked = await attempt(() => window.api.app.pickImages())
  if (picked) images.value.push(...picked)
}

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div
    :class="
      cn(
        'relative flex flex-col rounded-2xl border transition-colors focus-within:border-ring/60',
        floating ? 'bg-card/40 shadow-lg shadow-black/15 backdrop-blur-lg' : 'bg-card shadow-lg shadow-black/5',
        busy && canSend && 'border-dashed border-primary/60 focus-within:border-primary/80',
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
    <div v-if="images.length" class="flex flex-wrap gap-2 px-3 pt-3">
      <div v-for="(image, i) in images" :key="image" class="group/img relative">
        <img :src="fileImageUrl(image)" alt="" class="size-16 rounded-lg border object-cover" />
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
    <textarea
      ref="input"
      v-model="text"
      data-composer-input
      rows="1"
      :placeholder="placeholder"
      :disabled="disabled"
      class="max-h-[40vh] min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[0.95rem] leading-relaxed outline-none placeholder:text-muted-foreground/70"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="updateSuggest"
      @click="updateSuggest"
      @focus="onFocus"
      @blur="closeSuggest"
      @paste="onPaste"
    />
    <div class="flex items-center gap-1 px-2 pb-2">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="ghost" size="icon-sm" class="text-muted-foreground" aria-label="Bild anhängen" @click="pickImages">
            <PaperclipIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Bild anhängen (oder einfügen / hineinziehen)</TooltipContent>
      </Tooltip>
      <ComposerControls
        :provider="provider"
        :account="account"
        @update:provider="emit('update:provider', $event)"
        @update:account="emit('update:account', $event)"
      />
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
      <div class="ml-auto flex items-center gap-2">
        <Tooltip v-if="context?.window">
          <TooltipTrigger as-child>
            <span class="flex items-center">
              <UsageRing :percent="contextPercent" :size="18" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Kontext: {{ formatTokens(context.used) }} von {{ formatTokens(context.window) }} Tokens ({{ Math.round(contextPercent) }} %)</TooltipContent>
        </Tooltip>
        <Button v-if="busy && !canSend" size="icon-sm" variant="secondary" aria-label="Anhalten" @click="emit('stop')">
          <SquareIcon class="size-3 fill-current" />
        </Button>
        <!-- Into the running answer: it doesn't wait for the turn to end, so it looks unlike a new prompt. -->
        <template v-else-if="busy">
          <span class="hidden text-[0.75rem] font-medium text-primary sm:inline">In die laufende Antwort</span>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="In die laufende Antwort schicken"
            class="rounded-full border-dashed border-primary/70 text-primary hover:bg-primary/10 hover:text-primary"
            v-tooltip="'Schickt die Nachricht in die laufende Antwort; der Agent nimmt sie beim nächsten Schritt auf'"
            @click="send"
          >
            <CornerDownRightIcon />
          </Button>
        </template>
        <Button v-else size="icon-sm" :disabled="!canSend" aria-label="Senden" class="rounded-full" @click="send">
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
          :disabled="disabled"
          @update:model="emit('update:model', $event)"
          @update:effort="emit('update:effort', $event)"
          @update:mode="emit('update:mode', $event)"
          @update:ultracode="emit('update:ultracode', $event)"
        />
      </div>
    </div>
  </div>
</template>
