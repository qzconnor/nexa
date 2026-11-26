<script setup lang="ts">
import { ChevronRightIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import type { ContextDetail, ContextEntry, ContextPart, ContextUsage, ProviderId } from '@shared/chat'
import { PROVIDERS } from '@shared/providers'
import UsageRing from '@/components/common/UsageRing.vue'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDeviceApi } from '@/stores/device'

/**
 * The context ring of the composer; hovered, what fills the context by kind, as the CLI counts it
 * (Claude Code's `/context`): asked for each time the card opens, the last count shows meanwhile.
 */
/** `compacting`: the CLI summarizes the conversation right now; what the ring showed is about to shrink. */
const props = defineProps<{ sessionId?: string; provider: ProviderId; context: ContextUsage; busy?: boolean; compacting?: boolean }>()
/** The chat may be another device's: its CLI and shells run there. */
const api = useDeviceApi()

const detail = ref<ContextDetail | null>(null)
const loading = ref(false)
/** The CLI told nothing (Codex, or Claude Code not running): the card makes do with the total. */
const none = ref(false)

const used = computed(() => detail.value?.used ?? props.context.used)
const max = computed(() => detail.value?.window ?? props.context.window)
const percent = computed(() => (max.value ? (used.value / max.value) * 100 : 0))

async function load(): Promise<void> {
  const id = props.sessionId
  if (!id || loading.value) return
  loading.value = true
  try {
    const next = await api.sessions.context(id)
    if (id !== props.sessionId) return
    if (next) detail.value = next
    none.value = !next && !detail.value
  } catch {
    none.value = !detail.value
  } finally {
    loading.value = false
  }
}

// Another chat has another context.
watch(
  () => props.sessionId,
  () => {
    detail.value = null
    none.value = false
  },
)

function onOpen(open: boolean): void {
  if (open) void load()
}

/** Colours of the parts in the bar and the list, from the theme; the rest stays grey. */
const PART_COLORS: Record<string, string> = {
  system_prompt: 'bg-(--syn-yellow)',
  system_tools: 'bg-(--syn-blue)',
  mcp_tools: 'bg-(--syn-cyan)',
  mcp_instructions: 'bg-(--syn-green)',
  memory_files: 'bg-(--syn-magenta)',
  skills: 'bg-(--syn-red)',
  custom_agents: 'bg-(--tool-read)',
  messages: 'bg-primary',
}
const colorOf = (part: ContextPart) =>
  PART_COLORS[part.id] ?? (part.kind === 'free' ? 'bg-foreground/10' : part.kind === 'buffer' ? 'bg-muted-foreground/40' : 'bg-muted-foreground')

const usedParts = computed(() => (detail.value?.parts ?? []).filter((p) => p.kind === 'used' && p.tokens > 0))
const restParts = computed(() => (detail.value?.parts ?? []).filter((p) => p.kind === 'buffer' || p.kind === 'free'))
const deferredParts = computed(() => (detail.value?.parts ?? []).filter((p) => p.kind === 'deferred' && p.tokens > 0))
const buffer = computed(() => detail.value?.parts.find((p) => p.kind === 'buffer'))

const share = (tokens: number) => (max.value ? (tokens / max.value) * 100 : 0)
const formatShare = (tokens: number) => `${share(tokens).toLocaleString('de', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`
const formatCount = (n: number) => n.toLocaleString('de')

const groups = computed(() => {
  const d = detail.value
  if (!d) return []
  const list: { id: string; label: string; entries: ContextEntry[] }[] = []
  if (d.mcpServers?.length) list.push({ id: 'mcp', label: 'MCP-Server', entries: d.mcpServers })
  if (d.agents?.length) list.push({ id: 'agents', label: 'Eigene Agents', entries: d.agents })
  if (d.memoryFiles?.length) list.push({ id: 'memory', label: 'Anweisungsdateien', entries: d.memoryFiles })
  return list
})
const openGroup = ref<string | null>(null)
const fileName = (path: string) => path.split(/[\\/]/).slice(-2).join('/')
</script>

<template>
  <HoverCard :open-delay="250" :close-delay="120" @update:open="onOpen">
    <HoverCardTrigger as-child>
      <button
        type="button"
        class="flex items-center rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="compacting ? 'Kontext wird zusammengefasst' : 'Kontext'"
      >
        <UsageRing :percent="percent" :size="18" :spinning="compacting" />
      </button>
    </HoverCardTrigger>
    <HoverCardContent side="top" align="end" class="w-80 p-3">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-[0.8rem] font-medium">Kontext</span>
        <span class="text-[0.75rem] text-muted-foreground tabular-nums">{{ formatCount(used) }} / {{ formatCount(max) }}</span>
      </div>
      <div class="mt-0.5 text-[0.8rem]">{{ Math.round(percent) }} % genutzt</div>
      <p v-if="compacting" class="mt-1 text-[0.75rem] text-primary">Wird gerade zusammengefasst …</p>

      <!-- The parts side by side as they fill the window; the buffer for compacting at its end. -->
      <div class="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
        <template v-if="detail">
          <div v-for="part in usedParts" :key="part.id" :class="cn('h-full', colorOf(part))" :style="{ width: `${share(part.tokens)}%` }" />
          <div class="flex-1" />
          <div v-if="buffer" class="h-full bg-muted-foreground/35" :style="{ width: `${share(buffer.tokens)}%` }" />
        </template>
        <div v-else class="h-full bg-primary" :style="{ width: `${Math.min(100, percent)}%` }" />
      </div>

      <div v-if="detail" class="mt-3 flex max-h-[50vh] flex-col gap-0.5 overflow-y-auto text-[0.78rem]">
        <div v-for="part in usedParts" :key="part.id" class="flex items-center gap-2">
          <span :class="cn('size-2 shrink-0 rounded-[3px]', colorOf(part))" />
          <span class="min-w-0 flex-1 truncate">{{ part.name }}</span>
          <span class="text-muted-foreground tabular-nums">{{ formatCount(part.tokens) }}</span>
          <span class="w-12 text-right text-muted-foreground tabular-nums">{{ formatShare(part.tokens) }}</span>
        </div>
        <div class="my-1.5 border-t" />
        <div v-for="part in restParts" :key="part.id" class="flex items-center gap-2">
          <span :class="cn('size-2 shrink-0 rounded-[3px]', colorOf(part))" />
          <span class="min-w-0 flex-1 truncate">{{ part.name }}</span>
          <span class="text-muted-foreground tabular-nums">{{ formatCount(part.tokens) }}</span>
          <span class="w-12 text-right text-muted-foreground tabular-nums">{{ formatShare(part.tokens) }}</span>
        </div>
        <div
          v-for="part in deferredParts"
          :key="part.id"
          class="flex items-center gap-2 text-muted-foreground"
          v-tooltip="'Erst im Kontext, wenn der Agent sie sucht und lädt'"
        >
          <span class="size-2 shrink-0 rounded-[3px] border border-muted-foreground/50" />
          <span class="min-w-0 flex-1 truncate">{{ part.name }}</span>
          <span class="tabular-nums">{{ formatCount(part.tokens) }}</span>
          <span class="w-12 text-right">–</span>
        </div>
        <template v-if="groups.length">
          <div class="my-1.5 border-t" />
          <div v-for="group in groups" :key="group.id">
            <button
              type="button"
              class="flex w-full items-center gap-1.5 rounded py-0.5 text-left hover:text-foreground"
              :aria-expanded="openGroup === group.id"
              @click="openGroup = openGroup === group.id ? null : group.id"
            >
              <ChevronRightIcon :class="cn('size-3 shrink-0 transition-transform', openGroup === group.id && 'rotate-90')" />
              <span class="flex-1">{{ group.label }}</span>
              <span class="text-muted-foreground tabular-nums">{{ group.entries.length }}</span>
            </button>
            <div v-if="openGroup === group.id" class="mb-1 ml-4.5 flex flex-col gap-0.5 text-muted-foreground">
              <div v-for="entry in group.entries" :key="entry.name" class="flex items-center gap-2">
                <span class="min-w-0 flex-1 truncate" :title="entry.name">{{ group.id === 'memory' ? fileName(entry.name) : entry.name }}</span>
                <span v-if="entry.count !== undefined" class="tabular-nums" v-tooltip="'Werkzeuge im Kontext / insgesamt'">{{ entry.loaded ?? 0 }}/{{ entry.count }}</span>
                <span class="w-14 text-right tabular-nums">{{ formatTokens(entry.tokens) }}</span>
              </div>
            </div>
          </div>
        </template>
        <p v-if="detail.compactAt" class="mt-2 text-[0.72rem] text-muted-foreground">
          Zusammengefasst wird ab {{ formatCount(detail.compactAt) }} Tokens.
        </p>
      </div>
      <div v-else-if="loading" class="mt-3 flex flex-col gap-2">
        <Skeleton v-for="n in 5" :key="n" class="h-3" :style="{ width: `${90 - n * 9}%` }" />
      </div>
      <p v-else-if="none" class="mt-3 text-[0.75rem] text-muted-foreground">
        <template v-if="provider === 'claude'">Die Aufschlüsselung gibt es, solange {{ PROVIDERS.claude.name }} für diesen Chat läuft.</template>
        <template v-else>{{ PROVIDERS[provider].name }} nennt nur die Summe, keine Aufschlüsselung.</template>
      </p>
      <p v-if="busy && detail" class="mt-2 text-[0.72rem] text-muted-foreground">Stand der letzten Antwort; während der Agent arbeitet, wächst der Kontext.</p>
    </HoverCardContent>
  </HoverCard>
</template>
