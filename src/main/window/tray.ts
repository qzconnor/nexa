import { join } from 'node:path'
import { app, Menu, nativeImage, Tray, type NativeImage } from 'electron'
import type { TrayMenu } from './tray-menu'

export interface TrayActions {
  open: () => void
  quit: () => void
}

/**
 * The icon in the notification area while the app may run without its window (setting `general.runInTray`).
 * With `menu` (Windows) a right click opens Nexa's own menu; elsewhere the system's. Linux desktops
 * report no right click to Electron, and macOS is untried.
 */
export class AppTray {
  private tray: Tray | null = null

  constructor(
    private readonly actions: TrayActions,
    private readonly menu: TrayMenu | null = null,
  ) {}

  get visible(): boolean {
    return this.tray !== null
  }

  set(visible: boolean): void {
    if (visible === this.visible) return
    if (!visible) {
      this.menu?.dispose()
      this.tray?.destroy()
      this.tray = null
      return
    }
    const tray = new Tray(trayIcon())
    tray.setToolTip('Nexa')
    const menu = this.menu
    if (menu) {
      // The page starts while the pointer is over the icon, so the right click finds it ready.
      tray.on('mouse-move', () => menu.prepare())
      tray.on('right-click', () => void menu.open())
    } else {
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: 'Nexa öffnen', click: () => this.actions.open() },
          { type: 'separator' },
          { label: 'Beenden', click: () => this.actions.quit() },
        ]),
      )
    }
    // Linux desktops open the menu on a click instead (StatusNotifierItem), which has "Öffnen" first.
    tray.on('click', () => this.actions.open())
    this.tray = tray
  }

  dispose(): void {
    this.set(false)
  }
}

/** Files of build/ that the installed app carries in its resources (electron-builder.yml, extraResources). */
function resourceIcon(name: 'icon.ico' | 'icon.png'): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(__dirname, '../../build', name)
}

/**
 * Windows: build/icon.ico with all sizes, Windows picks the one for the display scaling. Linux only
 * reads PNG; the panel scales the icon to its own size, a smaller copy keeps that sharp and cheap.
 */
function trayIcon(): string | NativeImage {
  if (process.platform !== 'linux') return resourceIcon('icon.ico')
  const image = nativeImage.createFromPath(resourceIcon('icon.png'))
  return image.isEmpty() ? image : image.resize({ width: 64, height: 64, quality: 'best' })
}
