import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { TerminalInfo } from '@shared/terminals'
import { attempt } from '@/lib/errors'
import type { TerminalLook, TerminalSession } from '@/lib/terminal-session'
import { terminalFontSize, terminalFontStack, xtermTheme } from '@/lib/terminal-theme'
import { useBrowsersStore } from './browsers'
import { useSettingsStore } from './settings'
import { useThemesStore } from './themes'

/** The panel is never narrower (px). */
export const MIN_TERMINAL_WIDTH = 320
export const DEFAULT_TERMINAL_WIDTH = 560
const WIDTH_KEY = 'nexa.terminalWidth'
/** What a new shell starts with, until its view has measured its place. */
const FIRST_SIZE = { cols: 100, rows: 30 }

function storedWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY))
    return value >= MIN_TERMINAL_WIDTH ? value : DEFAULT_TERMINAL_WIDTH
  } catch {
    return DEFAULT_TERMINAL_WIDTH
  }
}

/** A dev server's address opens beside the chat in its browser; everything else in the system's. */
function isLocal(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * The user's terminals beside the chats: which ones there are (main's list), the panel open or not per
 * chat with the terminal it shows, and one width for all. The xterm of each terminal lives here, not in
 * the panel, so its screen stays when the chat is left or the panel closed.
 */
export const useTerminalsStore = defineStore('terminals', () => {
  const settings = useSettingsStore()
  const themes = useThemesStore()
  const browsers = useBrowsersStore()

  const list = ref<TerminalInfo[]>([])
  const openChats = ref(new Set<string>())
  /** The terminal each chat shows, by its id. */
  const shown = ref<Record<string, string>>({})
  /** Chats whose new terminal is on its way. */
  const creating = ref(new Set<string>())
  const width = ref(storedWidth())
  /** Counts the requests to give the shown terminal the keyboard. */
  const focusRequest = ref(0)
  const sessions = new Map<string, TerminalSession>()
  let sessionModule: Promise<typeof import('@/lib/terminal-session')> | null = null

  const look = computed<TerminalLook>(() => {
    const appearance = settings.settings.appearance
    return {
      theme: xtermTheme(themes.find(appearance.theme).terminal),
      fontFamily: terminalFontStack(appearance.codeFont),
      fontSize: terminalFontSize(appearance.uiFontSize),
    }
  })
  watch(look, (next) => {
    for (const session of sessions.values()) session.setLook(next)
  })

  const terminalsOf = (sessionId: string | null | undefined) => (sessionId ? list.value.filter((t) => t.sessionId === sessionId) : [])
  const isOpen = (sessionId: string | null | undefined) => !!sessionId && openChats.value.has(sessionId)
  const isCreating = (sessionId: string | null | undefined) => !!sessionId && creating.value.has(sessionId)
  /** The chat's shells that run, for the dot on the button while the panel is closed. */
  const runningIn = (sessionId: string | null | undefined) => terminalsOf(sessionId).filter((t) => t.status === 'running')

  function shownOf(sessionId: string | null | undefined): TerminalInfo | undefined {
    const mine = terminalsOf(sessionId)
    return mine.find((t) => t.id === shown.value[sessionId ?? '']) ?? mine.at(-1)
  }

  function setOpen(sessionId: string, open: boolean): void {
    if (open === openChats.value.has(sessionId)) return
    const next = new Set(openChats.value)
    if (open) next.add(sessionId)
    else next.delete(sessionId)
    openChats.value = next
  }

  /** Opens the chat's panel, with a terminal started if it has none yet, and gives it the keyboard. */
  async function open(sessionId: string): Promise<void> {
    setOpen(sessionId, true)
    if (!terminalsOf(sessionId).length && !creating.value.has(sessionId)) await create(sessionId)
    focusRequest.value++
  }

  function toggle(sessionId: string): void {
    if (isOpen(sessionId)) setOpen(sessionId, false)
    else void open(sessionId)
  }

  async function create(sessionId: string): Promise<void> {
    creating.value = new Set(creating.value).add(sessionId)
    const info = await attempt(() => window.api.terminals.create(sessionId, FIRST_SIZE), 'Das Terminal ließ sich nicht starten')
    const next = new Set(creating.value)
    next.delete(sessionId)
    creating.value = next
    if (info) {
      if (!list.value.some((t) => t.id === info.id)) list.value = [...list.value, info]
      shown.value = { ...shown.value, [sessionId]: info.id }
      focusRequest.value++
    } else if (!terminalsOf(sessionId).length) {
      setOpen(sessionId, false)
    }
  }

  function show(sessionId: string, id: string): void {
    shown.value = { ...shown.value, [sessionId]: id }
    focusRequest.value++
  }

  function kill(id: string): void {
    void attempt(() => window.api.terminals.kill(id), 'Das Terminal ließ sich nicht beenden')
  }

  /**
   * The xterm of a terminal, made the first time it is shown. xterm (about 450 KB) loads with the first
   * terminal, not with the app; what the shell wrote until then comes from main's buffer.
   */
  async function session(info: TerminalInfo): Promise<TerminalSession> {
    const known = sessions.get(info.id)
    if (known) return known
    const { TerminalSession } = await (sessionModule ??= import('@/lib/terminal-session'))
    // Made meanwhile, by another view of the same terminal.
    let found = sessions.get(info.id)
    if (!found) {
      found = new TerminalSession(info.id, look.value, (url) => void openLink(info.sessionId, url))
      const now = list.value.find((t) => t.id === info.id) ?? info
      if (now.status === 'exited') found.markExited(now.exitCode)
      sessions.set(info.id, found)
    }
    return found
  }

  async function openLink(sessionId: string, url: string): Promise<void> {
    if (!isLocal(url)) {
      await attempt(() => window.api.app.openExternal(url))
      return
    }
    if (await browsers.openTab(sessionId, url)) browsers.setOpen(sessionId, true)
  }

  function setWidth(value: number): void {
    width.value = Math.max(MIN_TERMINAL_WIDTH, Math.round(value))
  }

  function saveWidth(): void {
    try {
      localStorage.setItem(WIDTH_KEY, String(width.value))
    } catch {
      // Storage off: only for this run.
    }
  }

  /** Main's list as it is now: gone terminals take their xterm along, a chat without any closes its panel. */
  function apply(next: TerminalInfo[]): void {
    const ids = new Set(next.map((t) => t.id))
    for (const [id, session] of sessions) {
      if (ids.has(id)) continue
      session.dispose()
      sessions.delete(id)
    }
    for (const t of next) if (t.status === 'exited') sessions.get(t.id)?.markExited(t.exitCode)
    const before = list.value
    list.value = next
    for (const sessionId of openChats.value) {
      const had = before.some((t) => t.sessionId === sessionId)
      if (had && !terminalsOf(sessionId).length && !creating.value.has(sessionId)) setOpen(sessionId, false)
    }
  }

  window.api.terminals.onChanged(apply)
  window.api.terminals.onData((id, data, end) => sessions.get(id)?.receive(data, end))
  void window.api.terminals
    .list()
    .then(apply)
    .catch((error) => console.warn('[terminals] list not loaded', error))

  return {
    list,
    width,
    focusRequest,
    terminalsOf,
    isOpen,
    isCreating,
    runningIn,
    shownOf,
    setOpen,
    open,
    toggle,
    create,
    show,
    kill,
    session,
    setWidth,
    saveWidth,
  }
})
