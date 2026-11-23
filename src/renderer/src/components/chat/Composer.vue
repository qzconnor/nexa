<script setup lang="ts">
import { ArrowUpIcon, PaperclipIcon, SquareIcon, XIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ContextUsage, PermissionMode, ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import UsageRing from '@/components/common/UsageRing.vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useProjectPath } from '@/composables/useProjectPath'
import { attempt } from '@/lib/errors'
import { FILE_TREE_DRAG_TYPE, mentionOf } from '@/lib/file-tree'
import { formatTokens } from '@/lib/format'
import { fileImageUrl } from '@/lib/tools'
import { cn } from '@/lib/utils'
import { useComposerStore } from '@/stores/composer'
import { useSettingsStore } from '@/stores/settings'
import ComposerControls from './ComposerControls.vue'

/**
 * Where prompts are written: text, pasted or dropped images, and below it the CLI, model, effort
 * and permission mode. While the agent works, sending steers it (Codex) or queues the prompt
 * (Claude), and the button next to it stops the turn.
 */
const props = defineProps<{
  provider: ProviderId
  /** The account of the chat for its CLI. */
  account?: string
  model: string
  effort: string
  mode: PermissionMode
  busy?: boolean
  context?: ContextUsage
  /** Kept per chat while it isn't sent. */
  draftKey?: string
  autofocus?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{
  send: [input: { text: string; images: string[] }]
  stop: []
  'update:provider': [ProviderId]
  'update:account': [string]
  'update:model': [string]
  'update:effort': [string]
  'update:mode': [PermissionMode]
}>()
const settings = useSettingsStore()

const composer = useComposerStore()
const { relative } = useProjectPath()
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

function send(): void {
  if (!canSend.value) return
  emit('send', { text: text.value.trim(), images: [...images.value] })
  text.value = ''
  images.value = []
  if (props.draftKey) composer.saveDraft(props.draftKey, { text: '', images: [] })
  void nextTick(resize)
}

function onKeydown(event: KeyboardEvent): void {
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
        'flex flex-col rounded-2xl border bg-card shadow-lg shadow-black/5 transition-colors focus-within:border-ring/60',
        dragging && 'border-primary bg-primary/5',
      )
    "
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
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
      rows="1"
      :placeholder="placeholder"
      :disabled="disabled"
      class="max-h-[40vh] min-h-12 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[0.95rem] leading-relaxed outline-none placeholder:text-muted-foreground/70"
      @input="resize"
      @keydown="onKeydown"
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
        :model="model"
        :effort="effort"
        :mode="mode"
        @update:provider="emit('update:provider', $event)"
        @update:account="emit('update:account', $event)"
        @update:model="emit('update:model', $event)"
        @update:effort="emit('update:effort', $event)"
        @update:mode="emit('update:mode', $event)"
      />
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
        <Button v-else size="icon-sm" :disabled="!canSend" aria-label="Senden" class="rounded-full" @click="send">
          <ArrowUpIcon />
        </Button>
      </div>
    </div>
  </div>
</template>
