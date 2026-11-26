<script setup lang="ts">
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, useTemplateRef, watch } from 'vue'
import type { ChatItem } from '@shared/chat'
import BrowserCard from '@/components/browser/BrowserCard.vue'
import RenderBlock from '@/components/render/RenderBlock.vue'
import { Spinner } from '@/components/ui/spinner'
import { attempt } from '@/lib/errors'
import { formatDay, sameDay } from '@/lib/format'
import { chatBlocks, type ChatBlock } from '@/lib/tools'
import { useDevice } from '@/stores/device'
import { useSessionsStore } from '@/stores/sessions'
import { useSettingsStore } from '@/stores/settings'
import AgentCard from './AgentCard.vue'
import AssistantMessage from './AssistantMessage.vue'
import InteractionCard from './InteractionCard.vue'
import McpAppBlock from './McpAppBlock.vue'
import NoticeRow from './NoticeRow.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import TodoCard from './TodoCard.vue'
import ToolGroup from './ToolGroup.vue'
import ToolRow from './ToolRow.vue'
import TurnFooter from './TurnFooter.vue'
import UserMessage from './UserMessage.vue'
import UserShellBlock from './UserShellBlock.vue'

/** The timeline of one thread: the main chat, or (with `parentId`) a subagent's work. */
const props = defineProps<{ items: ChatItem[]; sessionId: string; parentId?: string | null }>()
const settings = useSettingsStore()
const sessions = useSessionsStore()
/** The chat of another device (Remote Control), or null for this one's. */
const device = useDevice()

/**
 * Built anew when an item comes, goes or is replaced, not for every piece of streamed text: the texts
 * are read past Vue, and only their first words count (`textShown`). The streaming answer's own
 * component follows its text.
 */
const blocks = computed(() => {
  void sessions.chats.get(props.sessionId)?.textShown
  return chatBlocks(props.items, props.parentId ?? null, settings.settings.chat.showThinking, (item) => !!toRaw(item).text.trim())
})
// A long chat renders its newest blocks only and older ones as the user scrolls up: hundreds of
// Markdown blocks with highlighted code take seconds to lay out, the last screens are what is read.
const PAGE = 40
/** How close (px) the top of what is shown may come before the next page is added. */
const LOAD_AHEAD = 1200

function keyOf(block: ChatBlock): string {
  return block.type === 'item' ? block.item.id : block.id
}

/** The key of the oldest block shown; a key, not an index, so blocks coming in don't move the window. */
const anchor = ref<string | null>(null)
const first = computed(() => {
  const list = blocks.value
  const at = anchor.value === null ? -1 : list.findIndex((b) => keyOf(b) === anchor.value)
  // Not placed yet, or gone (another chat, a rewind): the newest page.
  return at >= 0 ? at : Math.max(0, list.length - PAGE)
})
/**
 * The last `/clear` of the main thread: what is above it no CLI knows any more, so it stays folded
 * until the user opens it. -1 without one (or with nothing above it).
 */
const clearedAt = computed(() =>
  props.parentId ? -1 : blocks.value.findLastIndex((b) => b.type === 'item' && b.item.kind === 'notice' && !!b.item.cleared),
)
const earlierOpen = ref(false)
const folded = computed(() => clearedAt.value > 0 && !earlierOpen.value)
/** The first block shown: the page, folded not above the `/clear`. */
const start = computed(() => (folded.value ? Math.max(first.value, clearedAt.value) : first.value))
const shown = computed(() => (start.value ? blocks.value.slice(start.value) : blocks.value))
const clearedKey = computed(() => (clearedAt.value > 0 ? keyOf(blocks.value[clearedAt.value]!) : null))
/** The prompts above the `/clear`, for its button. */
const earlierPrompts = computed(() =>
  blocks.value.slice(0, Math.max(0, clearedAt.value)).filter((b) => b.type === 'item' && b.item.kind === 'user').length,
)

watch(
  () => [props.sessionId, blocks.value.length] as const,
  ([id], before) => {
    if (id !== before?.[0]) {
      anchor.value = null
      earlierOpen.value = false
    }
    const list = blocks.value
    if (anchor.value === null && list.length) anchor.value = keyOf(list[first.value]!)
    if (id !== before?.[0]) void nextTick(watchTop)
  },
  { immediate: true },
)

const root = useTemplateRef<HTMLElement>('root')
const top = useTemplateRef<HTMLElement>('top')
let scroller: HTMLElement | null = null
let observer: IntersectionObserver | null = null

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node
  }
  return null
}

/** Observes the top again: its first answer says whether it is still within reach after a change. */
function watchTop(): void {
  if (!observer || !top.value) return
  observer.unobserve(top.value)
  observer.observe(top.value)
}

/** Another device's chat with items before the ones here (main thread only: a subagent's are in its parent's turn). */
const chat = computed(() => sessions.chats.get(props.sessionId))
const olderThere = computed(() => (props.parentId ? 0 : (chat.value?.older ?? 0)))

let adding = false
/**
 * Adds the page before the shown blocks, keeping in view what the user was looking at. All of them
 * shown, another device's chat first gets the items before them from there.
 */
async function showOlder(): Promise<void> {
  // Folded, the page above the `/clear` comes only when the user opens it.
  if (adding || (folded.value && first.value <= clearedAt.value)) return
  if (!first.value && !olderThere.value) return
  adding = true
  try {
    const el = scroller
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0
    if (!first.value) {
      await attempt(() => sessions.loadOlder(props.sessionId), 'Ältere Nachrichten ließen sich nicht holen')
      // The window stays at its oldest block, which now has the ones that came before it.
      await nextTick()
      if (!first.value) return
    }
    anchor.value = keyOf(blocks.value[Math.max(0, first.value - PAGE)]!)
    await nextTick()
    if (el) el.scrollTop = el.scrollHeight - fromBottom
  } finally {
    adding = false
  }
  watchTop()
}

onMounted(() => {
  scroller = scrollParent(root.value)
  // Measured after the chat has scrolled to its end (its ResizeObserver runs before these answers).
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.at(-1)?.isIntersecting) void showOlder()
    },
    {
      root: scroller,
      rootMargin: `${LOAD_AHEAD}px 0px 0px 0px`,
    },
  )
  watchTop()
})

onBeforeUnmount(() => observer?.disconnect())
// Another device's chat that came with its newest items: the top may be in reach already (a short last page).
watch(olderThere, (count, before) => {
  if (count && !before) void nextTick(watchTop)
})

/** All blocks at once, for the search in the chat, also those above a `/clear`; what the user was looking at stays in view. */
async function showAll(): Promise<void> {
  if (!start.value) return
  const el = scroller
  const fromBottom = el ? el.scrollHeight - el.scrollTop : 0
  earlierOpen.value = true
  anchor.value = keyOf(blocks.value[0]!)
  await nextTick()
  if (el) el.scrollTop = el.scrollHeight - fromBottom
}

/**
 * Opens or folds what is above the `/clear`, keeping the divider where it is on screen. Opened, the
 * last page before it shows and older ones come as the user scrolls up.
 */
async function toggleEarlier(): Promise<void> {
  const el = scroller
  const fromBottom = el ? el.scrollHeight - el.scrollTop : 0
  earlierOpen.value = !earlierOpen.value
  if (earlierOpen.value && first.value > clearedAt.value - PAGE) anchor.value = keyOf(blocks.value[Math.max(0, clearedAt.value - PAGE)]!)
  await nextTick()
  if (el) el.scrollTop = el.scrollHeight - fromBottom
  watchTop()
}

/** Blocks not shown yet (older ones above the page, or above a folded `/clear`). */
const hidden = computed(() => start.value)

defineExpose({ hidden, showAll })

/** The newest browser card shows the page live; the others as it was when they ended. */
const liveBrowser = computed(() => {
  // The browser of another device's chat runs there; here only the pictures in its cards show.
  if (device) return null
  const last = blocks.value.findLast((b) => b.type === 'browser')
  return last?.type === 'browser' ? last.id : null
})

/**
 * The prompts that can be changed and sent anew: the main thread's below the last `/clear` (above it
 * no CLI knows the chat any more). Also while the agent works (`busy`): sending one ends its turn.
 */
const editable = computed(() => {
  if (props.parentId) return new Set<string>()
  return new Set(blocks.value.slice(clearedAt.value + 1).flatMap((b) => (b.type === 'item' && b.item.kind === 'user' ? [b.item.id] : [])))
})
const busy = computed(() => {
  const status = sessions.runtime(props.sessionId).status
  return status === 'running' || status === 'starting' || status === 'waiting'
})

/** The model a turn ran with shows at the first turn and where it differs from the turn before. */
const modelChanges = computed(() => {
  const ids = new Set<string>()
  let last: string | undefined
  for (const item of props.items) {
    if (item.kind !== 'turn' || item.parentId || !item.model) continue
    if (item.model !== last) ids.add(item.id)
    last = item.model
  }
  return ids
})

function startOf(block: ChatBlock): number {
  if (block.type === 'item') return block.item.ts
  return block.type === 'thinking' ? block.items[0]!.ts : block.tools[0]!.ts
}

/**
 * The day above the first block of it („Heute“, „Gestern“, a date), in the main thread. A chat of
 * today alone has none: the day only says something once there are others.
 */
const days = computed(() => {
  const out = new Map<string, string>()
  if (props.parentId) return out
  const now = Date.now()
  let last: number | null = null
  for (const block of blocks.value) {
    const ts = startOf(block)
    if (!ts) continue
    if (last === null ? !sameDay(ts, now) : !sameDay(ts, last)) out.set(keyOf(block), formatDay(ts, now))
    last = ts
  }
  return out
})

/** The CLI a prompt went to shows when it differs from the one before. */
const providerChanges = computed(() => {
  const ids = new Set<string>()
  let last: string | null = null
  for (const item of props.items) {
    if (item.kind !== 'user' || item.parentId) continue
    if (last && item.provider !== last) ids.add(item.id)
    last = item.provider
  }
  return ids
})
</script>

<template>
  <!-- Its children are what the search in the chat reads, each as one text (useDomFind). -->
  <div ref="root" class="flex flex-col" data-find-blocks>
    <div ref="top" />
    <button
      v-if="start > (folded ? clearedAt : 0) || (!folded && olderThere > 0)"
      type="button"
      data-find-skip
      class="mx-auto mb-2 flex items-center gap-2 rounded-full px-3 py-1 text-[0.78rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none"
      :disabled="chat?.loadingOlder"
      @click="showOlder"
    >
      <template v-if="chat?.loadingOlder">
        <Spinner class="size-3" />
        Ältere Nachrichten werden geholt …
      </template>
      <template v-else>Ältere Nachrichten laden</template>
    </button>
    <template v-for="block in shown" :key="keyOf(block)">
      <div v-if="days.has(keyOf(block))" data-find-skip class="flex items-center gap-3 py-2 text-[0.72rem] text-muted-foreground" role="separator">
        <span class="h-px flex-1 bg-border" />
        {{ days.get(keyOf(block)) }}
        <span class="h-px flex-1 bg-border" />
      </div>
      <!-- Right above the divider of the last /clear: open or fold what came before it. -->
      <button
        v-if="keyOf(block) === clearedKey"
        type="button"
        data-find-skip
        :aria-expanded="!folded"
        class="mx-auto mt-1 flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.78rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="toggleEarlier"
      >
        <component :is="folded ? ChevronsUpDownIcon : ChevronsDownUpIcon" class="size-3.5" />
        {{ folded ? 'Früheren Verlauf anzeigen' : 'Früheren Verlauf einklappen' }}
        <span v-if="folded && earlierPrompts" class="tabular-nums opacity-80">· {{ earlierPrompts }} {{ earlierPrompts === 1 ? 'Nachricht' : 'Nachrichten' }}</span>
      </button>
      <ToolGroup v-if="block.type === 'tools'" :tools="block.tools" />
      <BrowserCard v-else-if="block.type === 'browser'" :tools="block.tools" :block-id="block.id" :session-id="sessionId" :live="block.id === liveBrowser" />
      <ThinkingBlock v-else-if="block.type === 'thinking'" :items="block.items" />
      <template v-else>
        <UserMessage
          v-if="block.item.kind === 'user'"
          :item="block.item"
          :show-provider="providerChanges.has(block.item.id)"
          :session-id="sessionId"
          :editable="editable.has(block.item.id)"
          :busy="busy"
        />
        <AssistantMessage v-else-if="block.item.kind === 'assistant'" :item="block.item" />
        <template v-else-if="block.item.kind === 'tool'">
          <RenderBlock v-if="block.item.render" :spec="block.item.render" />
          <UserShellBlock v-else-if="block.item.byUser" :tool="block.item" :session-id="sessionId" />
          <!-- An MCP app's frame talks to its server on the device the chat runs on: another one's shows as a tool. -->
          <McpAppBlock v-else-if="block.item.app" :tool="block.item" :session-id="sessionId" />
          <ToolRow v-else :tool="block.item" />
        </template>
        <AgentCard v-else-if="block.item.kind === 'agent'" :item="block.item" />
        <InteractionCard v-else-if="block.item.kind === 'interaction'" :item="block.item" :session-id="sessionId" />
        <TodoCard v-else-if="block.item.kind === 'todo'" :item="block.item" />
        <NoticeRow v-else-if="block.item.kind === 'notice'" :item="block.item" />
        <TurnFooter v-else-if="block.item.kind === 'turn'" :item="block.item" :show-model="modelChanges.has(block.item.id)" />
      </template>
    </template>
  </div>
</template>
