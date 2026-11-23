import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { IpcEvent } from '@shared/ipc'
import { PROVIDERS } from '@shared/providers'
import { ApiServer } from './api/api-server'
import { BrowserControl } from './browser/browser-control'
import { registerBrowserIpc } from './browser/browser-ipc'
import { BrowserTabs } from './browser/browser-tabs'
import { BrowserTools } from './browser/browser-tools'
import { FileActivityTracker } from './files/activity-tracker'
import { FileTreeService } from './files/file-tree-service'
import { registerFilesIpc } from './files/files-ipc'
import { GitService } from './files/git-service'
import { forwardWindowState, registerIpc } from './ipc'
import { isLaunchRequest, parseLaunch, readLaunchRequest, type LaunchRequest } from './launch'
import { AccountService } from './accounts/account-service'
import { APP_NAME, userDataFolder } from './lib/app-folder'
import { loadShellEnv } from './lib/shell-env'
import { NexaMcpServer } from './mcp/mcp-server'
import { grantFor, nexaServerSpec } from './mcp/nexa-tools'
import { ProjectService } from './services/project-service'
import { ProviderService } from './services/provider-service'
import { SessionService } from './services/session-service'
import { SettingsService } from './services/settings-service'
import { ThemeService } from './services/theme-service'
import { UpdateService } from './services/update-service'
import { registerUpdatesIpc } from './services/updates-ipc'
import { handleFileProtocol, registerFileScheme } from './window/file-protocol'
import { createMainWindow, openAppWindows, revealWindow } from './window/main-window'
import { WindowMaterialController } from './window/material'

app.setName(APP_NAME)
// Development builds get their own data, so they run next to the installed app.
app.setPath('userData', userDataFolder(app.getPath('appData'), !app.isPackaged))
if (process.platform === 'win32') app.setAppUserModelId('local.nexa')
registerFileScheme()

// Started through the `nx` command: a running instance takes the request over.
const launchRequest = readLaunchRequest(process.argv)

if (!app.requestSingleInstanceLock(launchRequest ? { ...launchRequest } : undefined)) {
  app.quit()
} else {
  // Linux: the PATH & co. of the user's shell, read while Electron starts up (see shell-env.ts).
  void bootstrap(launchRequest, loadShellEnv())
}

async function bootstrap(launchRequest: LaunchRequest | null, shellEnv: Promise<void>): Promise<void> {
  await Promise.all([app.whenReady(), shellEnv])
  handleFileProtocol()
  const userDataDir = app.getPath('userData')

  const settings = new SettingsService(userDataDir)
  const themes = new ThemeService(userDataDir)
  themes.init()
  // The accounts first: every CLI starts with the folder and login of one.
  const accounts = new AccountService(userDataDir)
  await accounts.init()
  const providers = new ProviderService(() => settings.get(), accounts)
  const projects = new ProjectService(userDataDir)

  // Nexa's own MCP server: the tools that draw charts, diagrams and tables in the chat, and the browser
  // beside each chat. Every run gets a token of its own, which says whose browser it drives.
  let browserTools: BrowserTools | null = null
  const mcp = new NexaMcpServer((caller) => nexaServerSpec(caller, settings.get().tools, browserTools))
  await mcp.start().catch((error) => console.error('[mcp] server could not start', error))

  const sessions = new SessionService(userDataDir, projects, providers, accounts, mcp, () => settings.get(), (tools) =>
    grantFor(tools, browserTools),
  )

  // The browser beside each chat: its tabs (kept with the app's data) and what the agents do in them.
  const sessionMeta = (id: string) => sessions.list().find((s) => s.id === id)
  const sessionExists = (id: string) => sessionMeta(id) !== undefined
  const browserTabs = new BrowserTabs(join(userDataDir, 'browser-tabs.json'))
  browserTabs.keepSessions(sessionExists)
  const browserControl = new BrowserControl(browserTabs, {
    exists: sessionExists,
    title: (id) => sessionMeta(id)?.title ?? 'Chat',
    agent: (id) => PROVIDERS[sessionMeta(id)?.provider ?? 'claude'].short,
    folder: (id) => projects.get(sessionMeta(id)?.projectId ?? '')?.path ?? null,
  })
  browserTools = new BrowserTools(browserControl)
  sessions.on('changed', () => {
    browserTabs.keepSessions(sessionExists)
    browserControl.sync()
  })
  registerBrowserIpc(browserTabs, browserControl, sessionExists)

  let mainWindow: BrowserWindow | null = null
  const show = (sessionId?: string) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : openWindow()
    revealWindow(win)
    if (!sessionId) return
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send(IpcEvent.showSession, sessionId))
    else win.webContents.send(IpcEvent.showSession, sessionId)
  }

  const api = new ApiServer({ userDataDir, version: app.getVersion(), settings, accounts, providers, projects, sessions, show })
  registerIpc({ userDataDir, settings, themes, accounts, providers, projects, sessions, api })

  // The file panel beside the chat: the project's tree with git's view, and what the agents do to files.
  const files = new FileTreeService((path) => shell.trashItem(path))
  const git = new GitService()
  const fileActivity = new FileActivityTracker(files)
  sessions.on('tool', (sessionId, item, cwd) => fileActivity.tool(sessionId, item, cwd))
  sessions.on('turnEnded', (sessionId) => fileActivity.turnEnded(sessionId))
  registerFilesIpc(files, git, async (sessionId) => {
    const history = await sessions.history(sessionId)
    return history ? fileActivity.history(history.items, history.cwd) : []
  })
  await api.init()

  // New versions from the GitHub releases: checked after the start and every 4 hours (installed app only).
  const updates = new UpdateService(`nexa/${app.getVersion()}`)
  registerUpdatesIpc(updates)
  updates.init()

  // Which CLIs are installed and logged in, then their usage; the window shows it once known.
  void providers.detect().then(() => providers.refreshUsage())
  providers.startPolling()

  /** `nx` typed in a terminal or the Explorer address bar (src/launcher/nx.cs). */
  const openFromCommandLine = async (request: LaunchRequest) => {
    try {
      const command = parseLaunch(request)
      const project = await projects.create({ path: command.dir })
      const last = command.continue ? sessions.list().find((s) => s.projectId === project.id && !s.archived) : undefined
      const meta = last ?? (await sessions.create({ projectId: project.id, provider: command.provider ?? undefined }))
      show(meta.id)
      if (command.prompt) await sessions.send(meta.id, { text: command.prompt })
    } catch (error) {
      const win = mainWindow
      const options = {
        type: 'warning' as const,
        title: APP_NAME,
        message: '„nx“ konnte keinen Chat öffnen',
        detail: error instanceof Error ? error.message : String(error),
      }
      if (win && !win.isDestroyed()) void dialog.showMessageBox(win, options)
      else void dialog.showMessageBox(options)
    }
  }

  const openWindow = (): BrowserWindow => {
    const win = createMainWindow(settings.get(), userDataDir)
    const material = new WindowMaterialController(win)
    let applied = ''
    const applyAppearance = () => {
      const { material: kind, keepMaterialActive } = settings.get().appearance
      const key = `${kind}:${keepMaterialActive}`
      if (key === applied) return
      applied = key
      void material.apply(kind, keepMaterialActive)
    }
    applyAppearance()
    const off = settings.on('changed', applyAppearance)
    forwardWindowState(win)
    win.on('closed', () => {
      off()
      if (mainWindow === win) mainWindow = null
    })
    mainWindow = win
    return win
  }

  // Dark/light of the native backdrop; the renderer follows the theme.
  nativeTheme.themeSource = 'dark'
  const firstWindow = openWindow()
  if (launchRequest) firstWindow.webContents.once('did-finish-load', () => void openFromCommandLine(launchRequest))

  app.on('second-instance', (_event, _argv, _cwd, additionalData) => {
    if (isLaunchRequest(additionalData)) void openFromCommandLine(additionalData)
    else show()
  })
  app.on('activate', () => {
    if (openAppWindows().length === 0) openWindow()
  })
  app.on('window-all-closed', () => app.quit())

  let cleanedUp = false
  app.on('before-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    cleanedUp = true
    updates.dispose()
    // Ends the CLI processes (they would outlive the app) and writes what is pending.
    void Promise.allSettled([sessions.dispose(), providers.dispose(), browserTabs.flush()])
      .then(() => {
        api.dispose()
        mcp.dispose()
        themes.dispose()
        accounts.dispose()
        files.dispose()
        git.dispose()
      })
      .finally(() => app.quit())
  })
}
