import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** How close (px) to the end still counts as being there. */
const THRESHOLD = 48

/** Where a scroll container stood at a scroll event. */
export interface ScrollSample {
  top: number
  height: number
  /** From the lower edge of the view to the end of the content. */
  distance: number
}

/**
 * Whether the view still follows the end after a scroll event. Only the user moving up stops it, not
 * where the view stands: between our own scroll to the end and its event more may have come in (a
 * tool's card, a block of code), and judged by its place the view would stay behind for good.
 */
export function followsAfterScroll(following: boolean, now: ScrollSample, before: ScrollSample | null): boolean {
  if (now.distance < THRESHOLD) return true
  // Up while the content didn't shrink: the user's doing (the scroll bar, a key, a jump to a message).
  // Content that shrinks moves the view up by itself, and our own scrolls only go down.
  if (before && now.top < before.top - 1 && now.height >= before.height) return false
  return following
}

/**
 * Keeps a scroll container at its end while new content comes in, as long as the user is there;
 * scrolling up stops it, going back down starts it again.
 */
export function useStickToBottom(viewport: Ref<HTMLElement | null>, content: Ref<HTMLElement | null>) {
  const atBottom = ref(true)
  let observer: ResizeObserver | null = null
  let last: ScrollSample | null = null
  let bound: HTMLElement | null = null

  function sample(el: HTMLElement): ScrollSample {
    return { top: el.scrollTop, height: el.scrollHeight, distance: el.scrollHeight - el.scrollTop - el.clientHeight }
  }

  function onScroll(): void {
    const el = viewport.value
    if (!el) return
    const now = sample(el)
    atBottom.value = followsAfterScroll(atBottom.value, now, last)
    last = now
  }

  // The wheel turned up stops following at once: before its scroll event, the next growth would pull the view back down.
  function onWheel(event: WheelEvent): void {
    if (event.deltaY < 0 && !event.ctrlKey && (viewport.value?.scrollTop ?? 0) > 0) atBottom.value = false
  }

  function scrollToBottom(smooth = false): void {
    const el = viewport.value
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    atBottom.value = true
    if (!smooth) last = sample(el)
  }

  function unbind(): void {
    bound?.removeEventListener('scroll', onScroll)
    bound?.removeEventListener('wheel', onWheel)
    bound = null
    observer?.disconnect()
    observer = null
  }

  // Bound again whenever the elements are made anew (the chat's view can be rebuilt), not only once at mount:
  // listeners on an element that is gone would leave the chat where it is.
  watch(
    [viewport, content],
    ([el, inner]) => {
      const fresh = el !== bound
      unbind()
      if (!el) return
      el.addEventListener('scroll', onScroll, { passive: true })
      el.addEventListener('wheel', onWheel, { passive: true })
      bound = el
      observer = new ResizeObserver(() => {
        if (atBottom.value) scrollToBottom()
      })
      observer.observe(el)
      if (inner) observer.observe(inner)
      if (fresh) last = null
      if (fresh || atBottom.value) scrollToBottom()
    },
    { immediate: true, flush: 'post' },
  )

  onBeforeUnmount(unbind)

  return { atBottom, scrollToBottom }
}
