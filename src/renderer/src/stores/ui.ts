import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { ThemeContent } from '@shared/themes/types'
import type { PromptTarget } from '@shared/types'
import type { SettingsAnchor } from '@/lib/settings-index'

export type MainView = 'chat' | 'home'
export type SettingsSection = 'appearance' | 'accounts' | 'usage' | 'providers' | 'chat' | 'api' | 'updates' | 'about'
/** The quick open's modes by what the query starts with: chats (nothing), commands (`>`), help (`?`). */
export type PalettePrefix = '' | '>' | '?'

export function palettePrefix(query: string): PalettePrefix {
  return query.startsWith('>') ? '>' : query.startsWith('?') ? '?' : ''
}

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
  /** A text field below the description (see `ask`). */
  input?: { value?: string; placeholder?: string }
}

interface ConfirmAnswer {
  ok: boolean
  text: string
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

function parseList(raw: string): string[] {
  try {
    const list = JSON.parse(raw) as unknown
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
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
  /** The agent whose work the chat shows in place of the main thread; null: the main thread. */
  const agentId = ref<string | null>(null)
  /** The shell (its tool item) shown in the side panel. */
  const shellId = ref<string | null>(null)
  /** The shells above the composer as one line: a server runs for hours, folded once is enough. */
  const shellDockFolded = ref(stored<'open' | 'folded'>('nexa.shellDock', 'open') === 'folded')
  watch(shellDockFolded, (folded) => remember('nexa.shellDock', folded ? 'folded' : 'open'))
  /** The project a new chat goes to (home view). */
  const homeProjectId = ref<string | null>(null)
  /** Folders in projects the sidebar shows open (see lib/session-tree.ts); closed by default, as many as there are. */
  const openFolders = ref(new Set<string>(parseList(stored('nexa.openFolders', '[]'))))
  function toggleFolder(id: string, open?: boolean): void {
    const next = new Set(openFolders.value)
    if (open ?? !next.has(id)) next.add(id)
    else next.delete(id)
    openFolders.value = next
    remember('nexa.openFolders', JSON.stringify([...next]))
  }

  /** The settings are a dialog over whatever the window shows. */
  const settingsOpen = ref(false)
  const settingsSection = ref<SettingsSection>(stored<SettingsSection>('nexa.settingsSection', 'appearance'))
  /** A card or row the settings scroll to once they show it (from the quick open); cleared there. */
  const settingsAnchor = ref<SettingsAnchor | null>(null)
  const themeEditorRequest = ref<ThemeEditorRequest | null>(null)

  function toggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value
    remember('nexa.sidebar', sidebarOpen.value ? 'open' : 'closed')
  }

  function openSettings(section?: SettingsSection, anchor?: SettingsAnchor): void {
    if (section) selectSettings(section)
    settingsAnchor.value = anchor ?? null
    settingsOpen.value = true
  }

  /** The quick open at the top of the window; what is typed decides what it searches. */
  const paletteOpen = ref(false)
  const paletteQuery = ref('')

  /** Opens the quick open in a mode; its shortcut again while it shows that mode closes it, as in VS Code. */
  function openPalette(prefix: PalettePrefix = ''): void {
    if (paletteOpen.value && palettePrefix(paletteQuery.value) === prefix) {
      paletteOpen.value = false
      return
    }
    paletteQuery.value = prefix
    paletteOpen.value = true
  }

  function selectSettings(section: SettingsSection): void {
    settingsSection.value = section
    remember('nexa.settingsSection', section)
  }

  /** The project or separator whose prompt the prompt dialog edits; null: closed. */
  const promptTarget = ref<PromptTarget | null>(null)

  const confirmState = ref<(ConfirmOptions & { open: boolean }) | null>(null)
  /** The question shown, and those that wait for it: one never answers another one with No. */
  let shownConfirm: ((answer: ConfirmAnswer) => void) | null = null
  const waitingConfirms: { options: ConfirmOptions; resolve: (answer: ConfirmAnswer) => void }[] = []
  /** What the text field of the question shown holds. */
  const confirmInput = ref('')

  function showNextConfirm(): void {
    const next = waitingConfirms.shift()
    if (!next) return
    shownConfirm = next.resolve
    confirmInput.value = next.options.input?.value ?? ''
    confirmState.value = { ...next.options, open: true }
  }

  function question(options: ConfirmOptions): Promise<ConfirmAnswer> {
    return new Promise((resolve) => {
      waitingConfirms.push({ options, resolve })
      if (!shownConfirm) showNextConfirm()
    })
  }

  /** Asks in the confirmation dialog; while it asks something else, this one waits its turn. */
  async function confirm(options: ConfirmOptions): Promise<boolean> {
    return (await question(options)).ok
  }

  /** Asks for a text, e.g. a name (Electron has no `prompt()`); null when cancelled or left empty. */
  async function ask(options: ConfirmOptions & { input: NonNullable<ConfirmOptions['input']> }): Promise<string | null> {
    const answer = await question(options)
    return answer.ok && answer.text.trim() ? answer.text.trim() : null
  }

  function settleConfirm(result: boolean): void {
    const resolve = shownConfirm
    if (!resolve) return
    shownConfirm = null
    if (confirmState.value) confirmState.value = { ...confirmState.value, open: false }
    resolve({ ok: result, text: confirmInput.value })
    // Once the dialog has gone, so the next one is seen to be another question.
    if (waitingConfirms.length > 0) setTimeout(() => shownConfirm ?? showNextConfirm(), NEXT_CONFIRM_MS)
  }

  return {
    view,
    sidebarOpen,
    agentId,
    shellId,
    shellDockFolded,
    homeProjectId,
    openFolders,
    toggleFolder,
    settingsOpen,
    settingsSection,
    settingsAnchor,
    paletteOpen,
    paletteQuery,
    openPalette,
    themeEditorRequest,
    promptTarget,
    confirmState,
    confirmInput,
    toggleSidebar,
    openSettings,
    selectSettings,
    confirm,
    ask,
    settleConfirm,
  }
})
