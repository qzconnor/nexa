import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { TrayMenuEvent, TrayMenuInvoke, type TrayMenuApi, type TrayMenuState } from '@shared/tray-menu'

/*
 * The preload of the tray menu's window: it gets this small API and nothing of `window.api`, so the
 * menu can neither call the app's channels nor does main count it among the app's windows.
 */

const trayMenu: TrayMenuApi = {
  state: () => ipcRenderer.invoke(TrayMenuInvoke.state) as Promise<TrayMenuState>,
  onState: (cb) => {
    const listener = (_event: IpcRendererEvent, state: TrayMenuState) => cb(state)
    ipcRenderer.on(TrayMenuEvent.state, listener)
    return () => {
      ipcRenderer.removeListener(TrayMenuEvent.state, listener)
    }
  },
  ready: (seq, height) => ipcRenderer.invoke(TrayMenuInvoke.ready, seq, height) as Promise<void>,
  act: (action) => ipcRenderer.invoke(TrayMenuInvoke.act, action) as Promise<void>,
  close: () => ipcRenderer.invoke(TrayMenuInvoke.close) as Promise<void>,
}

contextBridge.exposeInMainWorld('trayMenu', trayMenu)
