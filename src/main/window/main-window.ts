import { join } from 'node:path'
import { app, BrowserWindow, screen, session, shell, type WebContents, type WebFrameMain } from 'electron'
import type { AppSettings, WindowState } from '@shared/types'
import { normalizeZoom } from '@shared/zoom'
import { readJsonSync, writeJsonAtomic } from '../lib/json-file'
import { guardBrowserGuests } from './browser-guests'

export const TITLE_BAR_HEIGHT = 40
/** The smallest window at 100 %; scaled up, the layout needs as many CSS pixels and so more of the screen. */
const MIN_WIDTH = 760
const MIN_HEIGHT = 520
/** Windows and Linux draw the caption buttons over the page (Window Controls Overlay); macOS has its own. */
const captionButtons = process.platform === 'win32' || process.platform === 'linux'

interface SavedBounds {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

function restoreBounds(file: string): Partial<SavedBounds> {
  const saved = readJsonSync<SavedBounds>(file)
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return {}
  // Only reuse the position if it is still on a connected display.
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return saved.x < a.x + a.width - 100 && saved.x + saved.width > a.x + 100 && saved.y >= a.y - 10 && saved.y < a.y + a.height - 60
  })
  return visible ? saved : { width: saved.width, height: saved.height, maximized: saved.maximized }
}

const appWindows = new WeakSet<BrowserWindow>()

/** What the app's pages may use: the clipboard. Electron would grant them everything. */
const APP_PERMISSIONS = new Set(['clipboard-read', 'clipboard-sanitized-write'])
let appSessionGuarded = false

/**
 * The microphone, for the voice input in the composer: the app's page itself (no frame in it), and
 * sound only, never the camera or the screen.
 */
function audioOnly(permission: string, mediaTypes: readonly string[], mainFrame: boolean): boolean {
  return mainFrame && permission === 'media' && mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio')
}

function guardAppSession(): void {
  if (appSessionGuarded) return
  appSessionGuarded = true
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
    callback(APP_PERMISSIONS.has(permission) || audioOnly(permission, mediaTypes, details.isMainFrame))
  })
  session.defaultSession.setPermissionCheckHandler((_contents, permission, _origin, details) => {
    return APP_PERMISSIONS.has(permission) || audioOnly(permission, details.mediaType === 'audio' ? ['audio'] : [], details.isMainFrame)
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
  const { minWidth, minHeight } = minimumSize(zoom)
  // Not larger than the screen: the window could no longer be placed on it.
  const area = screen.getDisplayMatching(win.getBounds()).workAreaSize
  win.setMinimumSize(Math.min(minWidth, area.width), Math.min(minHeight, area.height))
}

const titleBarHeight = (zoom: number) => Math.round(TITLE_BAR_HEIGHT * zoom)

/** Scaled down, the minimum of 100 % stays: it leaves the layout more room than it needs then. */
function minimumSize(zoom: number): { minWidth: number; minHeight: number } {
  const factor = Math.max(1, zoom)
  return { minWidth: Math.round(MIN_WIDTH * factor), minHeight: Math.round(MIN_HEIGHT * factor) }
}

/** `hidden`: the window only appears with `revealWindow` (started at login into the notification area). */
export function createMainWindow(settings: AppSettings, userDataDir: string, { hidden = false } = {}): BrowserWindow {
  const boundsFile = join(userDataDir, 'window-state.json')
  const saved = restoreBounds(boundsFile)
  const isWin = process.platform === 'win32'
  const zoom = normalizeZoom(settings.appearance.zoom) / 100

  const win = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width ?? 1280,
    height: saved.height ?? 860,
    ...minimumSize(zoom),
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
  appWindows.add(win)
  guardAppSession()
  guardBrowserGuests(win)
  win.setMenu(null)
  if (saved.maximized) {
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

  let saveTimer: NodeJS.Timeout | null = null
  const saveBounds = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const b = win.getNormalBounds()
      void writeJsonAtomic(boundsFile, { ...b, maximized: win.isMaximized() } satisfies SavedBounds).catch(() => undefined)
    }, 500)
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)
  win.on('maximize', saveBounds)
  win.on('unmaximize', saveBounds)

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}
