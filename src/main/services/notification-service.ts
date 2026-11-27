import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, Notification, type BrowserWindow, type NotificationAction } from 'electron'
import type { Account } from '@shared/accounts'
import type { AgentNotification, AgentNotificationAnswer, NotifyOutcome, NotifyRequest } from '@shared/notify'
import { PROVIDERS } from '@shared/providers'
import type { NotificationSettings } from '@shared/types'
import { isPlainObject } from '@shared/utils'
import type { AccountService } from '../accounts/account-service'
import { readJson, writeJsonAtomic } from '../lib/json-file'
import { nearLimits, type NearLimit, type WarnedWindows } from '../lib/near-limit'
import { chatAlert, nearLimitLines } from '../lib/notification-text'
import type { ProviderService } from './provider-service'
import type { Attention, SessionService } from './session-service'
import type { SettingsService } from './settings-service'

interface StoredFile {
  version: 1
  warned: WarnedWindows
  /** Accounts whose dead login was told about: account id → when its token ran out (identifies the login). */
  logins: Record<string, string>
}

/** Where a click on a notification leads; each brings the window to the front. */
export interface NotificationTargets {
  chat(sessionId: string): void
  settings(section: 'usage' | 'accounts'): void
}

export interface NotificationDeps {
  sessions: Pick<SessionService, 'on' | 'list'>
  providers: Pick<ProviderService, 'on' | 'usage'>
  accounts: Pick<AccountService, 'on' | 'list'>
  settings: Pick<SettingsService, 'on' | 'get'>
  userDataDir: string
  /** The app's windows, the main one first: it flashes for a chat no window shows. */
  windows: () => readonly BrowserWindow[]
  open: NotificationTargets
  /** The agents' notifications as toasts: shown in a window, gone from all once answered. */
  toasts?: { show(win: BrowserWindow, notification: AgentNotification): void; done(id: string): void }
}

/** A notification of an agent (`notify`) until it is answered, taken back or replaced. */
interface AgentEntry {
  notification: AgentNotification
  /** The system notification, kept so its click and buttons still arrive. */
  system: Notification | null
  /** The windows that show it as a toast. */
  shownIn: Set<number>
  /** With buttons the agent waits for the choice. */
  waiting: boolean
  settle: (outcome: NotifyOutcome) => void
  timer: NodeJS.Timeout | null
}

/**
 * Points to chats whose agent is done, waits for the user or stopped at a limit (settings
 * `notifications`): a system notification and the flashing taskbar button. Also warns when a limit
 * of an account is nearly used up or its login ended.
 */
export class NotificationService {
  /** The chat each window shows, by the window's id (the main window, chats in windows of their own). */
  private readonly viewing = new Map<number, string>()
  /**
   * The latest notification of each chat. Kept so it can be taken back once the chat was seen, and
   * so a click on it still arrives (Electron loses the events of collected notifications).
   */
  private readonly shown = new Map<string, Notification>()
  /** The latest warning about the limits and the login of each account, kept for the same reasons. */
  private readonly limitWarnings = new Map<string, Notification>()
  private readonly loginWarnings = new Map<string, Notification>()
  private test: Notification | null = null
  /** The agents' notifications by id, at most one per chat (a newer one takes the older one's place). */
  private readonly agentNotes = new Map<string, AgentEntry>()
  private readonly file: string
  /** Limit windows already warned about, kept across restarts. */
  private warned: WarnedWindows = {}
  /** Accounts whose dead login was already told about, kept across restarts. */
  private loginsWarned: Record<string, string> = {}
  private current: NotificationSettings
  private readonly offs: (() => void)[] = []

  constructor(private readonly deps: NotificationDeps) {
    this.file = join(deps.userDataDir, 'notifications.json')
    this.current = deps.settings.get().notifications
  }

  async init(): Promise<void> {
    const stored = await readJson<StoredFile>(this.file).catch(() => null)
    if (stored?.version === 1) {
      if (isPlainObject(stored.warned)) {
        for (const [key, at] of Object.entries(stored.warned)) if (typeof at === 'number' || at === null) this.warned[key] = at
      }
      if (isPlainObject(stored.logins)) {
        for (const [id, login] of Object.entries(stored.logins)) if (typeof login === 'string') this.loginsWarned[id] = login
      }
    }
    const { sessions, providers, accounts, settings } = this.deps
    this.offs.push(
      sessions.on('attention', (id, attention) => this.attention(id, attention)),
      sessions.on('changed', (list) => {
        // A removed chat takes its notification along.
        for (const id of [...this.shown.keys()]) if (!list.some((s) => s.id === id)) this.dismiss(id)
        for (const [id, entry] of this.agentNotes) if (!list.some((s) => s.id === entry.notification.sessionId)) this.settleAgent(id, { kind: 'cancelled' })
      }),
      providers.on('usage', () => this.checkLimits()),
      accounts.on('changed', () => this.checkLogins()),
      settings.on('changed', (next) => {
        const previous = this.current
        this.current = next.notifications
        // Switched on or another threshold: windows above it now warn right away.
        if (nearLimitWanted(next.notifications) !== nearLimitWanted(previous) || next.notifications.nearLimitPercent !== previous.nearLimitPercent) {
          this.checkLimits()
        }
        if (loginLostWanted(next.notifications) !== loginLostWanted(previous)) this.checkLogins()
      }),
    )
    this.checkLimits()
    this.checkLogins()
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off()
    for (const id of [...this.agentNotes.keys()]) this.settleAgent(id, { kind: 'cancelled' })
  }

  /** A window tells which chat it shows (null: none); that chat's notification is no longer needed. */
  setViewing(windowId: number, sessionId: string | null): void {
    if (sessionId) this.viewing.set(windowId, sessionId)
    else this.viewing.delete(windowId)
    if (sessionId && this.inFront()?.id === windowId) this.dismiss(sessionId)
  }

  /**
   * A window came to the front: the notification of the chat it shows has been seen. An agent that
   * still waits for a choice gets its buttons there as a toast.
   */
  windowFocused(windowId: number): void {
    const sessionId = this.viewing.get(windowId)
    if (sessionId) this.dismiss(sessionId)
    const win = this.deps.windows().find((w) => w.id === windowId && !w.isDestroyed())
    if (win) for (const entry of this.agentNotes.values()) if (entry.waiting) this.toastIn(entry, win)
  }

  /**
   * A notification an agent sends (`notify`): a toast in the window in front, else a system
   * notification; a click opens the chat. Without buttons it settles at once as `shown`, with them
   * once the user picks one or dismisses it, the wait runs out or the turn stops (`signal`).
   */
  fromAgent(sessionId: string, request: NotifyRequest, signal?: AbortSignal): Promise<NotifyOutcome> {
    const settings = this.settings()
    if (!settings.enabled || !settings.fromAgents) return Promise.resolve({ kind: 'off' })
    const meta = this.deps.sessions.list().find((s) => s.id === sessionId)
    if (!meta) return Promise.resolve({ kind: 'cancelled' })
    for (const [id, entry] of this.agentNotes) if (entry.notification.sessionId === sessionId) this.settleAgent(id, { kind: 'replaced' })
    const notification: AgentNotification = {
      id: randomUUID(),
      sessionId,
      chat: meta.title.trim() || 'Chat',
      provider: meta.provider,
      title: request.title,
      ...(request.message ? { message: request.message } : {}),
      actions: request.actions,
    }
    const waiting = request.actions.length > 0
    return new Promise<NotifyOutcome>((resolve) => {
      const entry: AgentEntry = { notification, system: null, shownIn: new Set(), waiting, settle: resolve, timer: null }
      this.agentNotes.set(notification.id, entry)
      const front = this.inFront()
      if (front) this.toastIn(entry, front)
      else this.systemNote(entry, settings)
      if (!waiting) {
        resolve({ kind: 'shown' })
        return
      }
      const minutes = Math.round(request.waitMs / 60_000)
      entry.timer = setTimeout(() => this.settleAgent(notification.id, { kind: 'timeout', minutes }), request.waitMs)
      signal?.addEventListener('abort', () => this.settleAgent(notification.id, { kind: 'cancelled' }), { once: true })
    })
  }

  /** The user answered a notification of an agent in a window (a button, or closed it). */
  answerAgent(id: string, answer: AgentNotificationAnswer): void {
    const entry = this.agentNotes.get(id)
    if (!entry) return
    if (answer.kind === 'action' && entry.notification.actions.includes(answer.action)) this.settleAgent(id, { kind: 'action', action: answer.action })
    else if (answer.kind === 'dismissed') this.settleAgent(id, { kind: 'dismissed' })
  }

  private toastIn(entry: AgentEntry, win: BrowserWindow): void {
    if (!this.deps.toasts || entry.shownIn.has(win.id)) return
    entry.shownIn.add(win.id)
    this.deps.toasts.show(win, entry.notification)
  }

  private systemNote(entry: AgentEntry, settings: NotificationSettings): void {
    if (!Notification.isSupported()) return
    const { id, sessionId, chat, title, message, actions } = entry.notification
    const system = this.create(title, message ? [chat, message].join('\n') : chat, settings, actions)
    // The chat opens; an agent that waits shows its buttons there once the window is in front.
    system.on('click', () => this.deps.open.chat(sessionId))
    system.on('action', (details: { actionIndex?: number } | undefined, index?: number) => {
      const action = actions[details?.actionIndex ?? index ?? -1]
      if (action) this.settleAgent(id, { kind: 'action', action })
    })
    // Gone from the screen into the notification center (`timedOut`), it can still be answered there.
    system.on('close', (details: { reason?: string } | undefined) => {
      if (entry.waiting && details?.reason === 'userCanceled') this.settleAgent(id, { kind: 'dismissed' })
    })
    entry.system = system
    system.show()
    if (entry.waiting && settings.flashTaskbar) this.deps.windows().find((w) => !w.isDestroyed())?.flashFrame(true)
  }

  private settleAgent(id: string, outcome: NotifyOutcome): void {
    const entry = this.agentNotes.get(id)
    if (!entry) return
    this.agentNotes.delete(id)
    if (entry.timer) clearTimeout(entry.timer)
    entry.system?.close()
    if (entry.shownIn.size) this.deps.toasts?.done(id)
    entry.settle(outcome)
  }

  windowClosed(windowId: number): void {
    this.viewing.delete(windowId)
  }

  /** Shows what a notification looks like with the current settings. */
  showTest(): void {
    if (!Notification.isSupported()) throw new Error('Dieses System zeigt keine Benachrichtigungen an.')
    const settings = this.settings()
    this.test?.close()
    this.test = this.create('Claude ist fertig', settings.preview ? 'Beispiel-Chat\nSo erscheint hier der Anfang der Antwort.' : 'Beispiel-Chat', settings)
    this.test.show()
  }

  private settings(): NotificationSettings {
    return this.deps.settings.get().notifications
  }

  private attention(sessionId: string, attention: Attention): void {
    const settings = this.settings()
    const meta = this.deps.sessions.list().find((s) => s.id === sessionId)
    const windows = attention.kind === 'limit' ? (this.deps.providers.usage().find((u) => u.accountId === attention.accountId)?.windows ?? []) : []
    const alert = meta && chatAlert(attention, meta, settings, windows)
    if (alert) this.alert(sessionId, alert.title, alert.body, settings)
  }

  /** Notification and flashing taskbar button, unless the user looks at the chat anyway (setting `when`). */
  private alert(sessionId: string, title: string, body: string, settings: NotificationSettings): void {
    const front = this.inFront()
    if (front && (settings.when === 'background' || this.viewing.get(front.id) === sessionId)) return
    if (Notification.isSupported()) {
      const notification = this.create(title, body, settings)
      notification.on('click', () => this.deps.open.chat(sessionId))
      // One notification per chat: the newer one replaces the older.
      this.dismiss(sessionId)
      this.shown.set(sessionId, notification)
      notification.show()
    }
    // The taskbar button only flashes while no window is in front; it stops once the window is. The
    // chat's own window if it has one, else the main window.
    if (!settings.flashTaskbar || front) return
    const windows = this.deps.windows().filter((win) => !win.isDestroyed())
    const win = windows.find((w) => this.viewing.get(w.id) === sessionId && w.isVisible()) ?? windows[0]
    win?.flashFrame(true)
  }

  /** The window of the app the user works in, if any. */
  private inFront(): BrowserWindow | null {
    return this.deps.windows().find((win) => !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused()) ?? null
  }

  /**
   * Warns about limit windows that reached the threshold (setting `nearLimitPercent`), once per
   * account, window and reset. Only while the warning is on: windows that reach it meanwhile warn
   * once it is switched on again, unless they reset in between.
   */
  private checkLimits(): void {
    const settings = this.settings()
    if (!nearLimitWanted(settings)) return
    const accounts = this.deps.accounts.list()
    const appSettings = this.deps.settings.get()
    const before = JSON.stringify(this.warned)
    for (const key of Object.keys(this.warned)) {
      if (!accounts.some((account) => key.startsWith(`${account.id}\n`))) delete this.warned[key]
    }
    for (const id of [...this.limitWarnings.keys()]) {
      if (!accounts.some((account) => account.id === id)) dismissFrom(this.limitWarnings, id)
    }
    const threshold = Math.min(100, Math.max(1, Math.round(settings.nearLimitPercent)))
    for (const usage of this.deps.providers.usage()) {
      const account = accounts.find((a) => a.id === usage.accountId)
      // A CLI switched off isn't used: its limits don't concern the user.
      if (!account || !appSettings[account.provider].enabled) continue
      const reached = nearLimits(usage, threshold, this.warned, Date.now())
      if (reached.length > 0) this.warnLimit(account, reached, settings)
    }
    if (JSON.stringify(this.warned) !== before) this.save()
  }

  /** One notification per account; a click shows the usage in the settings. */
  private warnLimit(account: Account, reached: NearLimit[], settings: NotificationSettings): void {
    if (!Notification.isSupported()) return
    const notification = this.create(
      reached[0]!.percent >= 100 ? 'Limit erreicht' : 'Limit fast erreicht',
      [account.name, ...nearLimitLines(reached)].join('\n'),
      settings,
    )
    notification.on('click', () => this.deps.open.settings('usage'))
    dismissFrom(this.limitWarnings, account.id)
    this.limitWarnings.set(account.id, notification)
    notification.show()
  }

  /**
   * Tells about browser logins that ended and can't be renewed (`authState` `dead`): once per login,
   * also across restarts. Signed in again (or the account removed), its next end tells again.
   */
  private checkLogins(): void {
    const settings = this.settings()
    const accounts = this.deps.accounts.list()
    const before = JSON.stringify(this.loginsWarned)
    for (const id of Object.keys(this.loginsWarned)) {
      if (accounts.some((account) => account.id === id && account.authState === 'dead')) continue
      delete this.loginsWarned[id]
      dismissFrom(this.loginWarnings, id)
    }
    if (loginLostWanted(settings)) {
      const appSettings = this.deps.settings.get()
      for (const account of accounts) {
        if (account.authState !== 'dead' || account.id in this.loginsWarned || !appSettings[account.provider].enabled) continue
        this.loginsWarned[account.id] = account.tokenExpiresAt ?? ''
        this.warnLogin(account, settings)
      }
    }
    if (JSON.stringify(this.loginsWarned) !== before) this.save()
  }

  /** A click shows the accounts in the settings, where one signs in again. */
  private warnLogin(account: Account, settings: NotificationSettings): void {
    if (!Notification.isSupported()) return
    const cli = PROVIDERS[account.provider].name
    const notification = this.create('Login abgelaufen', `${account.name}\n${cli} kann den Login nicht mehr erneuern. Melde dich neu an.`, settings)
    notification.on('click', () => this.deps.open.settings('accounts'))
    dismissFrom(this.loginWarnings, account.id)
    this.loginWarnings.set(account.id, notification)
    notification.show()
  }

  private save(): void {
    const file: StoredFile = { version: 1, warned: this.warned, logins: this.loginsWarned }
    void writeJsonAtomic(this.file, file).catch(() => undefined)
  }

  private create(title: string, body: string, settings: NotificationSettings, actions: readonly string[] = []): Notification {
    return new Notification({
      title,
      body,
      silent: !settings.sound,
      ...(actions.length ? { actions: actions.map((text): NotificationAction => ({ type: 'button', text })) } : {}),
      // Windows shows the icon of the app's shortcut, Linux needs it given.
      ...(process.platform === 'linux' && app.isPackaged ? { icon: join(process.resourcesPath, 'icon.png') } : {}),
    })
  }

  /** Takes the chat's notification back, also out of the notification center. */
  private dismiss(sessionId: string): void {
    dismissFrom(this.shown, sessionId)
  }
}

function dismissFrom(map: Map<string, Notification>, id: string): void {
  const notification = map.get(id)
  if (!notification) return
  map.delete(id)
  notification.close()
}

function nearLimitWanted(settings: NotificationSettings): boolean {
  return settings.enabled && settings.onNearLimit
}

function loginLostWanted(settings: NotificationSettings): boolean {
  return settings.enabled && settings.onLoginLost
}
