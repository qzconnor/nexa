<script setup lang="ts">
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, RefreshCwIcon, SquareIcon } from '@lucide/vue'
import { computed, ref, useTemplateRef } from 'vue'
import MessageList from '@/components/chat/MessageList.vue'
import UserMessage from '@/components/chat/UserMessage.vue'
import ProviderIcon from '@/components/common/ProviderIcon.vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useStickToBottom } from '@/composables/useStickToBottom'
import { attempt } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useRemoteStore } from '@/stores/remote'
import { useSessionsStore } from '@/stores/sessions'

/**
 * The chat of another device that the page „Geräte“ shows: its history as on that device (pictures
 * and the pages of MCP Apps stay there), and as far as the device allows a field for prompts and the
 * button to stop its agent. Its questions are answered in the chat as usual; the device decides.
 */
const props = defineProps<{ deviceName: string }>()
const remote = useRemoteStore()
const sessions = useSessionsStore()

const id = computed(() => remote.openId!)
const meta = computed(() => remote.openMeta)
const chat = computed(() => sessions.chats.get(id.value))
const items = computed(() => chat.value?.items ?? [])
const runtime = computed(() => sessions.runtime(id.value))
const busy = computed(() => ['starting', 'running', 'waiting'].includes(runtime.value.status))
const page = computed(() => remote.openPage)

const viewport = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const { atBottom, scrollToBottom } = useStickToBottom(viewport, content)

const working = computed(() => {
  if (runtime.value.status === 'waiting') return 'Wartet auf eine Antwort'
  return busy.value ? 'Arbeitet …' : null
})

async function older(): Promise<void> {
  await attempt(() => remote.loadOlder(), 'Ältere Nachrichten ließen sich nicht laden')
}

// --- Composer --------------------------------------------------------------------------------------

const draft = ref('')
const sending = ref(false)
const stopping = ref(false)
const field = useTemplateRef<HTMLTextAreaElement>('field')

async function send(): Promise<void> {
  const text = draft.value.trim()
  if (!text || sending.value) return
  sending.value = true
  const sent = await attempt(async () => {
    await remote.send(text)
    return true
  }, `An „${props.deviceName}“ nicht gesendet`)
  sending.value = false
  if (sent) {
    draft.value = ''
    scrollToBottom(true)
  }
  field.value?.focus()
}

async function stop(): Promise<void> {
  if (stopping.value) return
  stopping.value = true
  await attempt(() => sessions.interrupt(id.value), 'Abbrechen fehlgeschlagen')
  stopping.value = false
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void send()
  }
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b px-4">
      <ProviderIcon v-if="meta" :provider="meta.provider" class="size-4 shrink-0" />
      <span class="min-w-0 truncate text-sm font-medium" :title="meta?.title">{{ meta?.title ?? 'Chat' }}</span>
      <span class="shrink-0 text-xs text-muted-foreground">auf {{ deviceName }}</span>
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Neu laden" v-tooltip="'Neu laden'" :disabled="remote.host?.loading" @click="remote.reload()">
          <RefreshCwIcon :class="cn(remote.host?.loading && 'animate-spin')" />
        </Button>
      </div>
    </div>

    <div class="@container relative min-h-0 flex-1">
      <div ref="viewport" class="h-full overflow-y-auto [scrollbar-gutter:stable]">
        <div ref="content" class="mx-auto w-full max-w-(--chat-width) px-6 pt-6 pb-6">
          <p v-if="remote.host?.error" class="selectable my-2 rounded-lg bg-destructive/10 px-3 py-2 text-[0.82rem] text-destructive">{{ remote.host.error }}</p>
          <div v-else-if="!chat?.loaded" class="flex justify-center py-10"><Spinner class="size-5 text-muted-foreground" /></div>
          <template v-else>
            <button
              v-if="page && page.start > 0"
              type="button"
              :disabled="page.loadingOlder"
              class="mx-auto mb-2 flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.78rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              @click="older"
            >
              <Spinner v-if="page.loadingOlder" class="size-3" />
              Ältere vom Gerät laden <span class="tabular-nums opacity-80">· noch {{ page.start }}</span>
            </button>
            <MessageList :items="items" :session-id="id" />
          </template>
          <div v-if="working" class="flex items-center gap-2 py-2 text-[0.85rem] text-muted-foreground">
            <Spinner class="size-3.5 text-primary" />
            <span class="text-shimmer text-shimmer-accent">{{ working }}</span>
          </div>
          <UserMessage v-for="prompt in runtime.queued" :key="prompt.id" :item="prompt" queued />
        </div>
      </div>
      <Button
        v-if="!atBottom"
        variant="outline"
        size="icon-sm"
        class="absolute bottom-3 left-[calc(50%-5px)] -translate-x-1/2 rounded-full bg-popover/80 shadow-md backdrop-blur-md"
        aria-label="Nach unten"
        @click="scrollToBottom(true)"
      >
        <ArrowDownIcon />
      </Button>
    </div>

    <div class="mx-auto w-full max-w-(--chat-width) shrink-0 px-6 pb-5">
      <div v-if="remote.can('prompt')" class="flex items-end gap-2 rounded-xl border bg-card px-3 py-2 shadow-sm focus-within:ring-3 focus-within:ring-ring/30">
        <textarea
          ref="field"
          v-model="draft"
          rows="1"
          class="field-sizing-content max-h-48 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          :placeholder="`Prompt an „${deviceName}“ …`"
          :disabled="sending"
          @keydown="onKey"
        />
        <Button v-if="busy" variant="outline" size="icon-sm" aria-label="Agent anhalten" v-tooltip="'Agent anhalten'" :disabled="stopping" @click="stop">
          <SquareIcon class="fill-current" />
        </Button>
        <Button size="icon-sm" aria-label="Senden" :disabled="sending || !draft.trim()" @click="send">
          <Spinner v-if="sending" />
          <ArrowUpIcon v-else />
        </Button>
      </div>
      <p v-else class="flex items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-center text-xs text-muted-foreground">
        <EyeIcon class="size-3.5 shrink-0" />
        Nur mitlesen. Prompts erlaubst du auf „{{ deviceName }}“ unter Einstellungen › Geräte › Fernsteuerung.
      </p>
    </div>
  </div>
</template>
