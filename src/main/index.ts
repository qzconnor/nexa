import { join } from 'node:path'
import { app, BrowserWindow, nativeTheme, powerMonitor, shell, type IpcMainInvokeEvent } from 'electron'
import { PROVIDER_IDS } from '@shared/chat'
import { ChatWindowsEvent, type MainWindowRequest } from '@shared/chat-windows'
import { PUSH_AWAY_MINUTES } from '@shared/defaults'
import { IpcEvent, IpcInvoke } from '@shared/ipc'
import { enabledProviders, PROVIDERS } from '@shared/providers'
import { hasChats } from '@shared/server-link'
import { findTheme } from '@shared/themes/builtin'
import { trayChats, trayLimits, type TrayMenuAction } from '@shared/tray-menu'
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
import { chatFolders } from './files/remote-roots'
import { Checkpoints } from './files/checkpoints'
import { GitService } from './files/git-service'
import { ClaudeManagerImport } from './import/claude-manager'
import { CliSessionImport } from './import/cli-import'
import { registerImportIpc } from './import/import-ipc'
import { broadcast, forwardWindowState, handle, registerIpc } from './ipc'
import { isLaunchRequest, readLaunchRequest, resolveLaunch, type LaunchRequest } from './launch'
import type { AccountEnv } from './accounts/account-env'
import { AccountService } from './accounts/account-service'
import { APP_NAME, userDataFolder } from './lib/app-folder'
import { AUTOSTART_ARG, setLaunchAtLogin } from './lib/login-item'
import { loadShellEnv } from './lib/shell-env'
import { MCP_APP_SCHEME_PRIVILEGES, McpAppViews } from './mcp-apps/mcp-app-views'
import { registerMcpAppsIpc, registerRemoteMcpAppsIpc } from './mcp-apps/mcp-apps-ipc'
import { NexaMcpServer } from './mcp/mcp-server'
import { ChatTools } from './mcp/chat-tools'
import { AskTool } from './mcp/ask-tool'
import { LimitsTool } from './mcp/limits-tool'
import { grantFor, nexaServerSpec } from './mcp/nexa-tools'
import { NotifyTool } from './mcp/notify-tool'
import { keepCliCacheIn } from './providers/cli-cache'
import { registerScheduledIpc } from './scheduled/scheduled-ipc'
import { ScheduledTasks } from './scheduled/scheduled-tasks'
import { AutoSwitch } from './services/auto-switch'
import { CliConfigService } from './services/cli-config-service'
import { registerCliConfigIpc } from './services/cli-config-ipc'
import { ProjectService } from './services/project-service'
import { ProviderService } from './services/provider-service'
import { UsageSamples } from './services/usage-samples'
import { NotificationService } from './services/notification-service'
import { MAX_CHAT_CHAIN, SessionService } from './services/session-service'
import { SettingsService } from './services/settings-service'
import { StartCommands } from './services/start-commands'
import { registerStartCommandsIpc } from './services/start-commands-ipc'
import { Terminals, terminalLaunch } from './services/terminals'
import { registerTerminalsIpc } from './services/terminals-ipc'
import { ThemeService } from './services/theme-service'
import { UpdateService } from './services/update-service'
import { registerUpdatesIpc } from './services/updates-ipc'
import { shellLaunch } from './services/user-shells'
import { registerRemote } from './remote/remote-ipc'
import { DeviceChats, RemoteChatsHost } from './remote/remote-chats'
import { PushNotifier } from './server-link/push-notifier'
import { registerServerLinkIpc } from './server-link/server-link-ipc'
import { ServerLinkService } from './server-link/server-link-service'
import { registerVoiceIpc, voiceAccounts } from './voice/voice-ipc'
import { VoiceService } from './voice/voice-service'
import { ChatWindows } from './window/chat-windows'
import { applySpellcheck } from './window/edit-menu'
import { registerChatWindowsIpc } from './window/chat-windows-ipc'
import { handleFileProtocol, registerFileScheme, setRemoteImages, type RemoteImage } from './window/file-protocol'
import { AppDialogs } from './window/app-dialogs'
import { createChatWindow, createMainWindow, openAppWindows, revealWindow, setWindowZoom } from './window/main-window'
import { AppTray } from './window/tray'
import { TrayMenu } from './window/tray-menu'
import { WindowMaterialController } from './window/material'

app.setName(APP_NAME)
// Development builds get their own data, so they run next to the installed app.
app.setPath('userData', userDataFolder(app.getPath('appData'), !app.isPackaged))
// Development builds have an ID of their own: sharing the installed app's, a Start Menu shortcut to
// electron.exe gave the installed app Electron's icon and name in the taskbar.
if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'local.nexa' : 'local.nexa.dev')
registerFileScheme([MCP_APP_SCHEME_PRIVILEGES])
// The pages of MCP tools in the chat (MCP Apps), each at an address of its own.
const mcpAppViews = new McpAppViews()

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
  mcpAppViews.handle()
  const userDataDir = app.getPath('userData')

  const settings = new SettingsService(userDataDir)
  const themes = new ThemeService(userDataDir)
  themes.init()
  // The accounts first: every CLI starts with the folder and login of one.
  const accounts = new AccountService(userDataDir)
  await accounts.init()
  keepCliCacheIn(join(userDataDir, 'cli-cache.json'))
  const providers = new ProviderService(() => settings.get(), accounts, new UsageSamples(join(userDataDir, 'usage-samples.json')))
  const projects = new ProjectService(userDataDir)

  // Nexa's own MCP server: the tools that draw charts, diagrams and tables in the chat, the browser
  // beside each chat, the other chats and the limits of the accounts. Every run gets a token of its
  // own, which says whose browser it drives and which chat sends.
  let browserTools: BrowserTools | null = null
  let chatTools: ChatTools | null = null
  let limitsTool: LimitsTool | null = null
  let askTool: AskTool | null = null
  let notifyTool: NotifyTool | null = null
  const mcp = new NexaMcpServer((caller) => nexaServerSpec(caller, settings.get().tools, browserTools, chatTools, limitsTool, askTool, notifyTool))
  await mcp.start().catch((error) => console.error('[mcp] server could not start', error))

  const git = new GitService()
  const sessions = new SessionService(
    userDataDir,
    projects,
    providers,
    accounts,
    mcp,
    () => settings.get(),
    (tools) => grantFor(tools, browserTools),
    (path) => shell.trashItem(path),
    git,
    new Checkpoints(join(userDataDir, 'checkpoints')),
  )
  let promptSuggestions = settings.get().chat.promptSuggestions
  settings.on('changed', (next) => {
    if (next.chat.promptSuggestions === promptSuggestions) return
    promptSuggestions = next.chat.promptSuggestions
    sessions.setPromptSuggestions(promptSuggestions)
  })
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
  const liveMainWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null)
  /** Tells a window something once it can listen. */
  const sendWhenLoaded = (win: BrowserWindow, channel: string, ...args: unknown[]) => {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => win.webContents.send(channel, ...args))
    else win.webContents.send(channel, ...args)
  }
  /** Brings the main window to the front (a new one if there is none) and tells it what to show. */
  const reveal = (channel?: string, ...args: unknown[]) => {
    const win = liveMainWindow() ?? openWindow()
    revealWindow(win)
    if (channel) sendWhenLoaded(win, channel, ...args)
  }
  /**
   * What the main process asks or tells, in the main window's own dialog: never a native box. The
   * window comes to the front for it, also from the notification area or minimized.
   */
  const dialogs = new AppDialogs(() => {
    const win = liveMainWindow() ?? openWindow()
    revealWindow(win)
    return {
      // Still loading, the page asks for what is open itself once it listens (`pendingDialogs`).
      show: (request) => {
        if (!win.webContents.isLoading()) win.webContents.send(IpcEvent.appDialog, request)
      },
      onGone: (cb) => {
        const contents = win.webContents
        win.on('closed', cb)
        contents.on('render-process-gone', cb)
        return () => {
          win.removeListener('closed', cb)
          if (!contents.isDestroyed()) contents.removeListener('render-process-gone', cb)
        }
      },
    }
  })
  const fromMainWindow = (event: IpcMainInvokeEvent) => event.sender === liveMainWindow()?.webContents
  handle(
    IpcInvoke.appDialogAnswer,
    (_e, id: unknown, ok: unknown) => {
      if (typeof id === 'number') dialogs.answer(id, ok === true)
    },
    fromMainWindow,
  )
  handle(IpcInvoke.appDialogsPending, () => dialogs.pending(), fromMainWindow)
  /** The app is quitting: the windows really close instead of going to the notification area or asking. */
  let quitting = false

  // Chats in windows of their own; the main window keeps the sidebar and everything else.
  const chatWindows = new ChatWindows({
    file: join(userDataDir, 'chat-windows.json'),
    create: (sessionId, saved, onBounds) => {
      const win = createChatWindow(settings.get(), sessionId, saved, liveMainWindow(), onBounds)
      setUpWindow(win)
      return win
    },
    quitting: () => quitting || updates.installing,
  })
  /** A chat shows in its own window if it has one, else in the main window. */
  const show = (sessionId?: string) => {
    const own = sessionId ? chatWindows.windowOf(sessionId) : null
    if (own) revealWindow(own)
    else if (sessionId) reveal(IpcEvent.showSession, sessionId)
    else reveal()
  }

  // Windows notifications about chats that are done or need the user, and about limits and logins.
  const notifications = new NotificationService({
    sessions,
    providers,
    accounts,
    settings,
    userDataDir,
    windows: () => {
      const main = liveMainWindow()
      return main ? [main, ...openAppWindows().filter((win) => win !== main)] : openAppWindows()
    },
    open: { chat: (id) => show(id), settings: (section) => reveal(IpcEvent.openSettings, section) },
    // The agents' notifications (`notify`) as toasts in the window in front.
    toasts: {
      show: (win, notification) => win.webContents.send(IpcEvent.agentNotification, notification),
      done: (id) => broadcast(IpcEvent.agentNotificationDone, id),
    },
  })
  notifyTool = new NotifyTool({ notify: (id, request, signal) => notifications.fromAgent(id, request, signal) })

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
  // Forms of the agents for the user (`ask_user`), shown in the calling chat.
  askTool = new AskTool({ ask: (id, request, signal) => sessions.ask(id, request, signal) })

  const api = new ApiServer({ userDataDir, version: app.getVersion(), settings, accounts, providers, projects, sessions, show })
  // The `nx` command on the user PATH, (un)registered on the settings page.
  const command = new CommandIntegration()
  registerIpc({ userDataDir, settings, themes, accounts, providers, projects, sessions, api, git, notifications, autoSwitch, command })
  // The projects' start commands (dev servers & co.), as shells beside the chats; in the shell of the settings.
  const startCommands = new StartCommands(projects, (command) => shellLaunch(settings.get().chat.shell, command))
  projects.on('changed', (list) => startCommands.projectsChanged(list))
  registerStartCommandsIpc(startCommands)
  // The user's terminals beside the chats: the shell of the settings in the chat's folder, as its account.
  const terminals = new Terminals((sessionId) => {
    const { cwd, accountId } = sessions.terminalTarget(sessionId)
    const account = accounts.get(accountId)
    let env: AccountEnv | null = null
    try {
      env = accounts.env(accountId)
    } catch (error) {
      // A token account without its token: the terminal still opens, only without the login.
      console.warn('[terminals] account environment unavailable', error)
    }
    return { cwd, env, account: account.kind === 'system' ? null : account.name }
  }, () => terminalLaunch(settings.get().chat.shell))
  sessions.on('changed', (list) => terminals.keepSessions(new Set(list.map((meta) => meta.id))))
  registerTerminalsIpc(terminals)
  // A chat's own window asks the main window to open another chat, the start page, to delete …
  registerChatWindowsIpc(chatWindows, { exists: sessionExists, toMain: (request) => reveal(ChatWindowsEvent.request, request) })
  sessions.on('changed', () => chatWindows.keepSessions(sessionExists))
  // Back from its own window: the draft and the panels go to the main window, which shows the chat if asked.
  chatWindows.on('returned', (sessionId, handoff, showIt) => {
    const main = liveMainWindow()
    if (handoff && main) sendWhenLoaded(main, ChatWindowsEvent.returned, sessionId, handoff)
    if (showIt) show(sessionId)
  })
  // The CLIs' own settings (MCP servers, permissions, hooks), in their own files.
  registerCliConfigIpc(new CliConfigService(providers, accounts, projects, join(userDataDir, 'global-mcp.json')))
  // Claude's artifacts on claude.ai, listed with the login of each account (page „Artefakte“).
  const claudeVersion = () => /\d+\.\d+\.\d+/.exec(providers.list().find((p) => p.id === 'claude')?.version ?? '')?.[0] ?? null
  registerArtifactsIpc(new ArtifactService(artifactAccounts(accounts), `nexa/${app.getVersion()}`, claudeVersion), sessions)
  // The pages MCP tools bring along, read and called through the chat's CLI.
  registerMcpAppsIpc(mcpAppViews, sessions)
  // Prompts on a schedule (page „Geplant“), each run a chat; the clock starts once the CLIs are known.
  const scheduled = new ScheduledTasks({
    file: join(userDataDir, 'scheduled-tasks.json'),
    sessions: {
      create: (input) => sessions.create(input),
      update: (id, patch) => sessions.update(id, patch),
      send: (id, input) => sessions.send(id, input),
      exists: sessionExists,
      isWorking: (id) => sessions.isWorking(id),
    },
    projects,
    accounts,
    usage: {
      defaultAccount: (provider) => providers.defaultAccount(provider),
      get: (accountId) => providers.usage().find((u) => u.accountId === accountId),
      refresh: (accountId) => providers.refreshAccountUsage(accountId),
    },
  })
  registerScheduledIpc(scheduled)
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
  registerFilesIpc(
    files,
    git,
    async (sessionId) => {
      const history = await sessions.history(sessionId)
      return history ? fileActivity.history(history.items, history.cwd) : []
    },
    // What another device's file panel may reach here.
    () => chatFolders(projects.list(), sessions.list()),
  )
  await api.init()
  await notifications.init()
  await autoSwitch.init()
  await chatWindows.init()

  // Taking over the Claude Manager's workspaces, accounts, sessions, prompts and themes, and the
  // sessions in the CLIs' own folders (first start, or later in the settings).
  const cliImport = new CliSessionImport(projects, sessions, accounts, providers, () => settings.get())
  registerImportIpc(new ClaudeManagerImport(app.getPath('appData'), projects, sessions, accounts, themes, () => settings.get()), cliImport)

  // New versions from the GitHub releases: checked after the start and every 4 hours (installed app
  // only), the release notes along with each check.
  const updates = new UpdateService(`nexa/${app.getVersion()}`, join(userDataDir, 'release-notes.json'))
  registerUpdatesIpc(updates)
  updates.init()

  // The pairing with a nexa-server: connects only once paired. After sleep the socket is likely dead,
  // and the next attempt could be a minute away.
  const serverLink = new ServerLinkService({ userDataDir, log: (message) => console.info('[nexa-server]', message) })
  registerServerLinkIpc(serverLink)
  // Messages between chats across devices (`chats.*`): this device answers the chat tools of the
  // others as far as its setting and their level go, and its own chat tools reach their chats.
  const remoteChats = new RemoteChatsHost({
    enabled: () => settings.get().tools.chatTools,
    link: { trusted: (id) => serverLink.device(id)?.trusted ?? false, deviceName: (id) => serverLink.device(id)?.name ?? null },
    chats: {
      list: () => sessions.peerChats(),
      items: async (id) => (await sessions.history(id))?.items ?? null,
      search: (query) => sessions.search(query),
      projects: () => projects.list(),
      send: (to, text, from) => sessions.send(to, { text }, from),
      create: async (input, from) => {
        const meta = await sessions.newFromDevice(input, from)
        return { id: meta.id, title: meta.title }
      },
    },
    maxChain: MAX_CHAT_CHAIN,
  })
  const remote = registerRemote({
    link: serverLink,
    version: app.getVersion(),
    log: (message) => console.info('[remote]', message),
    chats: (from, request) => remoteChats.handle(from, request),
  })
  // Pictures of another device's chats come from there; it gives out only those of the chat's prompts.
  setRemoteImages((device, sessionId, path) => remote.client.invoke(device, IpcInvoke.sessionsImage, [sessionId, path]) as Promise<RemoteImage | null>)
  registerRemoteMcpAppsIpc(mcpAppViews, (device, channel, args) => remote.client.invoke(device, channel, args))
  chatTools.setDevices(
    new DeviceChats({
      request: (device, m, p) => remote.client.request(device, m, p),
      devices: () => serverLink.getState().devices.flatMap((d) => (!d.self && d.trusted && hasChats(d) ? [{ id: d.id, name: d.name, online: d.online }] : [])),
      selfName: () => serverLink.self()?.name ?? null,
      outgoing: (from) => sessions.chatOrigin(from),
      projectOf: (from) => sessions.peerChats().find((chat) => chat.id === from)?.project ?? null,
    }),
  )
  // The notifications of chats also to the phones with the web app, while one isn't at this computer.
  const pushes = new PushNotifier({
    sessions,
    providers,
    settings,
    link: serverLink,
    away: () => powerMonitor.getSystemIdleState(PUSH_AWAY_MINUTES * 60) !== 'active',
    log: (message) => console.info('[push]', message),
  })
  pushes.init()
  void serverLink.init().catch((error: unknown) => console.warn('[nexa-server] init failed', error))
  powerMonitor.on('resume', () => serverLink.retryNow())

  // Which CLIs are installed and logged in, then their usage; the window shows it once known.
  const detected = providers.detect()
  void detected.then(() => providers.refreshUsage())
  // A run missed while Nexa was off needs its CLI found first.
  void detected.catch(() => undefined).finally(() => scheduled.start())
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
      dialogs.tell({ title: '„nx“ konnte keinen Chat öffnen', description: error instanceof Error ? error.message : String(error), warning: true })
    }
  }

  // Windows: the icon's menu in the theme's colours, with the chats that wait or work.
  const trayAct = (action: TrayMenuAction) => {
    switch (action.kind) {
      case 'open':
        return show()
      case 'chat':
        return show(sessionExists(action.sessionId) ? action.sessionId : undefined)
      case 'new':
        return reveal(ChatWindowsEvent.request, { kind: 'new', projectId: null } satisfies MainWindowRequest)
      case 'notifications':
        return void settings.update({ notifications: { enabled: action.enabled } }).catch((error) => console.error('[tray] notifications', error))
      case 'quit':
        return app.quit()
    }
  }
  const trayMenu =
    process.platform === 'win32'
      ? new TrayMenu({
          state: async () => {
            const current = settings.get()
            const custom = (await themes.list().catch(() => [])).flatMap((entry) => (entry.theme ? [entry.theme] : []))
            return {
              theme: findTheme(current.appearance.theme, custom),
              appearance: current.appearance,
              translucent: current.appearance.material !== 'none',
              ...trayChats(sessions.list(), (id) => sessions.statusOf(id), (id) => projects.get(id)?.name ?? ''),
              limits: trayLimits(
                { accounts: accounts.list(), usage: providers.usage(), blocked: autoSwitch.blockedAccounts(), now: Date.now() },
                enabledProviders(current),
                Object.fromEntries(PROVIDER_IDS.map((id) => [id, current[id].model])),
              ),
              notifications: current.notifications.enabled,
            }
          },
          zoom: () => settings.get().appearance.zoom,
          onChange: (cb) => {
            const offs = [
              sessions.on('changed', cb),
              sessions.on('event', (event) => {
                if (event.type === 'runtime') cb()
              }),
              settings.on('changed', cb),
              themes.on('changed', cb),
              providers.on('usage', cb),
              accounts.on('changed', cb),
            ]
            return () => offs.forEach((off) => off())
          },
          act: trayAct,
        })
      : null
  const tray = new AppTray({ open: () => show(), quit: () => app.quit() }, trayMenu)

  /** The user said to quit although something ran; the next `before-quit` goes through. */
  let quitConfirmed = false
  let askingToQuit: Promise<boolean> | null = null
  /** What quitting now would end, for the question; empty when nothing runs. */
  const runningWork = (): string[] => {
    const work: string[] = []
    const chats = sessions.working()
    if (chats) work.push(chats === 1 ? '1 Chat arbeitet noch' : `${chats} Chats arbeiten noch`)
    const commands = startCommands.runs().filter((run) => run.status === 'running').length
    if (commands) work.push(commands === 1 ? '1 Startbefehl läuft' : `${commands} Startbefehle laufen`)
    return work
  }
  /**
   * Quitting asks first while chats work or commands run (setting `general.confirmQuitRunning`); not
   * when Windows ends the session (`quitting` is set then) or an update restarts the app.
   */
  const quitNeedsConfirm = () =>
    !quitConfirmed && !quitting && !updates.installing && settings.get().general.confirmQuitRunning && runningWork().length > 0
  const askToQuit = (): Promise<boolean> => {
    askingToQuit ??= (async () => {
      const work = runningWork()
      // In the main window, which comes to the front for it (from the tray, the taskbar, minimized).
      // Should it go before answering, Nexa quits as asked: nothing could answer any more.
      const quit = await dialogs.ask(
        {
          title: 'Nexa beenden?',
          description: `${work.join(', ')}. Beim Beenden brechen die Antworten ab und die Befehle enden; die Chats lassen sich danach fortsetzen.`,
          confirmText: 'Beenden',
          destructive: true,
        },
        true,
      )
      if (quit) quitConfirmed = true
      return quitConfirmed
    })().finally(() => (askingToQuit = null))
    return askingToQuit
  }

  // One for all windows: the spellchecker belongs to the app's session.
  applySpellcheck(settings.get().chat)
  settings.on('changed', (next) => applySpellcheck(next.chat))

  /** What every window of the app gets: the material and scale of the settings, its state, notifications. */
  const setUpWindow = (win: BrowserWindow) => {
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
    const id = win.id
    win.on('focus', () => {
      // In front again: what a notification pointed to is seen.
      win.flashFrame(false)
      notifications.windowFocused(id)
    })
    // Windows shuts down or logs off: no `before-quit` comes, and the window must not hold it back.
    win.on('session-end', () => (quitting = true))
    win.on('closed', () => {
      off()
      notifications.windowClosed(id)
    })
  }

  const openWindow = ({ hidden = false } = {}): BrowserWindow => {
    const win = createMainWindow(settings.get(), userDataDir, { hidden })
    setUpWindow(win)
    win.on('close', (event) => {
      if (quitting || updates.installing) return
      if (!tray.visible) {
        // Without the icon closing quits: asked while the window is still there.
        if (!quitNeedsConfirm()) return
        event.preventDefault()
        void askToQuit().then((quit) => quit && app.quit())
        return
      }
      // With the icon in the notification area the window only hides: chats and the API go on.
      event.preventDefault()
      win.hide()
    })
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null
      // Without the icon the main window is the app: closed, Nexa quits, its chats' own windows too
      // (they open again at the next start).
      if (!quitting && !tray.visible) app.quit()
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
  // The chats' own windows of the last run come with the main window, not before (a hidden start). A
  // maximized one shows at once.
  if (firstWindow.isVisible()) chatWindows.restore(sessionExists)
  else firstWindow.once('show', () => chatWindows.restore(sessionExists))

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
    if (cleanedUp) {
      quitting = true
      return
    }
    event.preventDefault()
    if (quitNeedsConfirm()) {
      void askToQuit().then((quit) => quit && app.quit())
      return
    }
    quitting = true
    cleanedUp = true
    tray.dispose()
    updates.dispose()
    pushes.dispose()
    remote.dispose()
    const serverLinkSaved = serverLink.dispose()
    // Before the runs end: nothing goes on after a limit while Nexa quits.
    const switchSaved = autoSwitch.dispose()
    // Ends the CLI processes and start commands (they would outlive the app) and writes what is pending.
    terminals.dispose()
    // Before the chats end: no run starts while Nexa quits.
    const scheduledSaved = scheduled.dispose()
    void Promise.allSettled([sessions.dispose(), providers.dispose(), startCommands.dispose(), browserTabs.flush(), chatWindows.flush(), switchSaved, scheduledSaved, serverLinkSaved])
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
