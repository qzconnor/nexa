import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowReactive, watch } from 'vue'
import {
  trimLog,
  type BrowserActivity,
  type BrowserControlState,
  type BrowserCredentials,
  type BrowserDownload,
  type BrowserDownloadAction,
  type BrowserFrame,
  type BrowserHighlight,
  type BrowserLoginRequest,
  type BrowserShortcut,
  type BrowserTabInfo,
  type BrowserTabsState,
} from '@shared/browser'
import { attempt } from '@/lib/errors'
import { useSessionsStore } from './sessions'
import { useUiStore } from './ui'

/** What a browser pane shows of its page, for its tab. */
export interface BrowserViewState {
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** The page's icon as a data URL; null while it has none (the tab shows a globe). */
  favicon: string | null
}

/** A browser pane as the panel and the shortcuts can drive it. */
export interface BrowserView {
  state: BrowserViewState
  /** The id of the page's contents once it is attached (main's shortcuts and links name it). */
  contentsId(): number | null
  back(): void
  forward(): void
  /** `ignoringCache`: loads everything anew, like Ctrl+Shift+R. */
  reload(ignoringCache?: boolean): void
  /** Opens the page's DevTools in a window of their own, or closes them. */
  toggleDevTools(): void
  /** Puts the keyboard into the address bar, with the address selected. */
  focusAddress(): void
  /** The keyboard goes to the page, or to the address bar while there is no page. */
  focusContent(): void
  /** Opens the search in the page, or puts the keyboard back into it. */
  find(): void
  /** The next (or previous) match of the search; opens it when it is closed. */
  findAgain(forward: boolean): void
  /** Gives the page the keyboard, for the agent's keys. */
  focusPage(): void
  /** The user clicked into the page. */
  userClicked(): void
}

/** Where the agent acts right now; `seq` tells a repeat of the same place from the last one. */
export interface ShownHighlight extends BrowserHighlight {
  seq: number
}

/** Where the shown chat's browser panel has room for its page, relative to the layer over the page area. */
export interface BrowserSlot {
  sessionId: string
  left: number
  top: number
  width: number
  height: number
}

type FocusTarget = 'address' | 'content'

/** Lines of a browser's log the window keeps; main keeps as many. */
const LOG_LIMIT = 300
const PANELS_KEY = 'nexa.browserPanels'
const WIDTH_KEY = 'nexa.browserWidth'
export const MIN_PANEL_WIDTH = 320
const DEFAULT_PANEL_WIDTH = 560

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage off: only for this run.
  }
}

/**
 * The browser beside each chat: its tabs (main keeps them, see main/browser/browser-tabs.ts), the
 * panes that show their pages (BrowserLayer.vue), the panel per chat (open, width) and what the
 * agents do in the pages (main's BrowserControl): who drives which, its log and where it acts.
 */
export const useBrowsersStore = defineStore('browsers', () => {
  const ui = useUiStore()
  const sessions = useSessionsStore(null)

  const tabs = ref<BrowserTabInfo[]>([])
  const shown = ref<Record<string, string>>({})
  /**
   * Tabs whose page is loaded: shown once in this run, opened in it, or driven by an agent. The tabs
   * of the last run wait until then, so a start doesn't load every chat's pages at once.
   */
  const awake = reactive(new Set<string>())
  let known: Set<string> | null = null

  const views = shallowReactive(new Map<string, BrowserView>())
  const controls = reactive(new Map<string, BrowserControlState>())
  /** The tab each chat's agent drove last. */
  const lastDriven = reactive(new Map<string, string>())
  const logs = reactive(new Map<string, BrowserActivity[]>())
  const highlights = reactive(new Map<string, ShownHighlight>())
  let highlightCount = 0
  /** The keyboard should go to a tab's pane once it is there. */
  const pendingFocus = new Map<string, FocusTarget>()

  function applyTabs(state: BrowserTabsState): void {
    const ids = new Set(state.tabs.map((t) => t.id))
    // Tabs that came while the app runs load right away (a link opened in the background too).
    if (known) for (const id of ids) if (!known.has(id)) awake.add(id)
    known = ids
    tabs.value = state.tabs
    shown.value = state.shown
    for (const id of [...awake]) if (!ids.has(id)) awake.delete(id)
    // What an agent did in a tab goes with it.
    for (const map of [controls, logs, highlights]) for (const id of [...map.keys()]) if (!ids.has(id)) map.delete(id)
    // A browser without tabs isn't shown, and doesn't come back by itself with the agent's next tab.
    const withTabs = new Set(state.tabs.map((t) => t.sessionId))
    const empty = [...panels].filter((id) => !withTabs.has(id))
    if (empty.length) {
      for (const id of empty) panels.delete(id)
      savePanels()
    }
    if (fullscreen.value && !withTabs.has(fullscreen.value)) fullscreen.value = null
  }
  window.api.browser.onTabs(applyTabs)
  void window.api.browser.tabs().then((state) => {
    if (!known) applyTabs(state)
  })

  const tabsOf = (sessionId: string | null | undefined) => (sessionId ? tabs.value.filter((t) => t.sessionId === sessionId) : [])
  const tab = (id: string | null | undefined) => (id ? (tabs.value.find((t) => t.id === id) ?? null) : null)
  /** The tab a chat's browser shows; its first one when none was picked. */
  function shownOf(sessionId: string | null | undefined): string | null {
    if (!sessionId) return null
    const id = shown.value[sessionId]
    if (id && tabs.value.some((t) => t.id === id && t.sessionId === sessionId)) return id
    return tabsOf(sessionId)[0]?.id ?? null
  }

  // The panel beside each chat: open or not per chat, one width for all.
  const panels = reactive(new Set<string>(readJson<string[]>(PANELS_KEY, []).filter((id) => typeof id === 'string')))
  const width = ref(Math.max(MIN_PANEL_WIDTH, Number(readJson<number>(WIDTH_KEY, DEFAULT_PANEL_WIDTH)) || DEFAULT_PANEL_WIDTH))
  /** Where the shown chat's panel has room for its page; null while none is shown. */
  const slot = ref<BrowserSlot | null>(null)
  /**
   * The size of a page an agent drives while no panel shows it: a desktop window's, the way the chat's
   * preview (BrowserCard) shows it, and the same for every chat, so the page doesn't change its layout.
   */
  const lastSize = ref({ width: 1280, height: 800 })

  function savePanels(): void {
    // Chats that are gone don't need to be remembered.
    const existing = new Set(sessions.metas.map((m) => m.id))
    writeJson(
      PANELS_KEY,
      [...panels].filter((id) => existing.size === 0 || existing.has(id)),
    )
  }

  const isOpen = (sessionId: string | null | undefined) => !!sessionId && panels.has(sessionId)

  /** Opens or closes a chat's browser panel; without tabs it stays closed (there is nothing to show). */
  function setOpen(sessionId: string, open: boolean, focus = false): void {
    if (open && !tabsOf(sessionId).length) return
    if (open === panels.has(sessionId)) {
      if (open && focus) focusShown(sessionId)
      return
    }
    if (open) panels.add(sessionId)
    else panels.delete(sessionId)
    savePanels()
    if (open && focus) focusShown(sessionId)
  }

  function setWidth(value: number): void {
    width.value = Math.max(MIN_PANEL_WIDTH, Math.round(value))
  }

  function saveWidth(): void {
    writeJson(WIDTH_KEY, width.value)
  }

  function setSlot(next: BrowserSlot | null): void {
    const before = slot.value
    if (
      before &&
      next &&
      before.sessionId === next.sessionId &&
      before.left === next.left &&
      before.top === next.top &&
      before.width === next.width &&
      before.height === next.height
    ) {
      return
    }
    slot.value = next
  }

  /** The tab whose page the user sees right now, if any. */
  const visibleTab = computed(() =>
    slot.value && ui.view === 'chat' && slot.value.sessionId === sessions.activeId ? shownOf(slot.value.sessionId) : null,
  )
  // A tab the user sees loads its page (also one of the last run that a closed tab's place went to).
  watch(
    visibleTab,
    (id) => {
      if (id) awake.add(id)
    },
    { immediate: true },
  )

  function requestFocus(tabId: string, target: FocusTarget): void {
    const view = views.get(tabId)
    if (view) {
      if (target === 'address') view.focusAddress()
      else view.focusContent()
    } else pendingFocus.set(tabId, target)
  }

  /** A chat whose empty browser (no tab yet) should take the keyboard, counted so a repeat counts too. */
  function focusShown(sessionId: string): void {
    const id = shownOf(sessionId)
    if (id) requestFocus(id, 'content')
  }

  async function openTab(sessionId: string, url?: string | null, background = false): Promise<BrowserTabInfo | undefined> {
    const created = await attempt(() => window.api.browser.openTab(sessionId, url ?? null, background), 'Tab konnte nicht geöffnet werden')
    if (!created) return undefined
    awake.add(created.id)
    if (!background) requestFocus(created.id, url ? 'content' : 'address')
    return created
  }

  function showTab(sessionId: string, tabId: string): void {
    awake.add(tabId)
    void attempt(() => window.api.browser.showTab(sessionId, tabId), 'Tab konnte nicht gezeigt werden')
    requestFocus(tabId, 'content')
  }

  function closeTab(tabId: string): void {
    void attempt(() => window.api.browser.closeTab(tabId), 'Tab konnte nicht geschlossen werden')
  }

  // What the agents do in the browsers.
  window.api.browser.onControl((id, control) => {
    if (control) controls.set(id, control)
    else controls.delete(id)
    if (!control) return
    // A page an agent drives must be loaded, also when no panel shows it. The chat shows what it does
    // (BrowserCard); the panel opens only when the user asks for it.
    awake.add(id)
    if (control.busy) lastDriven.set(control.sessionId, id)
  })
  window.api.browser.onActivity((id, activity) => {
    const log = logs.get(id)
    if (!log) {
      logs.set(id, [activity])
      return
    }
    const index = log.findIndex((a) => a.id === activity.id)
    if (index >= 0) log[index] = activity
    else {
      log.push(activity)
      trimLog(log, LOG_LIMIT)
    }
  })
  window.api.browser.onHighlight((id, highlight) => highlights.set(id, { ...highlight, seq: ++highlightCount }))
  window.api.browser.onFocus((id) => views.get(id)?.focusPage())
  window.api.browser.onUserClick((id) => views.get(id)?.userClicked())
  void window.api.browser.controls().then((all) => {
    for (const [id, control] of Object.entries(all)) {
      if (controls.has(id)) continue
      controls.set(id, control)
      awake.add(id)
    }
  })

  /** The browser's downloads, all tabs together, oldest first. */
  const downloads = ref<BrowserDownload[]>([])
  window.api.browser.onDownloads((list) => (downloads.value = list))
  void window.api.browser.downloads().then((list) => (downloads.value = list))

  /** Pages that wait for a user name and password, by the request; each pane shows those of its page. */
  const logins = reactive(new Map<string, BrowserLoginRequest>())
  window.api.browser.onLogin((request) => logins.set(request.id, request))
  window.api.browser.onLoginDone((id) => logins.delete(id))

  /** The tab whose page has these contents. */
  function tabOfContents(contentsId: number): string | null {
    for (const [id, view] of views) if (view.contentsId() === contentsId) return id
    return null
  }

  // Keys of a page that belong to the browser around it (main sees them, the window doesn't).
  window.api.browser.onShortcut((shortcut, contentsId) => {
    const id = contentsId === null ? visibleTab.value : tabOfContents(contentsId)
    runShortcut(shortcut, id)
  })

  /** A browser key, for a tab (null: none is concerned; only the app's own keys work then). */
  function runShortcut(shortcut: BrowserShortcut, id: string | null): boolean {
    if (shortcut === 'open-settings') {
      ui.openSettings()
      return true
    }
    const view = id ? views.get(id) : undefined
    const owner = tab(id)?.sessionId
    if (!view || !id || !owner) return false
    switch (shortcut) {
      case 'browser-address':
        view.focusAddress()
        return true
      case 'browser-reload':
      case 'browser-reload-hard':
        view.reload(shortcut === 'browser-reload-hard')
        return true
      case 'browser-devtools':
        view.toggleDevTools()
        return true
      case 'browser-find':
        view.find()
        return true
      case 'browser-find-next':
      case 'browser-find-previous':
        view.findAgain(shortcut === 'browser-find-next')
        return true
      case 'browser-back':
        view.back()
        return true
      case 'browser-forward':
        view.forward()
        return true
      case 'browser-close-tab':
        closeTab(id)
        return true
      case 'browser-new-tab':
        void openTab(owner)
        return true
      default:
        // Zoom: main does it on the page itself.
        return false
    }
  }

  /** Main's log of a browser, for a pane that shows it the first time. */
  async function loadLog(id: string): Promise<void> {
    const log = await window.api.browser.log(id)
    // Lines that arrived meanwhile are in main's log too.
    logs.set(id, log)
  }

  async function clearLog(id: string): Promise<void> {
    await window.api.browser.clearLog(id)
    logs.set(id, [])
  }

  /** An agent works in a page of the chat's browser right now. */
  const busyIn = (sessionId: string) => tabsOf(sessionId).some((t) => controls.get(t.id)?.busy === true)

  // ── The browser in the chat (BrowserCard): live pictures, the agent's tab, full screen ──

  /** The tab the chat's agent works in: the one it drives, else the one it drove last, else the shown one. */
  function agentTab(sessionId: string): string | null {
    const own = tabsOf(sessionId)
    const driving = own.find((t) => controls.get(t.id)?.busy) ?? own.find((t) => controls.get(t.id)?.active)
    if (driving) return driving.id
    const last = lastDriven.get(sessionId)
    if (last && own.some((t) => t.id === last)) return last
    return shownOf(sessionId)
  }

  /** The newest picture of each watched tab's page. */
  const frames = shallowReactive(new Map<string, BrowserFrame>())
  window.api.browser.onFrame((id, frame) => frames.set(id, frame))
  /** Pictures cards keep of how the page looked when their part of the chat was over (this run only). */
  const stills = shallowReactive(new Map<string, BrowserFrame>())

  /** Live pictures of a tab's page come while watched; returns the end of watching. */
  function watchFrames(id: string): () => void {
    void window.api.browser.watchFrames(id, true).catch(() => undefined)
    let done = false
    return () => {
      if (done) return
      done = true
      void window.api.browser.watchFrames(id, false).catch(() => undefined)
    }
  }

  /** The chat whose browser fills its whole area, to use the page (e.g. to log in). */
  const fullscreen = ref<string | null>(null)

  /** Shows the tab in the chat's browser panel, to use it there. */
  function openInPanel(sessionId: string, tabId: string | null): void {
    if (tabId && shownOf(sessionId) !== tabId) showTab(sessionId, tabId)
    if (fullscreen.value === sessionId) fullscreen.value = null
    setOpen(sessionId, true, true)
  }

  function openFullscreen(sessionId: string, tabId: string | null): void {
    if (tabId && shownOf(sessionId) !== tabId) showTab(sessionId, tabId)
    fullscreen.value = sessionId
    focusShown(sessionId)
  }

  return {
    tabs,
    shown,
    awake,
    views,
    controls,
    logs,
    highlights,
    panels,
    width,
    slot,
    lastSize,
    frames,
    stills,
    fullscreen,
    agentTab,
    watchFrames,
    openInPanel,
    openFullscreen,
    closeFullscreen: () => (fullscreen.value = null),
    visibleTab,
    downloads,
    logins,
    tabsOf,
    tab,
    shownOf,
    isOpen,
    setOpen,
    toggle: (sessionId: string) => setOpen(sessionId, !panels.has(sessionId), true),
    setWidth,
    saveWidth,
    setSlot,
    openTab,
    showTab,
    closeTab,
    requestFocus,
    runShortcut,
    busyIn,
    get: (id: string | null | undefined) => (id ? views.get(id) : undefined),
    register: (id: string, view: BrowserView) => {
      views.set(id, view)
      const target = pendingFocus.get(id)
      if (!target) return
      pendingFocus.delete(id)
      if (target === 'address') view.focusAddress()
      else view.focusContent()
    },
    unregister: (id: string) => {
      views.delete(id)
      highlights.delete(id)
      pendingFocus.delete(id)
    },
    loadLog,
    clearLog,
    takeOver: (id: string, takenOver: boolean) => window.api.browser.takeOver(id, takenOver),
    downloadAction: (id: string, action: BrowserDownloadAction) => window.api.browser.downloadAction(id, action),
    clearDownloads: () => window.api.browser.clearDownloads(),
    /** The first question for a login of a page (by the id of its contents). */
    loginFor: (contentsId: number | null) =>
      contentsId === null ? null : ([...logins.values()].find((l) => l.contentsId === contentsId) ?? null),
    answerLogin: (id: string, credentials: BrowserCredentials | null) => {
      logins.delete(id)
      return window.api.browser.answerLogin(id, credentials)
    },
    resetViewport: (id: string) => window.api.browser.resetViewport(id),
    resetEmulation: (id: string) => window.api.browser.resetEmulation(id),
    resetRoutes: (id: string) => window.api.browser.resetRoutes(id),
    clearData: () => window.api.browser.clearData(),
  }
})
