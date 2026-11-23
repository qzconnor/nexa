<script setup lang="ts">
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, MinusIcon, TrendingDownIcon, TrendingUpIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed, defineAsyncComponent } from 'vue'
import type { RenderSpec } from '@shared/chat'
import Markdown from '@/components/chat/Markdown.vue'
import { cn } from '@/lib/utils'

/**
 * What an agent draws with Nexa's MCP tools (render_chart, render_diagram, …), straight in the chat:
 * the tool's input is the drawing, so it shows as soon as the call is made.
 */
const props = defineProps<{ spec: RenderSpec }>()

const ChartBlock = defineAsyncComponent(() => import('./ChartBlock.vue'))
const DiagramBlock = defineAsyncComponent(() => import('./DiagramBlock.vue'))

const title = computed(() => ('title' in props.spec ? props.spec.title : undefined))
const description = computed(() => ('description' in props.spec ? props.spec.description : undefined))
const calloutIcon = computed(() =>
  props.spec.type === 'callout' ? { info: InfoIcon, success: CircleCheckIcon, warning: TriangleAlertIcon, danger: CircleAlertIcon }[props.spec.tone] : InfoIcon,
)
const codeText = computed(() => (props.spec.type === 'code' ? `\`\`\`${props.spec.language ?? ''}\n${props.spec.code}\n\`\`\`` : ''))
const cell = (value: unknown) => (value === null || value === undefined ? '' : typeof value === 'number' ? value.toLocaleString('de') : String(value))
</script>

<template>
  <!-- Callouts are a coloured box of their own. -->
  <div
    v-if="spec.type === 'callout'"
    :class="
      cn(
        'my-2 flex gap-3 rounded-xl border px-4 py-3',
        spec.tone === 'info' && 'border-chart-2/40 bg-chart-2/8',
        spec.tone === 'success' && 'border-success/40 bg-success/8',
        spec.tone === 'warning' && 'border-warning/40 bg-warning/8',
        spec.tone === 'danger' && 'border-destructive/40 bg-destructive/8',
      )
    "
  >
    <component
      :is="calloutIcon"
      :class="
        cn(
          'mt-0.5 size-4 shrink-0',
          spec.tone === 'info' && 'text-chart-2',
          spec.tone === 'success' && 'text-success',
          spec.tone === 'warning' && 'text-warning',
          spec.tone === 'danger' && 'text-destructive',
        )
      "
    />
    <div class="min-w-0 text-[0.9rem]">
      <div v-if="spec.title" class="mb-0.5 font-medium">{{ spec.title }}</div>
      <Markdown :text="spec.text" />
    </div>
  </div>

  <figure v-else class="my-2 overflow-hidden rounded-xl border bg-card/60">
    <figcaption v-if="title || description" class="border-b px-4 py-2.5">
      <div v-if="title" class="text-[0.9rem] font-medium">{{ title }}</div>
      <div v-if="description" class="text-[0.8rem] text-muted-foreground">{{ description }}</div>
    </figcaption>
    <div :class="spec.type === 'table' ? '' : 'px-4 py-3'">
      <ChartBlock v-if="spec.type === 'chart'" :spec="spec" />
      <DiagramBlock v-else-if="spec.type === 'diagram'" :spec="spec" />
      <div v-else-if="spec.type === 'table'" class="selectable max-h-[28rem] overflow-auto">
        <table class="w-full border-collapse text-[0.84rem]">
          <thead class="sticky top-0 bg-card">
            <tr>
              <th
                v-for="column in spec.columns"
                :key="column.key"
                :class="cn('border-b px-3 py-2 font-medium whitespace-nowrap text-muted-foreground', column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left')"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in spec.rows" :key="i" class="hover:bg-muted/40">
              <td
                v-for="column in spec.columns"
                :key="column.key"
                :class="cn('border-b border-border/50 px-3 py-1.5 tabular-nums', column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left')"
              >
                {{ cell(row[column.key]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="spec.type === 'stats'" class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
        <div v-for="stat in spec.items" :key="stat.label" class="flex flex-col gap-0.5 rounded-lg border bg-background/40 px-3 py-2.5">
          <span class="text-[0.75rem] text-muted-foreground">{{ stat.label }}</span>
          <span class="flex items-center gap-1.5 text-xl font-semibold tabular-nums">
            {{ stat.value }}
            <TrendingUpIcon v-if="stat.trend === 'up'" class="size-4 text-success" />
            <TrendingDownIcon v-else-if="stat.trend === 'down'" class="size-4 text-destructive" />
            <MinusIcon v-else-if="stat.trend === 'flat'" class="size-4 text-muted-foreground" />
          </span>
          <span v-if="stat.hint" class="text-[0.72rem] text-muted-foreground">{{ stat.hint }}</span>
        </div>
      </div>
      <Markdown v-else-if="spec.type === 'code'" :text="codeText" />
    </div>
  </figure>
</template>
