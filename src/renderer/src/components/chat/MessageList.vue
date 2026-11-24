<script setup lang="ts">
import { ChevronsDownUpIcon, ChevronsUpDownIcon } from '@lucide/vue'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { ChatItem } from '@shared/chat'
import BrowserCard from '@/components/browser/BrowserCard.vue'
import RenderBlock from '@/components/render/RenderBlock.vue'
import { chatBlocks, type ChatBlock } from '@/lib/tools'
import { useSettingsStore } from '@/stores/settings'
import AgentCard from './AgentCard.vue'
import InteractionCard from './InteractionCard.vue'
import Markdown from './Markdown.vue'
import NoticeRow from './NoticeRow.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import TodoCard from './TodoCard.vue'
import ToolGroup from './ToolGroup.vue'
import ToolRow from './ToolRow.vue'
import TurnFooter from './TurnFooter.vue'
import UserMessage from './UserMessage.vue'

/** The timeline of one thread: the main chat, or (with `parentId`) a subagent's work. */
const props = defineProps<{ items: ChatItem[]; sessionId: string; parentId?: string | null }>()
const settings = useSettingsStore()

const blocks = computed(() => chatBlocks(props.items, props.parentId ?? null, settings.settings.chat.showThinking))
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

let adding = false
/** Adds the page before the shown blocks, keeping in view what the user was looking at. */
async function showOlder(): Promise<void> {
  // Folded, the page above the `/clear` comes only when the user opens it.
  if (!first.value || adding || (folded.value && first.value <= clearedAt.value)) return
  adding = true
  const el = scroller
  const fromBottom = el ? el.scrollHeight - el.scrollTop : 0
  anchor.value = keyOf(blocks.value[Math.max(0, first.value - PAGE)]!)
  await nextTick()
  if (el) el.scrollTop = el.scrollHeight - fromBottom
  adding = false
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
  const last = blocks.value.findLast((b) => b.type === 'browser')
  return last?.type === 'browser' ? last.id : null
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
      v-if="start > (folded ? clearedAt : 0)"
      type="button"
      data-find-skip
      class="mx-auto mb-2 rounded-full px-3 py-1 text-[0.78rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      @click="showOlder"
    >
      Ältere Nachrichten laden
    </button>
    <template v-for="block in shown" :key="keyOf(block)">
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
        />
        <div
          v-else-if="block.item.kind === 'assistant'"
          :class="block.item.phase === 'commentary' ? 'py-1.5 text-[0.92rem] text-foreground/85' : 'py-2.5'"
        >
          <Markdown :text="block.item.text" :streaming="block.item.streaming" />
        </div>
        <template v-else-if="block.item.kind === 'tool'">
          <RenderBlock v-if="block.item.render" :spec="block.item.render" />
          <ToolRow v-else :tool="block.item" />
        </template>
        <AgentCard v-else-if="block.item.kind === 'agent'" :item="block.item" />
        <InteractionCard v-else-if="block.item.kind === 'interaction'" :item="block.item" :session-id="sessionId" />
        <TodoCard v-else-if="block.item.kind === 'todo'" :item="block.item" />
        <NoticeRow v-else-if="block.item.kind === 'notice'" :item="block.item" />
        <TurnFooter v-else-if="block.item.kind === 'turn'" :item="block.item" />
      </template>
    </template>
  </div>
</template>
