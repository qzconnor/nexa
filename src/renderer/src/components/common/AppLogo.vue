<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<!-- The app icon (build/icon.svg) in the theme's colours: an N of two nodes joined by an edge. -->
<template>
  <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" :class="cn('size-5', props.class)">
    <rect x="1.5" y="1.5" width="29" height="29" rx="8" class="fill-primary" />
    <path d="M10 23V10L22 22V9" class="stroke-primary-foreground" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="10" cy="10" r="3.1" class="fill-primary-foreground" />
    <circle cx="22" cy="22" r="3.1" class="fill-primary-foreground" />
    <circle cx="10" cy="10" r="1.25" class="fill-primary" />
    <circle cx="22" cy="22" r="1.25" class="fill-primary" />
  </svg>
</template>
