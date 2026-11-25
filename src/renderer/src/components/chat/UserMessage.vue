<script setup lang="ts">
import { ClockIcon, PencilIcon } from '@lucide/vue'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import type { UserItem } from '@shared/chat'
import ImageViewer from '@/components/common/ImageViewer.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { fileImageUrl } from '@/lib/tools'
import { cn } from '@/lib/utils'
import { useSessionsStore } from '@/stores/sessions'
import { useUiStore } from '@/stores/ui'
import Markdown from './Markdown.vue'

/**
 * A prompt of the user, on the right; the CLI it went to is shown when the session switched. One sent
 * while the agent works waits faded below the chat (`queued`) until the CLI takes it up, then stands
 * in the chat where it did, as any other. Its pictures open large in Nexa's viewer. An `editable` one
 * can be changed in place and sent anew: what came after it goes (`sessions.edit`), while the agent
 * works (`busy`) its answer too. A message from another chat's agent (`from`) is outlined instead of
 * filled and names that chat, which it opens. The first one waiting can go now (`sendNow`): that stops
 * the turn, and the CLI takes the waiting prompts up at once (Claude Code as a turn of their own,
 * Antigravity CLI from Nexa's queue).
 */
const props = defineProps<{
  item: UserItem
  showProvider?: boolean
  queued?: boolean
  sendNow?: boolean
  sessionId?: string
  editable?: boolean
  busy?: boolean
}>()
const sessions = useSessionsStore()
const ui = useUiStore()
/** The sending chat as it is called now (renamed since, perhaps); gone: as it was called then. */
const sender = computed(() => {
  const from = props.item.from
  if (!from) return null
  const meta = sessions.get(from.sessionId)
  return { ...from, title: meta?.title ?? from.title, exists: !!meta }
})

function openSender(): void {
  if (!sender.value?.exists) return
  ui.view = 'chat'
  void attempt(() => sessions.open(sender.value!.sessionId), 'Session ließ sich nicht öffnen')
}
const viewing = ref<number | null>(null)
const editing = ref(false)
const draft = ref('')
const sending = ref(false)
const field = useTemplateRef<HTMLTextAreaElement>('field')

async function startEdit(): Promise<void> {
  draft.value = props.item.text
  editing.value = true
  await nextTick()
  field.value?.focus()
  field.value?.setSelectionRange(draft.value.length, draft.value.length)
}

async function submit(): Promise<void> {
  const text = draft.value.trim()
  if (!props.sessionId || sending.value || (!text && !props.item.images?.length)) return
  sending.value = true
  // The same text again asks for the answer anew. Its pictures go along.
  const sent = await attempt(async () => {
    await sessions.edit(props.sessionId!, props.item.id, { text, images: props.item.images })
    return true
  }, 'Senden fehlgeschlagen')
  sending.value = false
  if (sent) editing.value = false
}

const stopping = ref(false)

/** The message leaves the queue once the CLI takes it up, and this with it; until then it says so. */
async function sendNowClick(): Promise<void> {
  if (!props.sessionId || stopping.value) return
  stopping.value = true
  const stopped = await attempt(async () => {
    await sessions.interrupt(props.sessionId!)
    return true
  }, 'Abbrechen fehlgeschlagen')
  if (!stopped) stopping.value = false
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void submit()
  } else if (event.key === 'Escape') {
    // Not on to the chat, where Escape stops the agent.
    event.preventDefault()
    event.stopPropagation()
    editing.value = false
  }
}
</script>

<template>
  <div :class="cn('flex flex-col items-end gap-1.5', queued ? 'py-1.5' : 'py-3')">
    <button
      v-if="sender"
      type="button"
      :disabled="!sender.exists"
      class="flex max-w-[85%] items-center gap-1.5 rounded-md text-[0.72rem] text-muted-foreground outline-none enabled:hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      v-tooltip="sender.exists ? 'Von einem anderen Chat gesendet, nicht von dir. Klicken öffnet ihn.' : 'Von einem anderen Chat gesendet, den es nicht mehr gibt.'"
      @click="openSender"
    >
      <ProviderIcon :provider="sender.provider" class="size-3 shrink-0" />
      <span class="truncate">Nachricht von „{{ sender.title }}“</span>
    </button>
    <div v-if="item.images?.length" :class="cn('flex flex-wrap justify-end gap-2', queued && 'opacity-60')">
      <button
        v-for="(image, i) in item.images"
        :key="image"
        type="button"
        class="cursor-zoom-in rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Bild groß ansehen"
        @click="viewing = i"
      >
        <img :src="fileImageUrl(image)" alt="" draggable="false" class="max-h-40 max-w-60 rounded-lg border object-cover" />
      </button>
    </div>
    <div v-if="editing" class="flex w-full max-w-[85%] flex-col gap-1.5 rounded-2xl rounded-br-md bg-secondary p-2 ring-1 ring-ring/40">
      <textarea
        ref="field"
        v-model="draft"
        rows="1"
        aria-label="Prompt bearbeiten"
        class="field-sizing-content max-h-[50vh] min-h-9 w-full resize-none bg-transparent px-2 py-1 outline-none"
        :disabled="sending"
        @keydown="onKey"
      />
      <div class="flex items-center justify-between gap-3 pl-2">
        <span class="text-[0.72rem] text-muted-foreground">
          <template v-if="busy">Senden bricht ab, woran der Agent gerade arbeitet. </template>Was danach kam, fällt weg. Geänderte Dateien bleiben, wie
          sie sind.
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" :disabled="sending" @click="editing = false">Abbrechen</Button>
          <Button size="sm" :disabled="sending || (!draft.trim() && !item.images?.length)" @click="submit">
            <Spinner v-if="sending" data-icon="inline-start" />
            Senden
          </Button>
        </div>
      </div>
    </div>
    <div
      v-else-if="item.text"
      :class="
        cn(
          'group relative max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5',
          sender ? 'border border-border bg-transparent' : 'bg-secondary',
          queued && 'opacity-60',
        )
      "
    >
      <Markdown :text="item.text" breaks />
      <!-- Left of the bubble, so that it takes no room under every prompt. -->
      <Button
        v-if="editable && sessionId && !sender"
        variant="ghost"
        size="icon-xs"
        class="absolute top-1/2 right-full mr-1.5 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Prompt bearbeiten"
        v-tooltip="'Bearbeiten und neu senden'"
        @click="startEdit"
      >
        <PencilIcon />
      </Button>
    </div>
    <div v-if="queued" class="flex items-center gap-1.5 text-[0.72rem] text-muted-foreground">
      <span class="flex items-center gap-1" v-tooltip="'Gesendet, während der Agent arbeitet: Er nimmt sie bei seinem nächsten Schritt auf.'">
        <ClockIcon class="size-3" />
        Wartet
      </span>
      <template v-if="sendNow && sessionId">
        <span aria-hidden="true">·</span>
        <button
          type="button"
          :disabled="stopping"
          class="rounded-sm font-medium text-foreground/80 outline-none enabled:hover:text-foreground enabled:hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
          v-tooltip="'Bricht ab, woran der Agent gerade arbeitet, und schickt die Nachricht sofort'"
          @click="sendNowClick"
        >
          {{ stopping ? 'Wird gesendet …' : 'Jetzt senden' }}
        </button>
      </template>
    </div>
    <span v-else-if="showProvider" class="flex items-center gap-1 text-[0.7rem] text-muted-foreground">
      an <ProviderIcon :provider="item.provider" class="size-3" />
    </span>
    <ImageViewer v-if="item.images?.length" v-model:index="viewing" :images="item.images" />
  </div>
</template>
