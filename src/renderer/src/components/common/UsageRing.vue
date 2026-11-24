<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { clampPercent, usageLevel, usageTextClass } from '@/lib/usage'
import { cn } from '@/lib/utils'

/**
 * Small circular gauge for a usage percentage, green, orange or red like the usage meters. `spinning`:
 * what it measures is being redone (the context compacted), so a turning arc stands in for the value.
 */
const props = withDefaults(defineProps<{ percent: number; size?: number; spinning?: boolean; class?: HTMLAttributes['class'] }>(), {
  size: 16,
})

const STROKE = 2.5
const radius = computed(() => (props.size - STROKE) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const value = computed(() => clampPercent(props.percent))
const level = computed(() => usageLevel(value.value))
</script>

<template>
  <svg
    aria-hidden="true"
    :width="size"
    :height="size"
    :viewBox="`0 0 ${size} ${size}`"
    :data-level="spinning ? undefined : level"
    :class="cn('shrink-0', spinning ? 'animate-spin text-primary' : ['-rotate-90', usageTextClass[level]], props.class)"
  >
    <circle :cx="size / 2" :cy="size / 2" :r="radius" fill="none" :stroke-width="STROKE" class="stroke-foreground/15" />
    <circle
      v-if="spinning"
      :cx="size / 2"
      :cy="size / 2"
      :r="radius"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      :stroke-width="STROKE"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="circumference * 0.7"
    />
    <circle
      v-else-if="value > 0"
      :cx="size / 2"
      :cy="size / 2"
      :r="radius"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      :stroke-width="STROKE"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="circumference * (1 - value / 100)"
      class="transition-[stroke-dashoffset] duration-500"
    />
  </svg>
</template>
