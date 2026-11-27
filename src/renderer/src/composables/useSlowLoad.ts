import { onScopeDispose, readonly, ref, watch, type Ref } from 'vue'

/**
 * True once `pending` has held for `delayMs`: placeholders (skeletons) only for loads that take a
 * while. A quick load would flash them for a frame; until then they keep their space, invisible.
 */
export function useSlowLoad(pending: () => boolean, delayMs = 150): Readonly<Ref<boolean>> {
  const slow = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(
    pending,
    (now) => {
      clearTimeout(timer)
      if (!now) slow.value = false
      else if (!slow.value) timer = setTimeout(() => (slow.value = true), delayMs)
    },
    { immediate: true },
  )
  onScopeDispose(() => clearTimeout(timer))
  return readonly(slow)
}
