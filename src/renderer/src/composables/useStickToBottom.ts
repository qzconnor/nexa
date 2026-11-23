import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/**
 * Keeps a scroll container at its end while new content comes in, as long as the user is there;
 * scrolling up stops it, going back down starts it again.
 */
export function useStickToBottom(viewport: Ref<HTMLElement | null>, content: Ref<HTMLElement | null>) {
  const atBottom = ref(true)
  let observer: ResizeObserver | null = null
  const THRESHOLD = 48

  function measure(): void {
    const el = viewport.value
    if (!el) return
    atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < THRESHOLD
  }

  function scrollToBottom(smooth = false): void {
    const el = viewport.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    atBottom.value = true
  }

  onMounted(() => {
    viewport.value?.addEventListener('scroll', measure, { passive: true })
    observer = new ResizeObserver(() => {
      if (atBottom.value) scrollToBottom()
    })
    if (content.value) observer.observe(content.value)
    if (viewport.value) observer.observe(viewport.value)
    scrollToBottom()
  })

  onBeforeUnmount(() => {
    viewport.value?.removeEventListener('scroll', measure)
    observer?.disconnect()
  })

  return { atBottom, scrollToBottom }
}
