<script setup lang="ts">
/**
 * The level of the voice input while one speaks: the last two seconds from left to right, a dot for
 * silence and a bar for sound, as high as it is loud. It fades out to the left.
 */
defineProps<{
  levels: readonly number[]
  /** The take is over and the last words are coming: the meter rests. */
  resting?: boolean
}>()

/** Below this a piece counts as silence (room noise, breath). */
const QUIET = 0.12
</script>

<template>
  <div
    :class="['voice-meter flex h-5 items-center gap-[3px] transition-opacity duration-300', resting && 'opacity-40']"
    role="meter"
    aria-label="Lautstärke der Aufnahme"
    :aria-valuenow="Math.round((levels[levels.length - 1] ?? 0) * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <span
      v-for="(level, i) in levels"
      :key="i"
      class="w-[3px] shrink-0 rounded-full bg-muted-foreground transition-[height] duration-75"
      :style="{ height: level < QUIET ? '3px' : `${Math.round(6 + level * 12)}px` }"
    />
  </div>
</template>

<style scoped>
.voice-meter {
  mask-image: linear-gradient(to right, transparent, black 30%);
}
</style>
