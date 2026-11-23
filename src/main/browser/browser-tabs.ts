import { randomUUID } from 'node:crypto'
import {
  BLANK_PAGE,
  fallbackTitle,
  isBrowsableUrl,
  type BrowserPage,
  type BrowserTabInfo,
  type BrowserTabsState,
} from '@shared/browser'
import { readJsonGuardedSync, writeJsonAtomic } from '../lib/json-file'
import { TypedEmitter } from '../lib/typed-emitter'

/** Tabs one chat's browser may have; an agent that opens them in a loop gets an error instead. */
export const MAX_TABS_PER_SESSION = 20
const SAVE_DELAY_MS = 500
const MAX_TITLE = 120

type Events = {
  /** The tabs or the shown ones changed (all of it). */
  changed: [state: BrowserTabsState]
}

interface Saved {
  tabs?: BrowserTabInfo[]
  shown?: Record<string, string>
}

/**
 * The tabs of the chats' browsers: which belong to which chat, what they show and which one each
 * chat's browser shows. Main keeps them (not the window) because the agents open, pick and close
 * tabs through BrowserControl too; the window draws them and reports what their pages show. They are
 * saved, so a chat's browser comes back with its pages after a restart (they load once shown).
 */
export class BrowserTabs extends TypedEmitter<Events> {
  /** Oldest first: the window places the pages in this order and must never move one (it would load again). */
  private tabs: BrowserTabInfo[] = []
  private readonly shown = new Map<string, string>()
  private saveTimer: NodeJS.Timeout | null = null

  /** `file`: where they are kept (null: only for this run, in tests). */
  constructor(private readonly file: string | null) {
    super()
    if (!file) return
    const saved = readJsonGuardedSync<Saved>(file)
    for (const tab of Array.isArray(saved?.tabs) ? saved.tabs : []) {
      if (!tab || typeof tab.id !== 'string' || typeof tab.sessionId !== 'string') continue
      const url = typeof tab.url === 'string' && isBrowsableUrl(tab.url) ? tab.url : BLANK_PAGE
      this.tabs.push({
        id: tab.id,
        sessionId: tab.sessionId,
        url,
        title: typeof tab.title === 'string' && tab.title ? tab.title.slice(0, MAX_TITLE) : fallbackTitle(url),
        openedByAgent: tab.openedByAgent === true,
      })
    }
    for (const [session, tab] of Object.entries(saved?.shown ?? {})) {
      if (this.tabs.some((t) => t.id === tab && t.sessionId === session)) this.shown.set(session, tab)
    }
  }

  state(): BrowserTabsState {
    return { tabs: this.list(), shown: Object.fromEntries(this.shown) }
  }

  list(): BrowserTabInfo[] {
    return this.tabs.map((tab) => ({ ...tab }))
  }

  get(id: string): BrowserTabInfo | null {
    const tab = this.tabs.find((t) => t.id === id)
    return tab ? { ...tab } : null
  }

  /** The tabs of a chat's browser, in the order they were opened. */
  ofSession(sessionId: string): BrowserTabInfo[] {
    return this.tabs.filter((t) => t.sessionId === sessionId).map((tab) => ({ ...tab }))
  }

  /** The tab a chat's browser shows; its first one when none was picked. */
  shownOf(sessionId: string): string | null {
    const shown = this.shown.get(sessionId)
    if (shown && this.tabs.some((t) => t.id === shown)) return shown
    return this.tabs.find((t) => t.sessionId === sessionId)?.id ?? null
  }

  /** A new tab in a chat's browser, shown right away unless `background`. */
  open(sessionId: string, options: { url?: string | null; byAgent?: boolean; background?: boolean } = {}): BrowserTabInfo {
    const url = options.url?.trim() || BLANK_PAGE
    if (!isBrowsableUrl(url)) throw new Error('Der Browser öffnet nur http- und https-Adressen.')
    if (this.tabs.filter((t) => t.sessionId === sessionId).length >= MAX_TABS_PER_SESSION) {
      throw new Error(`Der Browser eines Chats hat höchstens ${MAX_TABS_PER_SESSION} Tabs.`)
    }
    const tab: BrowserTabInfo = { id: randomUUID(), sessionId, url, title: fallbackTitle(url), openedByAgent: options.byAgent === true }
    this.tabs.push(tab)
    if (!options.background || !this.shown.has(sessionId)) this.shown.set(sessionId, tab.id)
    this.changed()
    return { ...tab }
  }

  show(sessionId: string, tabId: string): void {
    if (!this.tabs.some((t) => t.id === tabId && t.sessionId === sessionId) || this.shown.get(sessionId) === tabId) return
    this.shown.set(sessionId, tabId)
    this.changed()
  }

  /** Closes a tab; its chat's browser shows the neighbour then, like a browser does. */
  close(id: string): void {
    const index = this.tabs.findIndex((t) => t.id === id)
    if (index < 0) return
    const [tab] = this.tabs.splice(index, 1)
    if (this.shown.get(tab.sessionId) === id) {
      const siblings = this.tabs.filter((t) => t.sessionId === tab.sessionId)
      // The one that took its place in the order, else the one before it.
      const next = this.tabs.slice(index).find((t) => t.sessionId === tab.sessionId) ?? siblings.at(-1)
      if (next) this.shown.set(tab.sessionId, next.id)
      else this.shown.delete(tab.sessionId)
    }
    this.changed()
  }

  /** The chats that are gone take their browsers with them. */
  keepSessions(exists: (sessionId: string) => boolean): void {
    const before = this.tabs.length
    this.tabs = this.tabs.filter((t) => exists(t.sessionId))
    let dropped = before !== this.tabs.length
    for (const session of [...this.shown.keys()]) {
      if (!exists(session)) {
        this.shown.delete(session)
        dropped = true
      }
    }
    if (dropped) this.changed()
  }

  /** What a tab shows now, as its page reports it; it takes the page's title. */
  setPage(id: string, page: BrowserPage): void {
    const tab = this.tabs.find((t) => t.id === id)
    if (!tab || typeof page?.url !== 'string' || !isBrowsableUrl(page.url)) return
    const title = (typeof page.title === 'string' ? page.title : '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || fallbackTitle(page.url)
    if (tab.url === page.url && tab.title === title) return
    tab.url = page.url
    tab.title = title
    this.changed()
  }

  /** Writes what is pending, e.g. before the app quits. */
  async flush(): Promise<void> {
    if (!this.saveTimer) return
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.save()
  }

  private changed(): void {
    this.emit('changed', this.state())
    if (!this.file || this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, SAVE_DELAY_MS)
  }

  private async save(): Promise<void> {
    if (!this.file) return
    await writeJsonAtomic(this.file, { tabs: this.tabs, shown: Object.fromEntries(this.shown) } satisfies Saved).catch((error) =>
      console.error('[browser] tabs could not be saved', error),
    )
  }
}
