import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { ArtifactsInvoke } from '@shared/artifacts'
import { ChatWindowsEvent, ChatWindowsInvoke } from '@shared/chat-windows'
import { BrowserEvent, BrowserInvoke } from '@shared/browser-ipc'
import { CliConfigEvent, CliConfigInvoke } from '@shared/cli-config'
import { FilesInvoke } from '@shared/files-ipc'
import { CliImportEvent, CliImportInvoke, ImportEvent, ImportInvoke } from '@shared/import-ipc'
import { IpcEvent, IpcInvoke, type NexaApi, type Unsubscribe } from '@shared/ipc'
import { McpAppsInvoke } from '@shared/mcp-apps'
import { RemoteInvoke, RemoteIpcEvent } from '@shared/remote-ipc'
import { ScheduledEvent, ScheduledInvoke } from '@shared/scheduled-tasks'
import { ServerLinkEvent, ServerLinkInvoke } from '@shared/server-link'
import { StartCommandsEvent, StartCommandsInvoke } from '@shared/start-commands'
import { TerminalsEvent, TerminalsInvoke } from '@shared/terminals'
import { UpdatesEvent, UpdatesInvoke } from '@shared/updates'
import { VoiceEvent, VoiceInvoke } from '@shared/voice'
import { deviceApi } from '@shared/window-api'

function subscribe<Args extends unknown[]>(channel: string, cb: (...args: Args) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...(args as Args))
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

// The full namespace below has more of `git` (and of `mcpApps`) than another device answers.
const { git: deviceGit, mcpApps: _mcpApps, ...device } = deviceApi(invoke, subscribe)

const api: NexaApi = {
  platform: process.platform,
  updates: {
    state: () => invoke(UpdatesInvoke.state),
    check: () => invoke(UpdatesInvoke.check),
    download: () => invoke(UpdatesInvoke.download),
    install: () => invoke(UpdatesInvoke.install),
    releases: () => invoke(UpdatesInvoke.releases),
    reloadReleases: () => invoke(UpdatesInvoke.reloadReleases),
    moreReleases: () => invoke(UpdatesInvoke.moreReleases),
    reference: (number) => invoke(UpdatesInvoke.reference, number),
    onChanged: (cb) => subscribe(UpdatesEvent.changed, cb),
    onShow: (cb) => subscribe(UpdatesEvent.show, cb),
    onReleases: (cb) => subscribe(UpdatesEvent.releases, cb),
  },
  serverLink: {
    state: () => invoke(ServerLinkInvoke.state),
    pair: (input) => invoke(ServerLinkInvoke.pair, input),
    invite: () => invoke(ServerLinkInvoke.invite),
    rename: (instance, name) => invoke(ServerLinkInvoke.rename, instance, name),
    remove: (instance) => invoke(ServerLinkInvoke.remove, instance),
    unpair: () => invoke(ServerLinkInvoke.unpair),
    connect: () => invoke(ServerLinkInvoke.connect),
    disconnect: () => invoke(ServerLinkInvoke.disconnect),
    setRemote: (enabled) => invoke(ServerLinkInvoke.setRemote, enabled),
    setLevel: (instance, level) => invoke(ServerLinkInvoke.setLevel, instance, level),
    onChanged: (cb) => subscribe(ServerLinkEvent.changed, cb),
  },
  remote: {
    hello: (instance) => invoke(RemoteInvoke.hello, instance),
    invoke: (instance, channel, args) => invoke(RemoteInvoke.invoke, instance, channel, args),
    watch: (list) => invoke(RemoteInvoke.watch, list),
    uploadImage: (instance, path) => invoke(RemoteInvoke.uploadImage, instance, path),
    controllers: () => invoke(RemoteInvoke.controllers),
    disconnect: (instance) => invoke(RemoteInvoke.disconnect, instance),
    onEvents: (cb) => subscribe(RemoteIpcEvent.events, cb),
    onResync: (cb) => subscribe(RemoteIpcEvent.resync, cb),
    onInfo: (cb) => subscribe(RemoteIpcEvent.info, cb),
    onControllers: (cb) => subscribe(RemoteIpcEvent.controllers, cb),
  },
  claudeManager: {
    detect: () => invoke(ImportInvoke.detect),
    installed: () => invoke(ImportInvoke.installed),
    scan: () => invoke(ImportInvoke.scan),
    run: (input) => invoke(ImportInvoke.run, input),
    onProgress: (cb) => subscribe(ImportEvent.progress, cb),
  },
  cliImport: {
    scan: () => invoke(CliImportInvoke.scan),
    run: (input) => invoke(CliImportInvoke.run, input),
    onProgress: (cb) => subscribe(CliImportEvent.progress, cb),
  },
  artifacts: {
    list: (accountId) => invoke(ArtifactsInvoke.list, accountId),
    thumbnail: (accountId, id, dark) => invoke(ArtifactsInvoke.thumbnail, accountId, id, dark),
    chats: () => invoke(ArtifactsInvoke.chats),
    rename: (accountId, id, title) => invoke(ArtifactsInvoke.rename, accountId, id, title),
    remove: (accountId, id) => invoke(ArtifactsInvoke.remove, accountId, id),
    setPinned: (accountId, id, pinned) => invoke(ArtifactsInvoke.setPinned, accountId, id, pinned),
  },
  scheduled: {
    list: () => invoke(ScheduledInvoke.list),
    save: (input, id) => invoke(ScheduledInvoke.save, input, id ?? null),
    remove: (id) => invoke(ScheduledInvoke.remove, id),
    setEnabled: (id, enabled) => invoke(ScheduledInvoke.setEnabled, id, enabled),
    runNow: (id) => invoke(ScheduledInvoke.runNow, id),
    stopWaiting: (id) => invoke(ScheduledInvoke.stopWaiting, id),
    onChanged: (cb) => subscribe(ScheduledEvent.changed, cb),
  },
  mcpApps: {
    open: (sessionId, itemId) => invoke(McpAppsInvoke.open, sessionId, itemId),
    callTool: (sessionId, itemId, name, args) => invoke(McpAppsInvoke.callTool, sessionId, itemId, name, args),
    readResource: (sessionId, itemId, uri) => invoke(McpAppsInvoke.readResource, sessionId, itemId, uri),
    openRemote: (device, sessionId, itemId) => invoke(McpAppsInvoke.openRemote, device, sessionId, itemId),
  },
  voice: {
    start: (input) => invoke(VoiceInvoke.start, input),
    audio: (id, chunk) => invoke(VoiceInvoke.audio, id, chunk),
    stop: (id) => invoke(VoiceInvoke.stop, id),
    cancel: (id) => invoke(VoiceInvoke.cancel, id),
    onUpdate: (cb) => subscribe(VoiceEvent.event, cb),
  },
  startCommands: {
    runs: () => invoke(StartCommandsInvoke.runs),
    save: (projectId, commands) => invoke(StartCommandsInvoke.save, projectId, commands),
    start: (projectId, id) => invoke(StartCommandsInvoke.start, projectId, id),
    stop: (projectId, id) => invoke(StartCommandsInvoke.stop, projectId, id),
    restart: (projectId, id) => invoke(StartCommandsInvoke.restart, projectId, id),
    output: (projectId, id) => invoke(StartCommandsInvoke.output, projectId, id),
    chatOpened: (projectId) => invoke(StartCommandsInvoke.chatOpened, projectId),
    onChanged: (cb) => subscribe(StartCommandsEvent.changed, cb),
  },
  cliConfig: {
    providers: () => invoke(CliConfigInvoke.providers),
    read: (target) => invoke(CliConfigInvoke.read, target),
    saveMcp: (target, server, previousName) => invoke(CliConfigInvoke.saveMcp, target, server, previousName),
    removeMcp: (target, name) => invoke(CliConfigInvoke.removeMcp, target, name),
    savePermissions: (target, values) => invoke(CliConfigInvoke.savePermissions, target, values),
    saveHooks: (target, save) => invoke(CliConfigInvoke.saveHooks, target, save),
    trustHook: (target, key, hash) => invoke(CliConfigInvoke.trustHook, target, key, hash),
    overview: () => invoke(CliConfigInvoke.overview),
    addGlobal: (server) => invoke(CliConfigInvoke.addGlobal, server),
    saveGlobal: (server, previousName) => invoke(CliConfigInvoke.saveGlobal, server, previousName),
    makeGlobal: (name, source) => invoke(CliConfigInvoke.makeGlobal, name, source),
    unglobal: (name) => invoke(CliConfigInvoke.unglobal, name),
    removeGlobal: (name) => invoke(CliConfigInvoke.removeGlobal, name),
    syncGlobal: (name) => invoke(CliConfigInvoke.syncGlobal, name),
    onChanged: (cb) => subscribe(CliConfigEvent.changed, cb),
  },
  chatWindows: {
    open: (sessionId, handoff) => invoke(ChatWindowsInvoke.open, sessionId, handoff ?? null),
    list: () => invoke(ChatWindowsInvoke.list),
    takeHandoff: (sessionId) => invoke(ChatWindowsInvoke.takeHandoff, sessionId),
    toMain: (request) => invoke(ChatWindowsInvoke.toMain, request),
    dock: (handoff) => invoke(ChatWindowsInvoke.dock, handoff),
    closing: (handoff) => invoke(ChatWindowsInvoke.closing, handoff),
    close: (sessionIds) => invoke(ChatWindowsInvoke.close, sessionIds),
    onChanged: (cb) => subscribe(ChatWindowsEvent.changed, cb),
    onClosing: (cb) => subscribe(ChatWindowsEvent.closing, cb),
    onReturned: (cb) => subscribe(ChatWindowsEvent.returned, cb),
    onRequest: (cb) => subscribe(ChatWindowsEvent.request, cb),
  },
  terminals: {
    list: () => invoke(TerminalsInvoke.list),
    create: (sessionId, size) => invoke(TerminalsInvoke.create, sessionId, size),
    buffer: (id) => invoke(TerminalsInvoke.buffer, id),
    write: (id, data) => invoke(TerminalsInvoke.write, id, data),
    resize: (id, size) => invoke(TerminalsInvoke.resize, id, size),
    kill: (id) => invoke(TerminalsInvoke.kill, id),
    onData: (cb) => subscribe(TerminalsEvent.data, cb),
    onChanged: (cb) => subscribe(TerminalsEvent.changed, cb),
  },
  git: {
    ...deviceGit,
    worktreeCheck: (cwd) => invoke(FilesInvoke.gitWorktreeCheck, cwd),
  },
  browser: {
    tabs: () => invoke(BrowserInvoke.tabs),
    openTab: (sessionId, url, background) => invoke(BrowserInvoke.openTab, sessionId, url ?? null, background === true),
    closeTab: (id) => invoke(BrowserInvoke.closeTab, id),
    showTab: (sessionId, id) => invoke(BrowserInvoke.showTab, sessionId, id),
    page: (id, page) => invoke(BrowserInvoke.page, id, page),
    attach: (id, webContentsId) => invoke(BrowserInvoke.attach, id, webContentsId),
    favicon: (url) => invoke(BrowserInvoke.favicon, url),
    log: (id) => invoke(BrowserInvoke.log, id),
    clearLog: (id) => invoke(BrowserInvoke.clearLog, id),
    takeOver: (id, takenOver) => invoke(BrowserInvoke.takeOver, id, takenOver),
    controls: () => invoke(BrowserInvoke.controls),
    clearData: () => invoke(BrowserInvoke.clearData),
    resetViewport: (id) => invoke(BrowserInvoke.resetViewport, id),
    resetEmulation: (id) => invoke(BrowserInvoke.resetEmulation, id),
    resetRoutes: (id) => invoke(BrowserInvoke.resetRoutes, id),
    downloads: () => invoke(BrowserInvoke.downloads),
    downloadAction: (id, action) => invoke(BrowserInvoke.downloadAction, id, action),
    clearDownloads: () => invoke(BrowserInvoke.clearDownloads),
    answerLogin: (id, credentials) => invoke(BrowserInvoke.loginAnswer, id, credentials),
    watchFrames: (id, on) => invoke(BrowserInvoke.watchFrames, id, on),
    onTabs: (cb) => subscribe(BrowserEvent.tabs, cb),
    onShortcut: (cb) => subscribe(BrowserEvent.shortcut, cb),
    onOpenTab: (cb) => subscribe(BrowserEvent.openTab, cb),
    onDownloads: (cb) => subscribe(BrowserEvent.downloads, cb),
    onLogin: (cb) => subscribe(BrowserEvent.login, cb),
    onLoginDone: (cb) => subscribe(BrowserEvent.loginDone, cb),
    onActivity: (cb) => subscribe(BrowserEvent.activity, cb),
    onControl: (cb) => subscribe(BrowserEvent.control, cb),
    onHighlight: (cb) => subscribe(BrowserEvent.highlight, cb),
    onFocus: (cb) => subscribe(BrowserEvent.focus, cb),
    onUserClick: (cb) => subscribe(BrowserEvent.userClick, cb),
    onFrame: (cb) => subscribe(BrowserEvent.frame, cb),
  },
  app: {
    info: () => invoke(IpcInvoke.appInfo),
    openExternal: (url) => invoke(IpcInvoke.appOpenExternal, url),
    openPath: (path) => invoke(IpcInvoke.appOpenPath, path),
    showItem: (path) => invoke(IpcInvoke.appShowItem, path),
    pickDirectory: (defaultPath) => invoke(IpcInvoke.appPickDirectory, defaultPath ?? null),
    pickImages: () => invoke(IpcInvoke.appPickImages),
    pickFiles: (defaultPath) => invoke(IpcInvoke.appPickFiles, defaultPath ?? null),
    saveImage: (data, mime) => invoke(IpcInvoke.appSaveImage, data, mime),
    listFonts: () => invoke(IpcInvoke.appListFonts),
    pathForFile: (file) => webUtils.getPathForFile(file),
    onDialog: (cb) => subscribe(IpcEvent.appDialog, cb),
    answerDialog: (id, ok) => invoke(IpcInvoke.appDialogAnswer, id, ok),
    pendingDialogs: () => invoke(IpcInvoke.appDialogsPending),
  },
  window: {
    minimize: () => invoke(IpcInvoke.windowMinimize),
    toggleMaximize: () => invoke(IpcInvoke.windowToggleMaximize),
    state: () => invoke(IpcInvoke.windowState),
    setTitleBarColors: (colors) => invoke(IpcInvoke.windowSetTitleBarColors, colors),
    onState: (cb) => subscribe(IpcEvent.windowState, cb),
  },
  notifications: {
    viewing: (sessionId) => invoke(IpcInvoke.notificationsViewing, sessionId),
    test: () => invoke(IpcInvoke.notificationsTest),
    answer: (id, answer) => invoke(IpcInvoke.notificationsAnswer, id, answer),
    onAgent: (cb) => subscribe(IpcEvent.agentNotification, cb),
    onAgentDone: (cb) => subscribe(IpcEvent.agentNotificationDone, cb),
  },
  themes: {
    list: () => invoke(IpcInvoke.themesList),
    create: (theme) => invoke(IpcInvoke.themesCreate, theme),
    save: (id, theme) => invoke(IpcInvoke.themesSave, id, theme),
    remove: (id) => invoke(IpcInvoke.themesRemove, id),
    export: (id) => invoke(IpcInvoke.themesExport, id),
    import: (files) => invoke(IpcInvoke.themesImport, files ?? null),
    openFile: (id) => invoke(IpcInvoke.themesOpenFile, id),
    showFile: (id) => invoke(IpcInvoke.themesShowFile, id),
    openFolder: () => invoke(IpcInvoke.themesOpenFolder),
    onChanged: (cb) => subscribe(IpcEvent.themesChanged, cb),
    onSaved: (cb) => subscribe(IpcEvent.themesSaved, cb),
  },
  // Settings, CLIs, accounts, projects and chats: the same calls the window makes of other devices.
  ...device,
  api: {
    status: () => invoke(IpcInvoke.apiStatus),
  },
  command: {
    status: () => invoke(IpcInvoke.commandStatus),
    setRegistered: (registered) => invoke(IpcInvoke.commandSetRegistered, registered),
  },
}

contextBridge.exposeInMainWorld('api', api)
