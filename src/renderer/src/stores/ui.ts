import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ThemeContent } from '@shared/themes/types'

export type MainView = 'chat' | 'home'
export type SettingsSection = 'appearance' | 'accounts' | 'usage' | 'providers' | 'chat' | 'api' | 'updates' | 'about'

/** What `ThemeEditorDialog` edits: a theme of the user (`id`), or a new one that starts with the colors of `from`. */
export type ThemeEditorRequest = { mode: 'edit'; id: string } | { mode: 'create'; from: ThemeContent }

export interface ConfirmOptions {
  title: string
  description?: string
  /** Shown in a monospace box below the title, e.g. a folder. */
  code?: string
  /** `alert` only has a single button. */
  kind?: 'confirm' | 'alert'
  confirmText?: string
  cancelText?: string
  destructive?: boolean
  /** Shows a warning symbol next to the title. */
  warning?: boolean
}

/** Between two questions of the confirmation dialog: the first fades out (100 ms), the next one comes. */
const NEXT_CONFIRM_MS = 150

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback
  } catch {
    return fallback
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage off: only for this run.
  }
}

/** What the window shows: the main view, the sidebar, dialogs, the panel with a subagent's work. */
export const useUiStore = defineStore('ui', () => {
  const view = ref<MainView>('home')
  const sidebarOpen = ref(stored('nexa.sidebar', 'open') === 'open')
  /** The agent item shown in the side panel. */
  const agentId = ref<string | null>(null)
  /** The project a new chat goes to (home view). */
  const homeProjectId = ref<string | null>(null)

  /** The settings are a dialog over whatever the window shows. */
  const settingsOpen = ref(false)
  const settingsSection = ref<SettingsSection>(stored<SettingsSection>('nexa.settingsSection', 'appearance'))
  const themeEditorRequest = ref<ThemeEditorRequest | null>(null)

  function toggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value
    remember('nexa.sidebar', sidebarOpen.value ? 'open' : 'closed')
  }

  function openSettings(section?: SettingsSection): void {
    if (section) selectSettings(section)
    settingsOpen.value = true
  }

  function selectSettings(section: SettingsSection): void {
    settingsSection.value = section
    remember('nexa.settingsSection', section)
  }

  const confirmState = ref<(ConfirmOptions & { open: boolean }) | null>(null)
  /** The question shown, and those that wait for it: one never answers another one with No. */
  let shownConfirm: ((value: boolean) => void) | null = null
  const waitingConfirms: { options: ConfirmOptions; resolve: (value: boolean) => void }[] = []

  function showNextConfirm(): void {
    const next = waitingConfirms.shift()
    if (!next) return
    shownConfirm = next.resolve
    confirmState.value = { ...next.options, open: true }
  }

  /** Asks in the confirmation dialog; while it asks something else, this one waits its turn. */
  function confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      waitingConfirms.push({ options, resolve })
      if (!shownConfirm) showNextConfirm()
    })
  }

  function settleConfirm(result: boolean): void {
    const resolve = shownConfirm
    if (!resolve) return
    shownConfirm = null
    if (confirmState.value) confirmState.value = { ...confirmState.value, open: false }
    resolve(result)
    // Once the dialog has gone, so the next one is seen to be another question.
    if (waitingConfirms.length > 0) setTimeout(() => shownConfirm ?? showNextConfirm(), NEXT_CONFIRM_MS)
  }

  return {
    view,
    sidebarOpen,
    agentId,
    homeProjectId,
    settingsOpen,
    settingsSection,
    themeEditorRequest,
    confirmState,
    toggleSidebar,
    openSettings,
    selectSettings,
    confirm,
    settleConfirm,
  }
})
