import { join } from 'node:path'
import { app, BrowserWindow, screen, session, shell, type WebContents, type WebFrameMain } from 'electron'
import { CHAT_WINDOW_PARAM } from '@shared/chat-windows'
import type { AppSettings, WindowState } from '@shared/types'
import { normalizeZoom } from '@shared/zoom'
import { readJsonSync, writeJsonAtomic } from '../lib/json-file'
import { guardBrowserGuests } from './browser-guests'
import { attachEditMenu } from './edit-menu'
import { chatWindowPlace, onScreen, type SavedBounds } from './window-place'

export const TITLE_BAR_HEIGHT = 40
/** Windows and Linux draw the caption buttons over the page (Window Controls Overlay); macOS has its own. */
const captionButtons = process.platform === 'win32' || process.platform === 'linux'

/** The main window, or a chat's own window (shared/chat-windows.ts). */
export type AppWindowKind = 'main' | 'chat'

/**
 * The smallest window at 100 %; scaled up, the layout needs as many CSS pixels and so more of the
 * screen. A chat's own window has no sidebar and may be narrow, to stand beside other windows.
 */
const MIN_SIZE: Record<AppWindowKind, { width: number; height: number }> = {
  main: { width: 760, height: 520 },
  chat: { width: 440, height: 420 },
}

/** A saved place, with the position only while it is still on a connected display. */
function placeOnScreen(saved: SavedBounds): Partial<SavedBounds> {
  const areas = screen.getAllDisplays().map((d) => d.workArea)
  return onScreen(saved, areas) ? saved : { width: saved.width, height: saved.height, maximized: saved.maximized }
}

function restoreBounds(file: string): Partial<SavedBounds> {
  const saved = readJsonSync<SavedBounds>(file)
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return {}
  return placeOnScreen(saved)
}

const appWindows = new WeakMap<BrowserWindow, AppWindowKind>()

let appSessionGuarded = false

/**
 * What the app's pages may use; Electron would grant them everything. The clipboard, and the
 * microphone for the voice input in the composer (sound only, never the camera or the screen). Frames
 * in the page (MCP Apps, servers' own code) may only write to the clipboard: reading it, or the
 * microphone, is the app's page itself.
 */
function appMay(permission: string, mediaTypes: readonly string[], mainFrame: boolean): boolean {
  if (permission === 'clipboard-sanitized-write') return true
  if (!mainFrame) return false
  return permission === 'clipboard-read' || (permission === 'media' && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio'))
}

function guardAppSession(): void {
  if (appSessionGuarded) return
  appSessionGuarded = true
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(appMay(permission, mediaTypes, details.isMainFrame))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    return appMay(permission, details.mediaType === 'audio' ? ['audio'] : [], details.isMainFrame)
  })
}

/** Whether an IPC message comes from the top frame of the app's own window. */
export function fromAppWindow(event: { sender: WebContents; senderFrame: WebFrameMain | null }): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent) return false
  const win = BrowserWindow.fromWebContents(event.sender)
  return !!win && appWindows.has(win) && win.webContents === event.sender
}

export function openAppWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => appWindows.has(win) && !win.isDestroyed())
}

export function windowKind(win: BrowserWindow): AppWindowKind | null {
  return appWindows.get(win) ?? null
}

export function windowState(win: BrowserWindow): WindowState {
  return { maximized: win.isMaximized(), focused: win.isFocused(), fullscreen: win.isFullScreen() }
}

export function revealWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/**
 * The window's scale (Einstellungen › Darstellung). The page's title bar grows with it, so the native
 * caption buttons beside it have to as well; and the layout keeps the room it needs at 100 %.
 */
export function setWindowZoom(win: BrowserWindow, percent: number): void {
  const zoom = normalizeZoom(percent) / 100
  win.webContents.setZoomFactor(zoom)
  if (captionButtons) win.setTitleBarOverlay({ height: titleBarHeight(zoom) })
  const { minWidth, minHeight } = minimumSize(appWindows.get(win) ?? 'main', zoom)
  // Not larger than the screen: the window could no longer be placed on it.
  const area = screen.getDisplayMatching(win.getBounds()).workAreaSize
  win.setMinimumSize(Math.min(minWidth, area.width), Math.min(minHeight, area.height))
}

const titleBarHeight = (zoom: number) => Math.round(TITLE_BAR_HEIGHT * zoom)

/** Scaled down, the minimum of 100 % stays: it leaves the layout more room than it needs then. */
function minimumSize(kind: AppWindowKind, zoom: number): { minWidth: number; minHeight: number } {
  const factor = Math.max(1, zoom)
  return { minWidth: Math.round(MIN_SIZE[kind].width * factor), minHeight: Math.round(MIN_SIZE[kind].height * factor) }
}

/** `hidden`: the window only appears with `revealWindow` (started at login into the notification area). */
export function createMainWindow(settings: AppSettings, userDataDir: string, { hidden = false } = {}): BrowserWindow {
  const boundsFile = join(userDataDir, 'window-state.json')
  const saved = restoreBounds(boundsFile)
  const win = createAppWindow(settings, 'main', { width: 1280, height: 860, ...saved }, { hidden })
  trackBounds(win, (bounds) => void writeJsonAtomic(boundsFile, bounds).catch(() => undefined))
  return win
}

/**
 * A chat's own window, where it was last (`saved`) or beside `near` (the main window). `onBounds`
 * hears where the user puts it.
 */
export function createChatWindow(
  settings: AppSettings,
  sessionId: string,
  saved: SavedBounds | null,
  near: BrowserWindow | null,
  onBounds: (bounds: SavedBounds) => void,
): BrowserWindow {
  const nearBounds = near && !near.isDestroyed() ? near.getNormalBounds() : null
  const area = (nearBounds ? screen.getDisplayMatching(nearBounds) : screen.getPrimaryDisplay()).workArea
  const place = saved ? { ...chatWindowPlace(nearBounds, area), ...placeOnScreen(saved) } : chatWindowPlace(nearBounds, area)
  const win = createAppWindow(settings, 'chat', place, { query: { [CHAT_WINDOW_PARAM]: sessionId } })
  trackBounds(win, onBounds)
  return win
}

/** Remembers where the user puts a window, a moment after the last move. */
function trackBounds(win: BrowserWindow, save: (bounds: SavedBounds) => void): void {
  let saveTimer: NodeJS.Timeout | null = null
  const saveBounds = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      save({ ...win.getNormalBounds(), maximized: win.isMaximized() })
    }, 500)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)
  win.on('maximize', saveBounds)
  win.on('unmaximize', saveBounds)
}

function createAppWindow(
  settings: AppSettings,
  kind: AppWindowKind,
  place: Partial<SavedBounds>,
  { hidden = false, query }: { hidden?: boolean; query?: Record<string, string> },
): BrowserWindow {
  const isWin = process.platform === 'win32'
  const zoom = normalizeZoom(settings.appearance.zoom) / 100

  const win = new BrowserWindow({
    x: place.x,
    y: place.y,
    width: place.width,
    height: place.height,
    ...minimumSize(kind, zoom),
    show: false,
    title: 'Nexa',
    backgroundColor: isWin && settings.appearance.material !== 'none' ? '#00000000' : '#141416',
    ...(isWin ? { backgroundMaterial: settings.appearance.material } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: captionButtons ? { color: '#00000000', symbolColor: '#e8e6e3', height: titleBarHeight(zoom) } : false,
    autoHideMenuBar: true,
    // Linux takes the window's icon from here, not from the executable (electron-builder.yml puts it there).
    ...(process.platform === 'linux' && app.isPackaged ? { icon: join(process.resourcesPath, 'icon.png') } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      // The first paint already at the chosen scale; later changes come from setWindowZoom.
      zoomFactor: zoom,
      // The browser beside the chat; every view is hardened before it starts (browser-guests.ts).
      webviewTag: true,
    },
  })
  appWindows.set(win, kind)
  guardAppSession()
  guardBrowserGuests(win)
  attachEditMenu(win)
  win.setMenu(null)
  if (place.maximized) {
    // Maximizing also shows the window, so a hidden one does it when it appears.
    if (hidden) win.once('show', () => win.maximize())
    else win.maximize()
  }
  if (!hidden) win.once('ready-to-show', () => win.show())

  // Never open Electron windows; links go to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)
    void win.loadURL(url.toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }
  return win
}
