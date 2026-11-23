<script setup lang="ts">
import { VisArea, VisAxis, VisCrosshair, VisDonut, VisGroupedBar, VisLine, VisSingleContainer, VisStackedBar, VisTooltip, VisXYContainer } from '@unovis/vue'
import { Donut } from '@unovis/ts'
import { computed } from 'vue'
import type { RenderSpec } from '@shared/chat'
import { ChartContainer, ChartLegendContent, type ChartConfig } from '@/components/ui/chart'

type ChartSpec = Extract<RenderSpec, { type: 'chart' }>
interface Row {
  index: number
  label: string
  values: number[]
}

/** A chart the agent drew with `render_chart`: bars, lines, areas or a pie in the theme's colours. */
const props = defineProps<{ spec: ChartSpec }>()

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']
const color = (i: number) => PALETTE[i % PALETTE.length]

const series = computed(() => props.spec.series)
const config = computed<ChartConfig>(() => Object.fromEntries(series.value.map((s, i) => [s.key, { label: s.label ?? s.key, color: color(i) }])))
const rows = computed<Row[]>(() =>
  props.spec.data.map((d, index) => ({
    index,
    label: String(d[props.spec.x] ?? index + 1),
    values: series.value.map((s) => Number(d[s.key]) || 0),
  })),
)
const y = computed(() => series.value.map((_, i) => (d: Row) => d.values[i]))
const colors = computed(() => series.value.map((_, i) => color(i)))

const number = new Intl.NumberFormat('de', { maximumFractionDigits: 2 })
const fmt = (value: number) => `${number.format(value)}${props.spec.unit ? ` ${props.spec.unit}` : ''}`
const tickValues = computed(() => {
  const n = rows.value.length
  const step = Math.max(1, Math.ceil(n / 10))
  return rows.value.filter((_, i) => i % step === 0).map((r) => r.index)
})
const formatX = (index: number) => rows.value[Math.round(index)]?.label ?? ''

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
function tooltip(d: Row): string {
  const lines = series.value
    .map(
      (s, i) =>
        `<div style="display:flex;gap:8px;align-items:center"><span style="width:8px;height:8px;border-radius:2px;background:${color(i)}"></span><span style="opacity:.75">${escape(s.label ?? s.key)}</span><span style="margin-left:auto;font-weight:600">${escape(fmt(d.values[i]))}</span></div>`,
    )
    .join('')
  return `<div style="background:var(--popover);color:var(--popover-foreground);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px;min-width:140px"><div style="font-weight:600;margin-bottom:4px">${escape(d.label)}</div>${lines}</div>`
}

// Pie and donut: one series, one slice per row.
const pieTotal = computed(() => rows.value.reduce((sum, r) => sum + (r.values[0] ?? 0), 0))
const pieTooltip = {
  [Donut.selectors.segment]: (d: { data: Row }) =>
    tooltip({ ...d.data, values: d.data.values }) + '',
}
const pieConfig = computed<ChartConfig>(() => Object.fromEntries(rows.value.map((r, i) => [r.label, { label: r.label, color: color(i) }])))
</script>

<template>
  <div class="flex flex-col gap-2">
    <template v-if="spec.chart === 'pie' || spec.chart === 'donut'">
      <ChartContainer :config="pieConfig" class="aspect-auto h-64 w-full">
        <VisSingleContainer :data="rows" :margin="{ top: 8, bottom: 8 }">
          <VisDonut
            :value="(d: Row) => d.values[0]"
            :color="(_: Row, i: number) => color(i)"
            :arc-width="spec.chart === 'donut' ? 28 : 0"
            :pad-angle="0.01"
            :corner-radius="3"
            :central-label="spec.chart === 'donut' ? fmt(pieTotal) : undefined"
          />
          <VisTooltip :triggers="pieTooltip" />
        </VisSingleContainer>
        <ChartLegendContent />
      </ChartContainer>
    </template>
    <ChartContainer v-else :config="config" class="aspect-auto h-64 w-full" cursor>
      <VisXYContainer :data="rows" :padding="{ top: 8 }" :margin="{ left: 4, right: 8 }">
        <template v-if="spec.chart === 'bar'">
          <VisStackedBar v-if="spec.stacked" :x="(d: Row) => d.index" :y="y" :color="colors" :rounded-corners="3" :bar-padding="0.25" />
          <VisGroupedBar v-else :x="(d: Row) => d.index" :y="y" :color="colors" :rounded-corners="3" :group-padding="0.2" :bar-padding="0.1" />
        </template>
        <VisArea v-else-if="spec.chart === 'area'" :x="(d: Row) => d.index" :y="y" :color="colors" :opacity="0.35" />
        <VisLine v-if="spec.chart === 'line' || spec.chart === 'area'" :x="(d: Row) => d.index" :y="y" :color="colors" :line-width="2" />
        <VisAxis type="x" :x="(d: Row) => d.index" :tick-values="tickValues" :tick-format="formatX" :tick-line="false" :domain-line="false" :grid-line="false" />
        <VisAxis type="y" :num-ticks="4" :tick-format="fmt" :tick-line="false" :domain-line="false" />
        <VisTooltip />
        <VisCrosshair :x="(d: Row) => d.index" :y="y" :template="tooltip" color="#0000" />
      </VisXYContainer>
      <ChartLegendContent v-if="series.length > 1" />
    </ChartContainer>
  </div>
</template>
