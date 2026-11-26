import { join } from 'node:path'
import { BrowserWindow, screen, shell, type IpcMainInvokeEvent } from 'electron'
import { parseTrayMenuAction, TRAY_MENU_WIDTH, TrayMenuEvent, TrayMenuInvoke, type TrayMenuAction, type TrayMenuState } from '@shared/tray-menu'
import { normalizeZoom } from '@shared/zoom'
import { handle } from '../ipc'
import { roundSmallCorners } from './material'
import { trayMenuPlace } from './window-place'

export interface TrayMenuDeps {
  /** What the menu shows now. */
  state(): Promise<Omit<TrayMenuState, 'seq'>>
  /** The window's scale in percent (Einstellungen › Darstellung); the menu scales with it. */
  zoom(): number
  /** Calls `cb` whenever something the menu shows may have changed; gives back the unsubscribe. */
  onChange(cb: () => void): () => void
  act(action: TrayMenuAction): void
}

/** How long opening waits for the page to draw the new state; then it shows what it has. */
const READY_TIMEOUT_MS = 400
/** A menu not opened for this long gives its renderer process back; the next one starts it again. */
const IDLE_MS = 5 * 60_000
/** Changes while the menu shows come in bursts (a chat starting changes it several times). */
const UPDATE_DELAY_MS = 120

/**
 * The menu of the icon in the notification area as a small window of its own, in the theme's colours
 * and with the window material of the settings (Windows). It opens at the pointer like the system's
 * menus and closes when it loses the focus, with Esc or once an entry is picked.
 */
export class TrayMenu {
  private win: BrowserWindow | null = null
  private loaded: Promise<void> | null = null
  private seq = 0
  /** Where the pointer was when the menu opened: the menu keeps its corner there while it changes. */
  private anchor: { x: number; y: number } | null = null
  private pending: { seq: number; resolve: (height: number | null) => void } | null = null
  private material: 'acrylic' | 'none' | null = null
  private offChange: (() => void) | null = null
  private updateTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: TrayMenuDeps) {
    const fromMenu = (event: IpcMainInvokeEvent) => this.isMenu(event)
    handle(TrayMenuInvoke.state, () => this.nextState(), fromMenu)
    handle(TrayMenuInvoke.ready, (_e, seq: unknown, height: unknown) => this.ready(seq, height), fromMenu)
    handle(
      TrayMenuInvoke.act,
      (_e, value: unknown) => {
        const action = parseTrayMenuAction(value)
        // A switch stays in the open menu, which shows its new state; everything else leaves it.
        if (action.kind !== 'notifications') this.hide()
        this.deps.act(action)
      },
      fromMenu,
    )
    handle(TrayMenuInvoke.close, () => this.hide(), fromMenu)
  }

  /** Starts the page ahead (the pointer is over the icon), so a right click finds it ready. */
  prepare(): BrowserWindow {
    this.stopIdle()
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: TRAY_MENU_WIDTH,
      height: 240,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // A tool window: not in Alt+Tab.
      type: 'toolbar',
      title: 'Nexa',
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/tray.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    })
    win.setMenu(null)
    void roundSmallCorners(win)
    win.on('blur', () => this.hide())
    win.on('closed', () => {
      if (this.win === win) this.reset()
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event, url) => {
      const devUrl = process.env.ELECTRON_RENDERER_URL
      if (devUrl && url.startsWith(devUrl)) return
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    })
    this.loaded = new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(new URL('tray.html', `${process.env.ELECTRON_RENDERER_URL}/`).toString())
    else void win.loadFile(join(__dirname, '../renderer/tray.html'))
    this.win = win
    this.material = null
    return win
  }

  /** Opens the menu at the pointer (a right click on the icon). */
  async open(): Promise<void> {
    this.anchor = screen.getCursorScreenPoint()
    const win = this.prepare()
    await this.loaded
    if (win.isDestroyed()) return
    win.webContents.setZoomFactor(normalizeZoom(this.deps.zoom()) / 100)
    const height = await this.render(true)
    if (win.isDestroyed() || height === null) return
    this.place(height)
    win.show()
    win.focus()
    this.offChange ??= this.deps.onChange(() => this.scheduleUpdate())
  }

  hide(): void {
    this.offChange?.()
    this.offChange = null
    if (this.updateTimer) clearTimeout(this.updateTimer)
    this.updateTimer = null
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (win.isVisible()) win.hide()
    this.stopIdle()
    this.idleTimer = setTimeout(() => this.dispose(), IDLE_MS)
  }

  dispose(): void {
    const win = this.win
    this.offChange?.()
    this.reset()
    if (win && !win.isDestroyed()) win.destroy()
  }

  private reset(): void {
    this.stopIdle()
    if (this.updateTimer) clearTimeout(this.updateTimer)
    this.offChange = null
    this.updateTimer = null
    this.pending?.resolve(null)
    this.pending = null
    this.win = null
    this.loaded = null
  }

  private stopIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  private isMenu(event: IpcMainInvokeEvent): boolean {
    const win = this.win
    return !!win && !win.isDestroyed() && event.sender === win.webContents && !!event.senderFrame && !event.senderFrame.parent
  }

  private async nextState(): Promise<TrayMenuState> {
    const state = { ...(await this.deps.state()), seq: ++this.seq }
    this.applyMaterial(state.translucent)
    return state
  }

  /**
   * Sends the page the current state; with `wait` resolves to the height it drew it in (the last one
   * known if it takes too long), null when the window went meanwhile.
   */
  private async render(wait: boolean): Promise<number | null> {
    const win = this.win
    if (!win || win.isDestroyed()) return null
    const state = await this.nextState()
    if (win.isDestroyed()) return null
    if (!wait) {
      win.webContents.send(TrayMenuEvent.state, state)
      return null
    }
    this.pending?.resolve(null)
    const lastHeight = () => (win.isDestroyed() ? null : Math.round(win.getBounds().height / (normalizeZoom(this.deps.zoom()) / 100)))
    const drawn = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(lastHeight()), READY_TIMEOUT_MS)
      this.pending = {
        seq: state.seq,
        resolve: (height) => {
          clearTimeout(timer)
          resolve(height)
        },
      }
    })
    win.webContents.send(TrayMenuEvent.state, state)
    return drawn
  }

  private ready(seq: unknown, height: unknown): void {
    if (typeof seq !== 'number' || typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return
    if (this.pending?.seq === seq) {
      const { resolve } = this.pending
      this.pending = null
      resolve(height)
      return
    }
    // A change while the menu shows: it keeps its corner at the pointer and grows or shrinks from there.
    if (seq === this.seq && this.win?.isVisible()) this.place(height)
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) return
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null
      if (this.win?.isVisible()) void this.render(false)
    }, UPDATE_DELAY_MS)
  }

  private place(height: number): void {
    const win = this.win
    if (!win || win.isDestroyed() || !this.anchor) return
    const zoom = normalizeZoom(this.deps.zoom()) / 100
    const area = screen.getDisplayNearestPoint(this.anchor).workArea
    win.setBounds(trayMenuPlace(this.anchor, { width: Math.round(TRAY_MENU_WIDTH * zoom), height: Math.ceil(height * zoom) }, area))
  }

  /** Acrylic like the system's menus while the settings have a window material, else opaque. */
  private applyMaterial(translucent: boolean): void {
    const win = this.win
    const material = translucent ? 'acrylic' : 'none'
    if (!win || win.isDestroyed() || material === this.material) return
    this.material = material
    win.setBackgroundMaterial(material)
  }
}
