import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useSidebarFold } from './useSidebarFold'

// The main window, without the `window` of a browser.
vi.mock('@/lib/chat-window', () => ({ ownChat: null, isChatWindow: false }))
vi.mock('@/stores/chat-windows', () => ({ useChatWindowsStore: () => ({}) }))

describe('useSidebarFold', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('follows the saved folding under „Alle“ and changes it there', () => {
    const fold = useSidebarFold()
    const saved = vi.fn()
    expect(fold.isOpen('project', 'p', false)).toBe(false)
    expect(fold.isOpen('project', 'p', true)).toBe(true)
    fold.toggle('project', 'p', saved)
    expect(saved).toHaveBeenCalledOnce()
  })

  it('shows everything open under „Aktiv“, also what is folded under „Alle“', async () => {
    const ui = useUiStore()
    ui.sidebarFilter = 'live'
    await nextTick()
    const fold = useSidebarFold()
    expect(fold.isOpen('section', 's', false)).toBe(true)
    expect(fold.isOpen('project', 'p', false)).toBe(true)
    expect(fold.isOpen('folder', 'p\nc:\\a', false)).toBe(true)
  })

  it('folds under „Aktiv“ without touching „Alle“, until the filter changes', async () => {
    const ui = useUiStore()
    ui.sidebarFilter = 'live'
    await nextTick()
    const fold = useSidebarFold()
    const saved = vi.fn()
    fold.toggle('project', 'p', saved)
    expect(saved).not.toHaveBeenCalled()
    expect(fold.isOpen('project', 'p', true)).toBe(false)
    // Only that one: a separator with the same id stays open.
    expect(fold.isOpen('section', 'p', true)).toBe(true)

    ui.sidebarFilter = 'all'
    await nextTick()
    expect(fold.isOpen('project', 'p', true)).toBe(true)
    ui.sidebarFilter = 'live'
    await nextTick()
    expect(fold.isOpen('project', 'p', false)).toBe(true)
  })
})
