<script setup lang="ts">
import { nextTick, useTemplateRef, watch } from 'vue'
import { Kbd } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import type { Suggestion, SuggestTrigger } from '@/lib/composer-suggest'
import { baseName, parentPath } from '@/lib/file-tree'
import { fileIcon } from '@/lib/file-icons'
import { cn } from '@/lib/utils'

/** The list over the composer that completes a command, a skill or a file at the cursor. */
const props = defineProps<{ kind: SuggestTrigger['kind']; items: Suggestion[]; active: number; loading?: boolean }>()
const emit = defineEmits<{ pick: [index: number]; hover: [index: number] }>()

const list = useTemplateRef<HTMLElement>('list')

// The row chosen with the keys stays in sight.
watch(
  () => props.active,
  async (index) => {
    await nextTick()
    list.value?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  },
)

const TITLES: Record<SuggestTrigger['kind'], string> = { command: 'Befehle', skill: 'Skills', file: 'Dateien' }
const EMPTY: Record<SuggestTrigger['kind'], string> = {
  command: 'Kein passender Befehl',
  skill: 'Kein passender Skill',
  file: 'Keine passende Datei',
}

const BADGES: Partial<Record<string, string>> = { mcp: 'MCP', skill: 'Skill' }
</script>

<template>
  <div class="overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg shadow-black/15" @mousedown.prevent>
    <div class="flex items-center gap-2 px-3 pt-2 pb-1 text-[0.72rem] text-muted-foreground">
      <span class="font-medium">{{ TITLES[kind] }}</span>
      <Spinner v-if="loading" class="size-3" />
      <span class="ml-auto flex items-center gap-1">
        <Kbd>↑</Kbd><Kbd>↓</Kbd> wählen · <Kbd>Tab</Kbd> übernehmen · <Kbd>Esc</Kbd> schließen
      </span>
    </div>
    <div ref="list" role="listbox" :aria-label="TITLES[kind]" class="max-h-72 overflow-y-auto px-1 pb-1">
      <div v-if="!items.length" class="px-2 py-2 text-[0.82rem] text-muted-foreground">
        {{ loading ? 'Wird geladen …' : EMPTY[kind] }}
      </div>
      <div
        v-for="(item, index) in items"
        :key="item.type === 'command' ? `${item.option.kind}:${item.option.name}` : item.path"
        role="option"
        :aria-selected="index === active"
        :data-index="index"
        :class="
          cn(
            'flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-[0.85rem]',
            index === active ? 'bg-accent text-accent-foreground' : 'text-foreground/90',
          )
        "
        @mousemove="index !== active && emit('hover', index)"
        @click="emit('pick', index)"
      >
        <template v-if="item.type === 'command'">
          <span class="max-w-[50%] shrink-0 truncate font-medium">{{ item.option.insert }}</span>
          <span v-if="item.option.argumentHint" class="max-w-[25%] shrink-0 truncate text-[0.78rem] text-muted-foreground">{{ item.option.argumentHint }}</span>
          <span class="min-w-0 flex-1 truncate text-[0.8rem] text-muted-foreground">{{ item.option.description }}</span>
          <span v-if="BADGES[item.option.kind]" class="shrink-0 rounded border px-1 text-[0.68rem] text-muted-foreground">
            {{ BADGES[item.option.kind] }}
          </span>
        </template>
        <template v-else>
          <component
            :is="fileIcon(item.path, { dir: item.dir, link: false, broken: false }).icon"
            :class="cn('size-3.5 shrink-0', fileIcon(item.path, { dir: item.dir, link: false, broken: false }).class)"
          />
          <span class="min-w-0 truncate">
            <span class="font-medium">{{ baseName(item.path) }}{{ item.dir ? '/' : '' }}</span>
            <span v-if="parentPath(item.path)" class="ml-2 text-[0.78rem] text-muted-foreground">{{ parentPath(item.path) }}</span>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>
