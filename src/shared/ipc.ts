import type { Account, AccountCreateInput, AccountLoginState, AccountUpdateInput } from './accounts'
import type { ContextDetail, InteractionResponse, ProviderId, SessionEvent } from './chat'
import type { AppTheme, CustomThemeEntry, ThemeContent, ThemeImportResult } from './themes/types'
import type {
  ApiStatus,
  AppInfo,
  AppSettings,
  CommandOption,
  DeepPartial,
  McpServerInfo,
  ModelDefaults,
  ModelOption,
  Platform,
  Project,
  ProjectSection,
  ProviderStatus,
  ProviderUsage,
  UsageStats,
  SendInput,
  SessionCreateInput,
  SessionDetail,
  SessionMeta,
  SessionMoveInput,
  SessionSearchHit,
  SessionUpdateInput,
  ShellOutput,
  WindowState,
} from './types'
import type { FilesApi, GitApi } from './files-ipc'
import type { BrowserApi } from './browser-ipc'
import type { UpdatesApi } from './updates'
import type { ImportApi } from './import-ipc'
import type { SectionLayout } from './sections'

/** Request/response channels (ipcRenderer.invoke ↔ ipcMain.handle). */
export const IpcInvoke = {
  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  appOpenPath: 'app:open-path',
  appShowItem: 'app:show-item',
  appPickDirectory: 'app:pick-directory',
  appPickImages: 'app:pick-images',
  appPickFiles: 'app:pick-files',
  appSaveImage: 'app:save-image',

  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowState: 'window:state',
  windowSetTitleBarColors: 'window:set-title-bar-colors',

  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',

  themesList: 'themes:list',
  themesCreate: 'themes:create',
  themesSave: 'themes:save',
  themesRemove: 'themes:remove',
  themesExport: 'themes:export',
  themesImport: 'themes:import',
  themesOpenFile: 'themes:open-file',
  themesShowFile: 'themes:show-file',
  themesOpenFolder: 'themes:open-folder',

  providersList: 'providers:list',
  providersRefresh: 'providers:refresh',
  providersModels: 'providers:models',
  providersModelDefaults: 'providers:model-defaults',
  providersCommands: 'providers:commands',

  accountsList: 'accounts:list',
  accountsRefresh: 'accounts:refresh',
  accountsCreate: 'accounts:create',
  accountsUpdate: 'accounts:update',
  accountsRemove: 'accounts:remove',
  accountsMerge: 'accounts:merge',
  accountsLogins: 'accounts:logins',
  accountsLogin: 'accounts:login',
  accountsLoginCode: 'accounts:login-code',
  accountsLoginCancel: 'accounts:login-cancel',

  usageGet: 'usage:get',
  usageRefresh: 'usage:refresh',
  usageStats: 'usage:stats',

  projectsList: 'projects:list',
  projectsCreate: 'projects:create',
  projectsUpdate: 'projects:update',
  projectsRemove: 'projects:remove',
  projectsArrange: 'projects:arrange',
  projectsToSection: 'projects:to-section',
  sectionsList: 'sections:list',
  sectionsCreate: 'sections:create',
  sectionsUpdate: 'sections:update',
  sectionsRemove: 'sections:remove',

  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsOpen: 'sessions:open',
  sessionsSend: 'sessions:send',
  sessionsInterrupt: 'sessions:interrupt',
  sessionsRespond: 'sessions:respond',
  sessionsShellOutput: 'sessions:shell-output',
  sessionsStopShell: 'sessions:stop-shell',
  sessionsContext: 'sessions:context',
  sessionsMcpServers: 'sessions:mcp-servers',
  sessionsSetMcp: 'sessions:set-mcp',
  sessionsUpdate: 'sessions:update',
  sessionsRemove: 'sessions:remove',
  sessionsStop: 'sessions:stop',
  sessionsSearch: 'sessions:search',
  sessionsMove: 'sessions:move',

  apiStatus: 'api:status',
} as const

/** Events from main to the window. */
export const IpcEvent = {
  windowState: 'event:window-state',
  settingsChanged: 'event:settings-changed',
  /** A file in the themes folder came, went or changed (also by hand). */
  themesChanged: 'event:themes-changed',
  /** The app wrote a theme, with the theme. */
  themesSaved: 'event:themes-saved',
  providersChanged: 'event:providers-changed',
  accountsChanged: 'event:accounts-changed',
  /** A browser login of an account moved on (link known, done, failed). */
  accountsLogin: 'event:accounts-login',
  usageChanged: 'event:usage-changed',
  projectsChanged: 'event:projects-changed',
  sectionsChanged: 'event:sections-changed',
  sessionsChanged: 'event:sessions-changed',
  sessionEvent: 'event:session',
  /** The `nx` command or the local API asks the window to show a session. */
  showSession: 'event:show-session',
} as const

export type Unsubscribe = () => void

export interface ProjectCreateInput {
  path: string
  name?: string
  /** Create the folder if it doesn't exist. */
  create?: boolean
  /** The separator it comes under; else the one whose folder it lies in, else the default one. */
  sectionId?: string
}

export interface SectionCreateInput {
  name?: string
  /** The folder it stands for (its subfolders are the projects in it). */
  path?: string
  /** The separator it comes after; else it comes last. */
  after?: string
}

export type SectionUpdateInput = Partial<Pick<ProjectSection, 'name' | 'collapsed'>>

export interface NexaApi {
  platform: Platform
  /** The file panel beside the chat (shared/files-ipc.ts). */
  files: FilesApi
  git: GitApi
  /** The browser beside each chat (shared/browser-ipc.ts). */
  browser: BrowserApi
  /** New versions and their release notes (shared/updates.ts). */
  updates: UpdatesApi
  /** Taking over from the Claude Manager (shared/import-ipc.ts). */
  claudeManager: ImportApi
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): Promise<void>
    openPath(path: string): Promise<void>
    showItem(path: string): Promise<void>
    pickDirectory(defaultPath?: string): Promise<string | null>
    pickImages(): Promise<string[]>
    /** Any files, for the composer's „Dateien oder Fotos hinzufügen“. */
    pickFiles(defaultPath?: string): Promise<string[]>
    /** Saves an image pasted into the composer, returns its path. */
    saveImage(data: Uint8Array, mime: string): Promise<string>
    pathForFile(file: File): string
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    state(): Promise<WindowState>
    setTitleBarColors(colors: { color: string; symbolColor: string }): Promise<void>
    onState(cb: (state: WindowState) => void): Unsubscribe
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: DeepPartial<AppSettings>): Promise<AppSettings>
    onChanged(cb: (settings: AppSettings) => void): Unsubscribe
  }
  /** The user's own themes, one JSON file each in the folder `themes` of the app's data. */
  themes: {
    /** Every file of the folder; ones that can't be used with the reason. */
    list(): Promise<CustomThemeEntry[]>
    /** Saves a new theme (a name another theme has gets a number). */
    create(theme: ThemeContent): Promise<CustomThemeEntry>
    /** Saves the theme `id`; a new name renames its file, so its id changes. */
    save(id: string, theme: ThemeContent): Promise<CustomThemeEntry>
    /** Moves the file to the recycle bin. */
    remove(id: string): Promise<void>
    /** Saves the theme to a file the user picks. The path, or null when cancelled. */
    export(id: string): Promise<string | null>
    /** Takes over themes from `files`, or from files the user picks without; null when cancelled. */
    import(files?: string[]): Promise<ThemeImportResult | null>
    /** Opens the file in the program for JSON; false when there is none (the file is shown in Explorer then). */
    openFile(id: string): Promise<boolean>
    /** Shows the file selected in Explorer (the file manager). */
    showFile(id: string): Promise<void>
    openFolder(): Promise<void>
    onChanged(cb: () => void): Unsubscribe
    /** A theme the app wrote, before the folder's watcher reports it. */
    onSaved(cb: (entry: CustomThemeEntry) => void): Unsubscribe
  }
  providers: {
    list(): Promise<ProviderStatus[]>
    refresh(): Promise<ProviderStatus[]>
    models(provider: ProviderId): Promise<ModelOption[]>
    /** What a model runs with when no effort is named; `account`: one of the CLI's, else its default. */
    modelDefaults(provider: ProviderId, account: string | undefined, model: string): Promise<ModelDefaults>
    /** The commands and skills the composer offers in a folder (null: the user's home, no project yet). */
    commands(provider: ProviderId, account: string | undefined, cwd: string | null): Promise<CommandOption[]>
    onChanged(cb: (list: ProviderStatus[]) => void): Unsubscribe
  }
  /** Several logins per CLI, each with its own config folder (see shared/accounts.ts). */
  accounts: {
    list(): Promise<Account[]>
    /** Reads the logins from the CLIs' files again. */
    refresh(): Promise<Account[]>
    create(input: AccountCreateInput): Promise<Account>
    update(id: string, patch: AccountUpdateInput): Promise<Account>
    /** `deleteFolder`: also Nexa's profile folder of the account (never one the user picked). */
    remove(id: string, deleteFolder: boolean): Promise<void>
    /** Folds `from` into `into` (the same login): its chats go on with `into`, its folder stays. */
    merge(from: string, into: string): Promise<void>
    /** The browser logins that run. */
    logins(): Promise<AccountLoginState[]>
    /** Starts the CLI's browser login for the account. */
    login(id: string): Promise<AccountLoginState>
    /** A code the browser showed, for the CLI that waits for it. */
    loginCode(id: string, code: string): Promise<void>
    cancelLogin(id: string): Promise<void>
    onChanged(cb: (list: Account[]) => void): Unsubscribe
    onLogin(cb: (state: AccountLoginState) => void): Unsubscribe
  }
  usage: {
    get(): Promise<ProviderUsage[]>
    /** Reads the limits of every account, also of those whose CLI isn't running. */
    refresh(): Promise<ProviderUsage[]>
    /** Tokens and turns of Nexa's chats per day, the last `days` days. */
    stats(days: number): Promise<UsageStats>
    onChanged(cb: (list: ProviderUsage[]) => void): Unsubscribe
  }
  projects: {
    list(): Promise<Project[]>
    create(input: ProjectCreateInput): Promise<Project>
    update(id: string, patch: Partial<Pick<Project, 'name' | 'collapsed'>>): Promise<Project>
    remove(id: string): Promise<void>
    onChanged(cb: (list: Project[]) => void): Unsubscribe
    /** The order of separators and projects after a drag and drop (shared/sections.ts). */
    arrange(layout: SectionLayout[]): Promise<void>
    /** Makes a project a separator for its folder: its subfolders with chats become projects under it. */
    toSection(id: string): Promise<ProjectSection>
    sections(): Promise<ProjectSection[]>
    createSection(input: SectionCreateInput): Promise<ProjectSection>
    updateSection(id: string, patch: SectionUpdateInput): Promise<ProjectSection>
    /** Its projects go to the default separator. */
    removeSection(id: string): Promise<void>
    onSectionsChanged(cb: (list: ProjectSection[]) => void): Unsubscribe
  }
  sessions: {
    list(): Promise<SessionMeta[]>
    create(input: SessionCreateInput): Promise<SessionMeta>
    /** The session with its chat; doesn't start the CLI. */
    open(id: string): Promise<SessionDetail>
    send(id: string, input: SendInput): Promise<void>
    interrupt(id: string): Promise<void>
    respond(id: string, itemId: string, response: InteractionResponse): Promise<void>
    /** The end of a shell's output (`itemId`: its tool item, see `ToolItem.shell`). */
    shellOutput(id: string, itemId: string): Promise<ShellOutput>
    stopShell(id: string, itemId: string): Promise<void>
    /** What fills the chat's context, by kind, if its CLI tells (Claude Code while it runs). */
    context(id: string): Promise<ContextDetail | null>
    /** The MCP servers of the chat's CLI, each on or off for its project. */
    mcpServers(id: string): Promise<McpServerInfo[]>
    /** Switches a server on or off for the chat's project (its running chats take it at once or with the next prompt). */
    setMcp(id: string, name: string, enabled: boolean): Promise<void>
    update(id: string, patch: SessionUpdateInput): Promise<SessionMeta>
    remove(id: string): Promise<void>
    /** Ends the CLI process of the session; the next prompt resumes it. */
    stop(id: string): Promise<void>
    /** Chats whose prompts and answers hold every word of `query`; empty: reads them ahead for the next search. */
    search(query: string): Promise<SessionSearchHit[]>
    /** Into another project or folder: the chat goes on there with its conversation (not while its CLI works). */
    move(id: string, target: SessionMoveInput): Promise<SessionMeta>
    onChanged(cb: (list: SessionMeta[]) => void): Unsubscribe
    onEvent(cb: (event: SessionEvent) => void): Unsubscribe
    onShow(cb: (id: string) => void): Unsubscribe
  }
  api: {
    status(): Promise<ApiStatus>
  }
}

export type { AppTheme }
