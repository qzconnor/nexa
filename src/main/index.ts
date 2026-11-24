import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { IpcEvent } from '@shared/ipc'
import { enabledProviders, PROVIDERS } from '@shared/providers'
import { findTheme } from '@shared/themes/builtin'
import { ApiServer } from './api/api-server'
import { registerArtifactsIpc } from './artifacts/artifact-ipc'
import { ArtifactService, artifactAccounts } from './artifacts/artifact-service'
import { BrowserControl } from './browser/browser-control'
import { registerBrowserIpc } from './browser/browser-ipc'
import { BrowserTabs } from './browser/browser-tabs'
import { BrowserTools } from './browser/browser-tools'
import { CommandIntegration } from './command-integration'
import { FileActivityTracker } from './files/activity-tracker'
import { FileTreeService } from './files/file-tree-service'
import { registerFilesIpc } from './files/files-ipc'
import { GitService } from './files/git-service'
import { ClaudeManagerImport } from './import/claude-manager'
import { CliSessionImport } from './import/cli-import'
import { registerImportIpc } from './import/import-ipc'
import { forwardWindowState, registerIpc } from './ipc'
import { isLaunchRequest, readLaunchRequest, resolveLaunch, type LaunchRequest } from './launch'
import { AccountService } from './accounts/account-service'
import { APP_NAME, userDataFolder } from './lib/app-folder'
import { AUTOSTART_ARG, setLaunchAtLogin } from './lib/login-item'
import { loadShellEnv } from './lib/shell-env'
import { NexaMcpServer } from './mcp/mcp-server'
import { ChatTools } from './mcp/chat-tools'
import { LimitsTool } from './mcp/limits-tool'
import { grantFor, nexaServerSpec } from './mcp/nexa-tools'
import { AutoSwitch } from './services/auto-switch'
import { ProjectService } from './services/project-service'
import { ProviderService } from './services/provider-service'
import { UsageSamples } from './services/usage-samples'
import { NotificationService } from './services/notification-service'
import { SessionService } from './services/session-service'
import { SettingsService } from './services/settings-service'
import { StartCommands } from './services/start-commands'
import { registerStartCommandsIpc } from './services/start-commands-ipc'
import { ThemeService } from './services/theme-service'
import { UpdateService } from './services/update-service'
import { registerUpdatesIpc } from './services/updates-ipc'
import { shellLaunch } from './services/user-shells'
import { registerVoiceIpc, voiceAccounts } from './voice/voice-ipc'
import { VoiceService } from './voice/voice-service'
import { handleFileProtocol, registerFileScheme } from './window/file-protocol'
import { createMainWindow, openAppWindows, revealWindow, setWindowZoom } from './window/main-window'
import { AppTray } from './window/tray'
import { WindowMaterialController } from './window/material'

app.setName(APP_NAME)
// Development builds get their own data, so they run next to the installed app.
app.setPath('userData', userDataFolder(app.getPath('appData'), !app.isPackaged))
// Development builds have an ID of their own: sharing the installed app's, a Start Menu shortcut to
// electron.exe gave the installed app Electron's icon and name in the taskbar.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'local.nexa' : 'local.nexa.dev')
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
  const providers = new ProviderService(() => settings.get(), accounts, new UsageSamples(join(userDataDir, 'usage-samples.json')))
  const projects = new ProjectService(userDataDir)

  // Nexa's own MCP server: the tools that draw charts, diagrams and tables in the chat, the browser
  // beside each chat, the other chats and the limits of the accounts. Every run gets a token of its
  // own, which says whose browser it drives and which chat sends.
  let browserTools: BrowserTools | null = null
  let chatTools: ChatTools | null = null
  let limitsTool: LimitsTool | null = null
  const mcp = new NexaMcpServer((caller) => nexaServerSpec(caller, settings.get().tools, browserTools, chatTools, limitsTool))
  await mcp.start().catch((error) => console.error('[mcp] server could not start', error))

  const sessions = new SessionService(
    userDataDir,
    projects,
    providers,
    accounts,
    mcp,
    () => settings.get(),
    (tools) => grantFor(tools, browserTools),
    (path) => shell.trashItem(path),
  )
  chatTools = new ChatTools({
    list: () => sessions.peerChats(),
    items: async (id) => (await sessions.history(id))?.items ?? null,
    search: (query) => sessions.search(query),
    send: (from, to, text) => sessions.sendFromChat(from, to, text),
    create: async (from, input) => {
      const meta = await sessions.newFromChat(from, input)
      return { id: meta.id, title: meta.title }
    },
  })

  // The browser beside each chat: its tabs (kept with the app's data) and what the agents do in them.
  const sessionMeta = (id: string) => sessions.list().find((s) => s.id === id)
  const sessionExists = (id: string) => sessionMeta(id) !== undefined
  const browserTabs = new BrowserTabs(join(userDataDir, 'browser-tabs.json'))
  browserTabs.keepSessions(sessionExists)
  const browserControl = new BrowserControl(browserTabs, {
    exists: sessionExists,
    title: (id) => sessionMeta(id)?.title ?? 'Chat',
    agent: (id) => PROVIDERS[sessionMeta(id)?.provider ?? 'claude'].short,
    folder: (id) => {
      const meta = sessionMeta(id)
      return meta?.cwd ?? projects.get(meta?.projectId ?? '')?.path ?? null
    },
  })
  browserTools = new BrowserTools(browserControl)
  sessions.on('changed', () => {
    browserTabs.keepSessions(sessionExists)
    browserControl.sync()
  })
  registerBrowserIpc(browserTabs, browserControl, sessionExists)

  let mainWindow: BrowserWindow | null = null
  /** Brings the window to the front (a new one if there is none) and tells it what to show, once it can listen. */
  const reveal = (channel?: string, arg?: string) => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : openWindow()
    revealWindow(win)
    if (!channel) return
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send(channel, arg))
    else win.webContents.send(channel, arg)
  }
  const show = (sessionId?: string) => (sessionId ? reveal(IpcEvent.showSession, sessionId) : reveal())

  // Windows notifications about chats that are done or need the user, and about limits and logins.
  const notifications = new NotificationService({
    sessions,
    providers,
    accounts,
    settings,
    userDataDir,
    window: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    open: { chat: (id) => show(id), settings: (section) => reveal(IpcEvent.openSettings, section) },
  })

  // A chat at its account's limit: goes on with the next free account, or at the reset.
  const autoSwitch = new AutoSwitch({ sessions, providers, accounts, settings, userDataDir })
  // What the agents learn of the limits (`limits`), with the accounts the switch leaves alone.
  limitsTool = new LimitsTool({
    chat: (id) => sessions.chatAccount(id),
    accounts: () => accounts.list(),
    usage: () => providers.usage(),
    blocked: () => autoSwitch.blockedAccounts(),
    providers: () => enabledProviders(settings.get()),
    autoSwitch: () => settings.get().chat.autoSwitch,
  })

  const api = new ApiServer({ userDataDir, version: app.getVersion(), settings, accounts, providers, projects, sessions, show })
  const git = new GitService()
  // The `nx` command on the user PATH, (un)registered on the settings page.
  const command = new CommandIntegration()
  registerIpc({ userDataDir, settings, themes, accounts, providers, projects, sessions, api, git, notifications, autoSwitch, command })
  // The projects' start commands (dev servers & co.), as shells beside the chats; in the shell of the settings.
  const startCommands = new StartCommands(projects, (command) => shellLaunch(settings.get().chat.shell, command))
  projects.on('changed', (list) => startCommands.projectsChanged(list))
  registerStartCommandsIpc(startCommands)
  // Claude's artifacts on claude.ai, listed with the login of each account (page „Artefakte“).
  const claudeVersion = () => /\d+\.\d+\.\d+/.exec(providers.list().find((p) => p.id === 'claude')?.version ?? '')?.[0] ?? null
  registerArtifactsIpc(new ArtifactService(artifactAccounts(accounts), `nexa/${app.getVersion()}`, claudeVersion), sessions)
  // The microphone in the composer: Claude's speech recognition with a Claude account's login, for every
  // CLI; without a Claude login there is none.
  const voice = new VoiceService({
    accounts: voiceAccounts(accounts),
    settings: () => {
      const current = settings.get()
      return { claudeEnabled: current.claude.enabled, account: current.chat.voiceAccount, language: current.chat.voiceLanguage }
    },
    locale: () => app.getLocale(),
    userAgent: `nexa/${app.getVersion()}`,
  })
  registerVoiceIpc(voice)
  app.on('will-quit', () => voice.dispose())

  // The file panel beside the chat: the project's tree with git's view, and what the agents do to files.
  const files = new FileTreeService((path) => shell.trashItem(path))
  const fileActivity = new FileActivityTracker(files)
  sessions.on('tool', (sessionId, item, cwd) => fileActivity.tool(sessionId, item, cwd))
  sessions.on('turnEnded', (sessionId) => fileActivity.turnEnded(sessionId))
  registerFilesIpc(files, git, async (sessionId) => {
    const history = await sessions.history(sessionId)
    return history ? fileActivity.history(history.items, history.cwd) : []
  })
  await api.init()
  await notifications.init()
  await autoSwitch.init()

  // Taking over the Claude Manager's workspaces, accounts, sessions, prompts and themes, and the
  // sessions in the CLIs' own folders (first start, or later in the settings).
  const cliImport = new CliSessionImport(projects, sessions, accounts, providers, () => settings.get())
  registerImportIpc(new ClaudeManagerImport(app.getPath('appData'), projects, sessions, accounts, themes, () => settings.get()), cliImport)

  // New versions from the GitHub releases: checked after the start and every 4 hours (installed app only).
  const updates = new UpdateService(`nexa/${app.getVersion()}`)
  registerUpdatesIpc(updates)
  updates.init()

  // Which CLIs are installed and logged in, then their usage; the window shows it once known.
  void providers.detect().then(() => providers.refreshUsage())
  providers.startPolling()

  /**
   * `nx` typed in a terminal or the Explorer address bar (src/launcher/nx.cs). A chat that is open in
   * the folder is only shown (setting `general.nxReuseChat`), see `resolveLaunch`.
   */
  const openFromCommandLine = async (request: LaunchRequest) => {
    try {
      const plan = resolveLaunch(request, {
        settings: settings.get(),
        accounts: accounts.list(),
        projects: projects.list(),
        sessions: sessions.list(),
        running: sessions.running(),
      })
      if (plan.kind === 'pick') {
        reveal(IpcEvent.findSessions, plan.query)
        return
      }
      let sessionId: string
      if (plan.kind === 'open') sessionId = plan.sessionId
      else if (plan.kind === 'takeOver') {
        const taken = await cliImport.takeOver(plan.id)
        if (!taken) throw new Error(`Keine Session „${plan.id}“: weder ein Chat in Nexa noch eine Session von Claude Code oder ein Thread von Codex in den Ordnern der Accounts.`)
        sessionId = taken
      } else {
        const project = await projects.create({ path: plan.dir })
        const meta = await sessions.create({ projectId: project.id, provider: plan.provider, account: plan.account ?? undefined, cliArgs: plan.cliArgs })
        sessionId = meta.id
      }
      show(sessionId)
      if (plan.prompt) await sessions.send(sessionId, { text: plan.prompt })
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

  /** The app is quitting: the window really closes instead of going to the notification area. */
  let quitting = false
  const tray = new AppTray({ open: () => show(), quit: () => app.quit() })

  const openWindow = ({ hidden = false } = {}): BrowserWindow => {
    const win = createMainWindow(settings.get(), userDataDir, { hidden })
    const material = new WindowMaterialController(win)
    let applied = ''
    // The window starts at the setting's scale (createMainWindow); only changes are applied here.
    let zoom = settings.get().appearance.zoom
    const applyAppearance = () => {
      const { material: kind, keepMaterialActive, zoom: nextZoom } = settings.get().appearance
      if (nextZoom !== zoom) {
        zoom = nextZoom
        setWindowZoom(win, zoom)
      }
      const key = `${kind}:${keepMaterialActive}`
      if (key === applied) return
      applied = key
      void material.apply(kind, keepMaterialActive)
    }
    applyAppearance()
    const off = settings.on('changed', applyAppearance)
    forwardWindowState(win)
    win.on('focus', () => {
      // In front again: what a notification pointed to is seen.
      win.flashFrame(false)
      notifications.windowFocused()
    })
    win.on('close', (event) => {
      // With the icon in the notification area the window only hides: chats and the API go on.
      if (quitting || updates.installing || !tray.visible) return
      event.preventDefault()
      win.hide()
    })
    // Windows shuts down or logs off: no `before-quit` comes, and the window must not hold it back.
    win.on('session-end', () => (quitting = true))
    win.on('closed', () => {
      off()
      if (mainWindow === win) mainWindow = null
    })
    mainWindow = win
    return win
  }

  // Dark/light of the native backdrop as the theme's, before the window shows; the window says so again
  // once it has the theme (a theme of the user's own is only known there).
  nativeTheme.themeSource = findTheme(settings.get().appearance.theme).mode

  tray.set(settings.get().general.runInTray)
  // A start switched off in the Task Manager (or the desktop's autostart settings) stays off.
  setLaunchAtLogin(settings.get().general.launchAtLogin, true)
  let general = settings.get().general
  settings.on('changed', (next) => {
    const previous = general
    general = next.general
    if (general.launchAtLogin !== previous.launchAtLogin) setLaunchAtLogin(general.launchAtLogin)
    if (general.runInTray !== previous.runInTray) {
      tray.set(general.runInTray)
      // Without the icon a hidden window could not be opened again.
      if (!tray.visible && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) revealWindow(mainWindow)
    }
  })

  // Started by the system at login: with the icon the window stays hidden until it is opened.
  const firstWindow = openWindow({ hidden: process.argv.includes(AUTOSTART_ARG) && tray.visible })
  if (launchRequest) firstWindow.webContents.once('did-finish-load', () => void openFromCommandLine(launchRequest))

  app.on('second-instance', (_event, argv, _cwd, additionalData) => {
    if (isLaunchRequest(additionalData)) void openFromCommandLine(additionalData)
    // A start at login while the app already runs changes nothing.
    else if (!argv.includes(AUTOSTART_ARG)) show()
  })
  app.on('activate', () => {
    if (openAppWindows().length === 0) openWindow()
  })
  app.on('window-all-closed', () => {
    // With the icon the app goes on and opens a new window from there.
    if (!tray.visible) app.quit()
  })

  let cleanedUp = false
  app.on('before-quit', (event) => {
    quitting = true
    if (cleanedUp) return
    event.preventDefault()
    cleanedUp = true
    tray.dispose()
    updates.dispose()
    // Before the runs end: nothing goes on after a limit while Nexa quits.
    const switchSaved = autoSwitch.dispose()
    // Ends the CLI processes and start commands (they would outlive the app) and writes what is pending.
    void Promise.allSettled([sessions.dispose(), providers.dispose(), startCommands.dispose(), browserTabs.flush(), switchSaved])
      .then(() => {
        api.dispose()
        notifications.dispose()
        mcp.dispose()
        themes.dispose()
        accounts.dispose()
        files.dispose()
        git.dispose()
      })
      .finally(() => app.quit())
  })
}
