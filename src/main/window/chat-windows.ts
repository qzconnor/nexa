import type { BrowserWindow, WebContents } from 'electron'
import { ChatWindowsEvent, type ChatHandoff } from '@shared/chat-windows'
import { isPlainObject } from '@shared/utils'
import { readJson, writeJsonAtomic } from '../lib/json-file'
import { TypedEmitter } from '../lib/typed-emitter'
import { isSavedBounds, type SavedBounds } from './window-place'

interface StoredFile {
  version: 1
  /** The chats whose window is open, or was when Nexa last quit: they open again at the next start. */
  open: string[]
  /** Where each chat's window was last, the most recent last. */
  bounds: Record<string, SavedBounds>
}

/** Places kept; a chat beyond them gets the default place again. */
const MAX_BOUNDS = 100
/** How long a closing window may take to say what goes back with its chat. */
export const CLOSING_WAIT_MS = 1500
const SAVE_DELAY_MS = 500

interface Entry {
  win: BrowserWindow
  contentsId: number
  /** `asking`: the window was asked what goes back with its chat; `closing`: it may close now. */
  state: 'open' | 'asking' | 'closing'
  timer: NodeJS.Timeout | null
  /** What goes back with the chat, and whether the main window shows it then. */
  handoff: ChatHandoff | null
  show: boolean
}

export interface ChatWindowsDeps {
  file: string
  /** A new window for the chat, where it was last (null: the default place); `onBounds` hears where it goes. */
  create(sessionId: string, saved: SavedBounds | null, onBounds: (bounds: SavedBounds) => void): BrowserWindow
  /** Nexa quits (or installs an update): its windows close without asking and open again at the next start. */
  quitting(): boolean
}

type ChatWindowsEvents = {
  /** The chats that have a window of their own now. */
  changed: [sessionIds: string[]]
  /** A chat's window went (not because Nexa quits): what goes back with it, and whether to show it. */
  returned: [sessionId: string, handoff: ChatHandoff | null, show: boolean]
}

/**
 * The chats in windows of their own (shared/chat-windows.ts): which window shows which chat, where
 * each was last, and which were open when Nexa quit. A window asked to close first tells what goes
 * back to the main window with its chat (the draft, the panels), so nothing written is lost.
 */
export class ChatWindows extends TypedEmitter<ChatWindowsEvents> {
  private readonly entries = new Map<string, Entry>()
  /** What came along with a chat into its new window, until the window takes it. */
  private readonly handoffs = new Map<string, ChatHandoff>()
  private remembered: string[] = []
  private readonly bounds = new Map<string, SavedBounds>()
  private saveTimer: NodeJS.Timeout | null = null
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly deps: ChatWindowsDeps) {
    super()
  }

  async init(): Promise<void> {
    const stored = await readJson<StoredFile>(this.deps.file).catch(() => null)
    if (stored?.version !== 1) return
    if (Array.isArray(stored.open)) this.remembered = [...new Set(stored.open.filter((id): id is string => typeof id === 'string'))]
    if (isPlainObject(stored.bounds)) {
      for (const [id, bounds] of Object.entries(stored.bounds)) if (isSavedBounds(bounds)) this.bounds.set(id, bounds)
    }
  }

  /** The chats that have a window of their own. */
  ids(): string[] {
    return [...this.entries.keys()]
  }

  windowOf(sessionId: string): BrowserWindow | null {
    const entry = this.entries.get(sessionId)
    return entry && !entry.win.isDestroyed() ? entry.win : null
  }

  /** The chat whose window has these contents; null for the main window. */
  sessionOf(contents: WebContents): string | null {
    for (const [id, entry] of this.entries) if (entry.contentsId === contents.id) return id
    return null
  }

  /** Opens the chat's window. One that is there already comes back as it is; the caller brings it to the front. */
  open(sessionId: string, handoff?: ChatHandoff): BrowserWindow {
    const existing = this.windowOf(sessionId)
    if (existing) return existing
    if (handoff) this.handoffs.set(sessionId, handoff)
    const win = this.deps.create(sessionId, this.bounds.get(sessionId) ?? null, (bounds) => this.rememberBounds(sessionId, bounds))
    const entry: Entry = { win, contentsId: win.webContents.id, state: 'open', timer: null, handoff: null, show: false }
    this.entries.set(sessionId, entry)
    win.on('close', (event) => this.onClose(entry, event))
    win.on('closed', () => this.onClosed(sessionId, entry))
    if (!this.remembered.includes(sessionId)) {
      this.remembered.push(sessionId)
      this.scheduleSave()
    }
    this.emit('changed', this.ids())
    return win
  }

  /** What came along with the chat, for its window (once). */
  takeHandoff(sessionId: string): ChatHandoff | null {
    const handoff = this.handoffs.get(sessionId) ?? null
    this.handoffs.delete(sessionId)
    return handoff
  }

  /** A window goes (asked to close, or on its own), and this goes back with its chat; the main window doesn't show it. */
  closing(contents: WebContents, handoff: ChatHandoff): void {
    const entry = this.entryOf(contents)
    if (entry) this.finish(entry, handoff, false)
  }

  /** A window gives its chat back to the main window, which shows it. */
  dock(contents: WebContents, handoff: ChatHandoff): void {
    const entry = this.entryOf(contents)
    if (entry) this.finish(entry, handoff, true)
  }

  /** Closes the windows of these chats without asking them (they are being deleted). */
  close(sessionIds: readonly string[]): void {
    for (const id of sessionIds) {
      const entry = this.entries.get(id)
      if (entry) this.finish(entry, null, false)
    }
  }

  /** Windows of chats that are gone close; their places are forgotten. */
  keepSessions(exists: (sessionId: string) => boolean): void {
    for (const [id, entry] of this.entries) if (!exists(id)) this.finish(entry, null, false)
    let changed = false
    for (const id of [...this.bounds.keys()]) {
      if (exists(id)) continue
      this.bounds.delete(id)
      changed = true
    }
    const remembered = this.remembered.filter(exists)
    if (remembered.length !== this.remembered.length) {
      this.remembered = remembered
      changed = true
    }
    if (changed) this.scheduleSave()
  }

  /** The windows that were open when Nexa last quit, of chats that are still there. */
  restore(exists: (sessionId: string) => boolean): void {
    for (const id of [...this.remembered]) {
      if (exists(id)) this.open(id)
    }
    this.keepSessions(exists)
  }

  /** Writes what is pending (Nexa quits). */
  flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
      this.write()
    }
    return this.saving
  }

  private entryOf(contents: WebContents): Entry | undefined {
    for (const entry of this.entries.values()) if (entry.contentsId === contents.id) return entry
    return undefined
  }

  private onClose(entry: Entry, event: { preventDefault(): void }): void {
    if (entry.state === 'closing' || this.deps.quitting()) return
    event.preventDefault()
    if (entry.state === 'asking') return
    const contents = entry.win.webContents
    // A page that isn't up (still loading, crashed) can't answer.
    if (contents.isLoading() || contents.isCrashed()) {
      this.finish(entry, null, false)
      return
    }
    entry.state = 'asking'
    contents.send(ChatWindowsEvent.closing)
    entry.timer = setTimeout(() => this.finish(entry, null, false), CLOSING_WAIT_MS)
  }

  private finish(entry: Entry, handoff: ChatHandoff | null, show: boolean): void {
    if (entry.state === 'closing') return
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    entry.state = 'closing'
    entry.handoff = handoff
    entry.show = show
    if (!entry.win.isDestroyed()) entry.win.close()
  }

  private onClosed(sessionId: string, entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer)
    if (this.entries.get(sessionId) !== entry) return
    this.entries.delete(sessionId)
    // What the window never took goes back as it came.
    const handoff = entry.handoff ?? this.handoffs.get(sessionId) ?? null
    this.handoffs.delete(sessionId)
    const quitting = this.deps.quitting()
    if (!quitting) {
      this.remembered = this.remembered.filter((id) => id !== sessionId)
      this.scheduleSave()
    }
    this.emit('changed', this.ids())
    // After `changed`: the main window knows the chat is its own again before it is asked to show it.
    if (!quitting) this.emit('returned', sessionId, handoff, entry.show)
  }

  private rememberBounds(sessionId: string, bounds: SavedBounds): void {
    // The most recent last, so the oldest go first.
    this.bounds.delete(sessionId)
    this.bounds.set(sessionId, bounds)
    for (const id of this.bounds.keys()) {
      if (this.bounds.size <= MAX_BOUNDS) break
      this.bounds.delete(id)
    }
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.write()
    }, SAVE_DELAY_MS)
  }

  private write(): void {
    const data: StoredFile = { version: 1, open: [...this.remembered], bounds: Object.fromEntries(this.bounds) }
    this.saving = this.saving.then(() => writeJsonAtomic(this.deps.file, data)).catch((error) => console.warn('[chat-windows] not saved', error))
  }
}
