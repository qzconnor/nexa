<script setup lang="ts">
import { computed } from 'vue'
import type { ChatItem } from '@shared/chat'
import RenderBlock from '@/components/render/RenderBlock.vue'
import { chatBlocks } from '@/lib/tools'
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
  <div class="flex flex-col">
    <template v-for="block in blocks" :key="block.type === 'tools' ? block.id : block.item.id">
      <ToolGroup v-if="block.type === 'tools'" :tools="block.tools" />
      <template v-else>
        <UserMessage v-if="block.item.kind === 'user'" :item="block.item" :show-provider="providerChanges.has(block.item.id)" />
        <div
          v-else-if="block.item.kind === 'assistant'"
          :class="block.item.phase === 'commentary' ? 'py-1 text-[0.92rem] text-foreground/85' : 'py-2'"
        >
          <Markdown :text="block.item.text" :streaming="block.item.streaming" />
        </div>
        <ThinkingBlock v-else-if="block.item.kind === 'thinking'" :item="block.item" />
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
