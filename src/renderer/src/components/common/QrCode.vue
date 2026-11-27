<script setup lang="ts">
import { computed } from 'vue'
import { qrPath } from '@/lib/qr'

const props = defineProps<{ value: string; label: string }>()

const qr = computed(() => qrPath(props.value))
</script>

<template>
  <!-- Dark on light in every theme: a phone's camera reads a QR code reliably only that way round. -->
  <svg
    :viewBox="`0 0 ${qr.size} ${qr.size}`"
    role="img"
    :aria-label="label"
    shape-rendering="crispEdges"
    class="bg-white text-black"
  >
    <path :d="qr.d" fill="currentColor" />
  </svg>
</template>
