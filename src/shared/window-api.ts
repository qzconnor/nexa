/**
 * The parts of the window API a chat, its dock and the sidebar use, built from a way to call a channel
 * and one to listen to an event: the preload builds them on IPC for this device, the window builds them
 * on Remote Control for another one (renderer `lib/device-api.ts`). So both have the same calls on the
 * same channels, and the host answers another device's with the handlers its own windows use.
 */

import { FilesEvent, FilesInvoke, type FilesApi, type GitApi } from './files-ipc'
import { IpcEvent, IpcInvoke, type NexaApi, type Unsubscribe } from './ipc'
import { McpAppsInvoke, type McpAppsApi } from './mcp-apps'

export type ChannelInvoke = <T>(channel: string, ...args: unknown[]) => Promise<T>
export type ChannelSubscribe = <Args extends unknown[]>(channel: string, cb: (...args: Args) => void) => Unsubscribe

/** What a device offers the chat window: its settings, CLIs, accounts, projects and chats. */
export type DeviceApi = Pick<NexaApi, 'settings' | 'providers' | 'accounts' | 'usage' | 'projects' | 'sessions'> & {
  /** What the page of an MCP tool asks of its server, there (opening it goes through main: `openRemote`). */
  mcpApps: Pick<McpAppsApi, 'callTool' | 'readResource'>
  /** The file panel beside a chat: on another device only in the folders of its chats (the host checks). */
  files: FilesApi
  git: Pick<GitApi, 'branch' | 'watch' | 'onBranchChanged' | 'webUrl' | 'mainWorktree'>
}

export function deviceApi(invoke: ChannelInvoke, subscribe: ChannelSubscribe): DeviceApi {
  return {
    settings: {
      get: () => invoke(IpcInvoke.settingsGet),
      update: (patch) => invoke(IpcInvoke.settingsUpdate, patch),
      exportToFile: () => invoke(IpcInvoke.settingsExport),
      previewImport: () => invoke(IpcInvoke.settingsImportPreview),
      onChanged: (cb) => subscribe(IpcEvent.settingsChanged, cb),
      onOpen: (cb) => subscribe(IpcEvent.openSettings, cb),
    },
    providers: {
      list: () => invoke(IpcInvoke.providersList),
      refresh: () => invoke(IpcInvoke.providersRefresh),
      models: (provider) => invoke(IpcInvoke.providersModels, provider),
      modelDefaults: (provider, account, model) => invoke(IpcInvoke.providersModelDefaults, provider, account, model),
      commands: (provider, account, cwd) => invoke(IpcInvoke.providersCommands, provider, account, cwd),
      onChanged: (cb) => subscribe(IpcEvent.providersChanged, cb),
    },
    accounts: {
      list: () => invoke(IpcInvoke.accountsList),
      refresh: () => invoke(IpcInvoke.accountsRefresh),
      create: (input) => invoke(IpcInvoke.accountsCreate, input),
      update: (id, patch) => invoke(IpcInvoke.accountsUpdate, id, patch),
      remove: (id, deleteFolder) => invoke(IpcInvoke.accountsRemove, id, deleteFolder),
      merge: (from, into) => invoke(IpcInvoke.accountsMerge, from, into),
      reorder: (ids) => invoke(IpcInvoke.accountsReorder, ids),
      logins: () => invoke(IpcInvoke.accountsLogins),
      login: (id) => invoke(IpcInvoke.accountsLogin, id),
      loginCode: (id, code) => invoke(IpcInvoke.accountsLoginCode, id, code),
      cancelLogin: (id) => invoke(IpcInvoke.accountsLoginCancel, id),
      renewLogin: (id) => invoke(IpcInvoke.accountsRenewLogin, id),
      logout: (id) => invoke(IpcInvoke.accountsLogout, id),
      onChanged: (cb) => subscribe(IpcEvent.accountsChanged, cb),
      onLogin: (cb) => subscribe(IpcEvent.accountsLogin, cb),
    },
    usage: {
      get: () => invoke(IpcInvoke.usageGet),
      refresh: () => invoke(IpcInvoke.usageRefresh),
      stats: (days) => invoke(IpcInvoke.usageStats, days),
      onChanged: (cb) => subscribe(IpcEvent.usageChanged, cb),
    },
    projects: {
      list: () => invoke(IpcInvoke.projectsList),
      create: (input) => invoke(IpcInvoke.projectsCreate, input),
      update: (id, patch) => invoke(IpcInvoke.projectsUpdate, id, patch),
      prompt: (target) => invoke(IpcInvoke.projectsPrompt, target),
      setPrompt: (target, text) => invoke(IpcInvoke.projectsSetPrompt, target, text),
      remove: (id) => invoke(IpcInvoke.projectsRemove, id),
      onChanged: (cb) => subscribe(IpcEvent.projectsChanged, cb),
      arrange: (layout) => invoke(IpcInvoke.projectsArrange, layout),
      toSection: (id) => invoke(IpcInvoke.projectsToSection, id),
      sections: () => invoke(IpcInvoke.sectionsList),
      createSection: (input) => invoke(IpcInvoke.sectionsCreate, input),
      updateSection: (id, patch) => invoke(IpcInvoke.sectionsUpdate, id, patch),
      removeSection: (id) => invoke(IpcInvoke.sectionsRemove, id),
      onSectionsChanged: (cb) => subscribe(IpcEvent.sectionsChanged, cb),
    },
    sessions: {
      list: () => invoke(IpcInvoke.sessionsList),
      runtimes: () => invoke(IpcInvoke.sessionsRuntimes),
      create: (input) => invoke(IpcInvoke.sessionsCreate, input),
      open: (id) => invoke(IpcInvoke.sessionsOpen, id),
      send: (id, input) => invoke(IpcInvoke.sessionsSend, id, input),
      edit: (id, itemId, input) => invoke(IpcInvoke.sessionsEdit, id, itemId, input),
      interrupt: (id) => invoke(IpcInvoke.sessionsInterrupt, id),
      respond: (id, itemId, response) => invoke(IpcInvoke.sessionsRespond, id, itemId, response),
      shellOutput: (id, itemId) => invoke(IpcInvoke.sessionsShellOutput, id, itemId),
      stopShell: (id, itemId) => invoke(IpcInvoke.sessionsStopShell, id, itemId),
      runShell: (id, command) => invoke(IpcInvoke.sessionsRunShell, id, command),
      context: (id) => invoke(IpcInvoke.sessionsContext, id),
      mcpServers: (id) => invoke(IpcInvoke.sessionsMcpServers, id),
      setMcp: (id, name, enabled) => invoke(IpcInvoke.sessionsSetMcp, id, name, enabled),
      reconnectMcp: (id, name) => invoke(IpcInvoke.sessionsReconnectMcp, id, name),
      authenticateMcp: (id, name) => invoke(IpcInvoke.sessionsAuthenticateMcp, id, name),
      configTarget: (id) => invoke(IpcInvoke.sessionsConfigTarget, id),
      plugins: (id) => invoke(IpcInvoke.sessionsPlugins, id),
      setPlugin: (id, pluginId, enabled) => invoke(IpcInvoke.sessionsSetPlugin, id, pluginId, enabled),
      sync: (id) => invoke(IpcInvoke.sessionsSync, id),
      update: (id, patch) => invoke(IpcInvoke.sessionsUpdate, id, patch),
      remove: (ids) => invoke(IpcInvoke.sessionsRemove, ids),
      storage: () => invoke(IpcInvoke.sessionsStorage),
      stop: (id) => invoke(IpcInvoke.sessionsStop, id),
      restart: (id) => invoke(IpcInvoke.sessionsRestart, id),
      resumeAtReset: (id, on) => invoke(IpcInvoke.sessionsResumeAtReset, id, on),
      search: (query) => invoke(IpcInvoke.sessionsSearch, query),
      move: (id, target) => invoke(IpcInvoke.sessionsMove, id, target),
      compact: (id) => invoke(IpcInvoke.sessionsCompact, id),
      fork: (id) => invoke(IpcInvoke.sessionsFork, id),
      clear: (id) => invoke(IpcInvoke.sessionsClear, id),
      exportMarkdown: (id) => invoke(IpcInvoke.sessionsExportMarkdown, id),
      lastAnswer: (id) => invoke(IpcInvoke.sessionsLastAnswer, id),
      changes: (id, live) => invoke(IpcInvoke.sessionsChanges, id, live === true),
      changeDiff: (id, promptId, path, full) => invoke(IpcInvoke.sessionsChangeDiff, id, promptId, path, full),
      rewindPreview: (id, promptId) => invoke(IpcInvoke.sessionsRewindPreview, id, promptId),
      rewind: (id, promptId) => invoke(IpcInvoke.sessionsRewind, id, promptId),
      rewindUndo: (id) => invoke(IpcInvoke.sessionsRewindUndo, id),
      onChanged: (cb) => subscribe(IpcEvent.sessionsChanged, cb),
      onEvent: (cb) => subscribe(IpcEvent.sessionEvent, cb),
      onShow: (cb) => subscribe(IpcEvent.showSession, cb),
      onFind: (cb) => subscribe(IpcEvent.findSessions, cb),
    },
    mcpApps: {
      callTool: (sessionId, itemId, name, args) => invoke(McpAppsInvoke.callTool, sessionId, itemId, name, args),
      readResource: (sessionId, itemId, uri) => invoke(McpAppsInvoke.readResource, sessionId, itemId, uri),
    },
    files: {
      list: (dir) => invoke(FilesInvoke.list, dir),
      status: (root) => invoke(FilesInvoke.status, root),
      searchList: (root) => invoke(FilesInvoke.searchList, root),
      watch: (trees) => invoke(FilesInvoke.watch, trees),
      onChanged: (cb) => subscribe(FilesEvent.changed, cb),
      diff: (root, path, full, base) => invoke(FilesInvoke.diff, root, path, full, base ?? null),
      reviewBase: (root) => invoke(FilesInvoke.reviewBase, root),
      create: (root, path, dir) => invoke(FilesInvoke.create, root, path, dir),
      rename: (root, from, to) => invoke(FilesInvoke.rename, root, from, to),
      trash: (root, path) => invoke(FilesInvoke.trash, root, path),
      grep: (root, query) => invoke(FilesInvoke.grep, root, query),
      stage: (root, path) => invoke(FilesInvoke.stage, root, path),
      unstage: (root, path) => invoke(FilesInvoke.unstage, root, path),
      discard: (root, path) => invoke(FilesInvoke.discard, root, path),
      hunk: (root, path, change) => invoke(FilesInvoke.hunk, root, path, change),
      history: (sessionId) => invoke(FilesInvoke.history, sessionId),
      onTouched: (cb) => subscribe(FilesEvent.touched, cb),
    },
    git: {
      branch: (cwd) => invoke(FilesInvoke.gitBranch, cwd),
      watch: (cwds) => invoke(FilesInvoke.gitWatch, cwds),
      webUrl: (cwd) => invoke(FilesInvoke.gitWebUrl, cwd),
      mainWorktree: (cwd) => invoke(FilesInvoke.gitMainWorktree, cwd),
      onBranchChanged: (cb) => subscribe(FilesEvent.gitBranchChanged, cb),
    },
  }
}
