<script setup lang="ts">
import { provideDevice } from '@/stores/device'

/**
 * What is inside shows the things of `device` (another device's instance; null: this one's): its
 * components take that device's stores and window API (`useDevice`). Give it a `:key` of the device:
 * what it provides is read once, when the components inside are made.
 */
const props = defineProps<{ device: string | null }>()
provideDevice(props.device)
</script>

<template>
  <slot />
</template>
