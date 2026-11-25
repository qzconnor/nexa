import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir, release } from 'node:os'
import { existsSync } from 'node:fs'
import { basename, isAbsolute, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import { PROVIDER_IDS, type ProviderId } from '@shared/chat'
import { IpcEvent, IpcInvoke, type SectionCreateInput, type SectionUpdateInput } from '@shared/ipc'
import type { SectionLayout } from '@shared/sections'
import { parseThemeFile } from '@shared/themes/file'
import type { ThemeContent } from '@shared/themes/types'
import type { AppInfo, PromptTarget, SessionMoveInput } from '@shared/types'
import type { AccountCreateInput, AccountUpdateInput } from '@shared/accounts'
import { mergeAccounts } from './accounts/account-merge'
import type { AccountService } from './accounts/account-service'
import type { ApiServer } from './api/api-server'
import type { CommandIntegration } from './command-integration'
import type { GitService } from './files/git-service'
import { listFontFamilies } from './lib/fonts'
import type { AutoSwitch } from './services/auto-switch'
import type { NotificationService } from './services/notification-service'
import type { ProjectService } from './services/project-service'
import { projectToSection } from './services/project-sections'
import type { ProviderService } from './services/provider-service'
import type { SessionService } from './services/session-service'
import type { SettingsService } from './services/settings-service'
import { SettingsTransfer } from './services/settings-transfer'
import { gitBash } from './services/user-shells'
import type { ThemeService } from './services/theme-service'
import { fromAppWindow, openAppWindows, windowState } from './window/main-window'

export interface AppContext {
  userDataDir: string
  settings: SettingsService
  themes: ThemeService
  accounts: AccountService
  providers: ProviderService
  projects: ProjectService
  sessions: SessionService
  api: ApiServer
  git: GitService
  notifications: NotificationService
  autoSwitch: AutoSwitch
  command: CommandIntegration
}

const IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Sends an event to every window of the app. */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const win of openAppWindows()) win.webContents.send(channel, ...args)
}

export function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: never[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    // Only the app's own page may call; anything else gets nothing.
    if (!fromAppWindow(event)) throw new Error('Nicht erlaubt.')
    return (listener as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown)(event, ...args)
  })
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`${what} fehlt.`)
  return value
}

/** A list of ids from the window; an unknown id is simply not found. */
function idList(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) throw new Error(`${what} fehlen.`)
  return value as string[]
}

/** Whose prompt: a project or a separator, by id (the folder comes from Nexa's own list, never from the window). */
function promptTarget(value: unknown): PromptTarget {
  if (!value || typeof value !== 'object') throw new Error('Das Ziel des Prompts fehlt.')
  const { kind, id } = value as Record<string, unknown>
  if (kind !== 'project' && kind !== 'section') throw new Error('Unbekanntes Ziel des Prompts.')
  return { kind, id: str(id, 'Das Projekt') }
}

function absolutePath(value: unknown, what: string): string {
  const path = str(value, what)
  if (!path || path.length > 4096 || !isAbsolute(path) || path.includes('\0')) throw new Error(`Ungültiger Pfad: ${what}`)
  return path
}

/** Where a chat moves to, from the window: paths must be absolute, as from the folder dialog. */
function moveArg(value: unknown): SessionMoveInput {
  const target = objectArg<Record<string, unknown>>(value, 'Das Ziel')
  if (target.folder !== undefined) return { folder: absolutePath(target.folder, 'Der Ordner') }
  return { projectId: str(target.projectId, 'Das Projekt'), ...(target.cwd !== undefined ? { cwd: absolutePath(target.cwd, 'Der Ordner') } : {}) }
}

/** A theme from the window, checked like a file. */
function themeArg(value: unknown): ThemeContent {
  if (typeof value !== 'object' || value === null) throw new Error('Ungültiges Theme.')
  const { name, mode, colors, terminal } = value as Record<string, unknown>
  return parseThemeFile({ name, mode, colors, terminal }, 'Eigenes Theme')
}

const THEME_FILE_FILTERS = [{ name: 'Theme', extensions: ['json'] }]
const SETTINGS_FILE_FILTERS = [{ name: 'Einstellungen von Nexa', extensions: ['json'] }]

/** `2026-11-24`, for the name of an exported file. */
function localDate(date: Date): string {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, '0')).join('-')
}
/** Theme files taken over in one go. */
const MAX_THEME_IMPORT = 100

function providerId(value: unknown): ProviderId {
  if (!PROVIDER_IDS.includes(value as ProviderId)) throw new Error('Unbekannte CLI.')
  return value as ProviderId
}

/** A plain object from the window; its fields are checked by the service. */
function objectArg<T>(value: unknown, what: string): T {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} fehlt.`)
  return value as T
}

/** The order of the sidebar from the window: separators with the ids of their projects. */
function layoutArg(value: unknown): SectionLayout[] {
  if (!Array.isArray(value)) throw new Error('Die Reihenfolge fehlt.')
  return value.map((entry) => {
    const { id, projects } = objectArg<{ id?: unknown; projects?: unknown }>(entry, 'Der Trenner')
    if (!Array.isArray(projects) || !projects.every((p) => typeof p === 'string')) throw new Error('Die Projekte fehlen.')
    return { id: str(id, 'Der Trenner'), projects: projects as string[] }
  })
}

function windowOf(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('Kein Fenster.')
  return win
}

export function appInfo(userDataDir: string): AppInfo {
  return {
    version: app.getVersion(),
    platform: process.platform,
    userData: userDataDir,
    homeDir: homedir(),
    windowsBuild: process.platform === 'win32' ? Number(release().split('.')[2]) || null : null,
  }
}

export function registerIpc(ctx: AppContext): void {
  const { settings, themes, accounts, providers, projects, sessions } = ctx

  // App ----------------------------------------------------------------------------------------
  handle(IpcInvoke.appInfo, () => appInfo(ctx.userDataDir))
  handle(IpcInvoke.appOpenExternal, (_e, url: unknown) => {
    const target = str(url, 'Die Adresse')
    if (!/^(https?|mailto):/i.test(target)) throw new Error('Nur Web-Adressen lassen sich öffnen.')
    return shell.openExternal(target)
  })
  handle(IpcInvoke.appOpenPath, async (_e, path: unknown) => {
    const error = await shell.openPath(str(path, 'Der Pfad'))
    if (error) throw new Error(error)
  })
  handle(IpcInvoke.appShowItem, (_e, path: unknown) => shell.showItemInFolder(str(path, 'Der Pfad')))
  handle(IpcInvoke.appPickDirectory, async (event, defaultPath: unknown) => {
    const result = await dialog.showOpenDialog(windowOf(event), {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle(IpcInvoke.appPickImages, async (event) => {
    const result = await dialog.showOpenDialog(windowOf(event), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    })
    return result.canceled ? [] : result.filePaths
  })
  handle(IpcInvoke.appPickFiles, async (event, defaultPath: unknown) => {
    const result = await dialog.showOpenDialog(windowOf(event), {
      properties: ['openFile', 'multiSelections'],
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
    })
    return result.canceled ? [] : result.filePaths
  })
  handle(IpcInvoke.appSaveImage, async (_e, data: unknown, mime: unknown) => {
    if (!(data instanceof Uint8Array)) throw new Error('Das Bild fehlt.')
    if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('Das Bild ist zu groß (höchstens 20 MB).')
    const ext = IMAGE_TYPES[String(mime)]
    if (!ext) throw new Error('Nur PNG, JPEG, GIF und WebP gehen.')
    const dir = join(ctx.userDataDir, 'attachments')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${randomUUID()}.${ext}`)
    await writeFile(file, data)
    return file
  })
  handle(IpcInvoke.appListFonts, () => listFontFamilies())

  // Window -------------------------------------------------------------------------------------
  handle(IpcInvoke.windowMinimize, (event) => windowOf(event).minimize())
  handle(IpcInvoke.windowToggleMaximize, (event) => {
    const win = windowOf(event)
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  handle(IpcInvoke.windowState, (event) => windowState(windowOf(event)))
  handle(IpcInvoke.windowSetTitleBarColors, (event, colors: unknown) => {
    const { color, symbolColor, dark } = (colors ?? {}) as { color?: unknown; symbolColor?: unknown; dark?: unknown }
    // Mica's tint, the native menus and scroll bars and what web pages see as `prefers-color-scheme`
    // follow the theme's mode.
    if (typeof dark === 'boolean') nativeTheme.themeSource = dark ? 'dark' : 'light'
    if (process.platform === 'darwin' || typeof color !== 'string' || typeof symbolColor !== 'string') return
    windowOf(event).setTitleBarOverlay({ color, symbolColor })
  })

  // Settings & themes --------------------------------------------------------------------------
  handle(IpcInvoke.settingsGet, () => settings.get())
  handle(IpcInvoke.settingsUpdate, (_e, patch: unknown) => settings.update((patch ?? {}) as never))
  const transfer = new SettingsTransfer(
    {
      settings: () => settings.get(),
      accounts: () => accounts.list(),
      themes: () => themes.list(),
      fonts: listFontFamilies,
      exists: (path) => existsSync(path),
      // PowerShell 5.1 and cmd are part of Windows; elsewhere `!` runs the login shell whatever is set.
      hasShell: (shell) => process.platform !== 'win32' || shell !== 'gitbash' || gitBash(process.env, existsSync) !== null,
    },
    { version: app.getVersion(), platform: process.platform },
  )
  handle(IpcInvoke.settingsExport, async (event) => {
    const { canceled, filePath } = await dialog.showSaveDialog(windowOf(event), {
      title: 'Einstellungen exportieren',
      defaultPath: join(app.getPath('documents'), `nexa-einstellungen-${localDate(new Date())}.json`),
      filters: SETTINGS_FILE_FILTERS,
    })
    if (canceled || !filePath) return null
    await transfer.exportTo(filePath)
    return filePath
  })
  handle(IpcInvoke.settingsImportPreview, async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(windowOf(event), {
      title: 'Einstellungen importieren',
      defaultPath: app.getPath('documents'),
      properties: ['openFile'],
      filters: SETTINGS_FILE_FILTERS,
    })
    const file = filePaths[0]
    return canceled || !file ? null : transfer.preview(file)
  })
  handle(IpcInvoke.themesList, () => themes.list())
  handle(IpcInvoke.themesCreate, (_e, theme: unknown) => themes.create(themeArg(theme)))
  handle(IpcInvoke.themesSave, (_e, id: unknown, theme: unknown) => themes.save(str(id, 'id'), themeArg(theme)))
  handle(IpcInvoke.themesRemove, (_e, id: unknown) => themes.remove(str(id, 'id')))
  handle(IpcInvoke.themesExport, async (event, id: unknown) => {
    const themeId = str(id, 'id')
    const { canceled, filePath } = await dialog.showSaveDialog(windowOf(event), {
      title: 'Theme exportieren',
      defaultPath: join(app.getPath('documents'), basename(themes.fileOf(themeId))),
      filters: THEME_FILE_FILTERS,
    })
    if (canceled || !filePath) return null
    await themes.exportTo(themeId, filePath)
    return filePath
  })
  handle(IpcInvoke.themesImport, async (event, files: unknown) => {
    if (Array.isArray(files)) {
      if (files.length === 0 || files.length > MAX_THEME_IMPORT) throw new Error('Ungültige Dateien.')
      return themes.importFrom(files.map((file) => absolutePath(file, 'Datei')))
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(windowOf(event), {
      title: 'Themes importieren',
      defaultPath: app.getPath('documents'),
      properties: ['openFile', 'multiSelections'],
      filters: THEME_FILE_FILTERS,
    })
    return canceled || filePaths.length === 0 ? null : themes.importFrom(filePaths.slice(0, MAX_THEME_IMPORT))
  })
  handle(IpcInvoke.themesOpenFile, async (_e, id: unknown) => {
    const file = themes.fileOf(str(id, 'id'))
    if (!existsSync(file)) throw new Error('Die Datei des Themes gibt es nicht mehr.')
    // Without a program for JSON files, the file is shown in Explorer instead.
    if (!(await shell.openPath(file))) return true
    shell.showItemInFolder(file)
    return false
  })
  handle(IpcInvoke.themesShowFile, (_e, id: unknown) => {
    const file = themes.fileOf(str(id, 'id'))
    if (!existsSync(file)) throw new Error('Die Datei des Themes gibt es nicht mehr.')
    shell.showItemInFolder(file)
  })
  handle(IpcInvoke.themesOpenFolder, async () => {
    const error = await shell.openPath(themes.dir)
    if (error) throw new Error(error)
  })

  // Providers & usage --------------------------------------------------------------------------
  handle(IpcInvoke.providersList, () => providers.list())
  handle(IpcInvoke.providersRefresh, () => providers.detect())
  handle(IpcInvoke.providersModels, (_e, id: unknown) => providers.models(providerId(id)))
  handle(IpcInvoke.providersModelDefaults, (_e, id: unknown, account: unknown, model: unknown) =>
    providers.modelDefaults(providerId(id), typeof account === 'string' ? account : undefined, str(model, 'Das Modell').slice(0, 200)),
  )
  handle(IpcInvoke.providersCommands, (_e, id: unknown, account: unknown, cwd: unknown) =>
    // Without a project (the start page before one is picked), the user's own skills and commands.
    providers.commands(providerId(id), typeof account === 'string' ? account : undefined, cwd == null ? homedir() : absolutePath(cwd, 'Der Ordner')),
  )
  handle(IpcInvoke.usageGet, () => providers.usage())
  handle(IpcInvoke.usageRefresh, () => providers.refreshUsage(true))

  // Accounts -----------------------------------------------------------------------------------
  handle(IpcInvoke.accountsList, () => accounts.list())
  handle(IpcInvoke.accountsRefresh, () => accounts.refresh())
  handle(IpcInvoke.accountsCreate, (_e, input: unknown) => accounts.create(objectArg<AccountCreateInput>(input, 'Der Account')))
  handle(IpcInvoke.accountsUpdate, (_e, id: unknown, patch: unknown) => accounts.update(str(id, 'Der Account'), objectArg<AccountUpdateInput>(patch, 'Die Änderung')))
  handle(IpcInvoke.accountsRemove, (_e, id: unknown, deleteFolder: unknown) => accounts.remove(str(id, 'Der Account'), deleteFolder === true))
  handle(IpcInvoke.accountsMerge, (_e, from: unknown, into: unknown) =>
    mergeAccounts(accounts, sessions, settings, str(from, 'Der Account'), str(into, 'Der Account')),
  )
  handle(IpcInvoke.accountsReorder, (_e, ids: unknown) => accounts.reorder(idList(ids, 'Die Accounts')))
  handle(IpcInvoke.accountsLogins, () => providers.loginStates())
  handle(IpcInvoke.accountsLogin, (_e, id: unknown) => providers.login(str(id, 'Der Account')))
  handle(IpcInvoke.accountsLoginCode, (_e, id: unknown, code: unknown) => providers.loginCode(str(id, 'Der Account'), str(code, 'Der Code')))
  handle(IpcInvoke.accountsLoginCancel, (_e, id: unknown) => providers.cancelLogin(str(id, 'Der Account')))
  handle(IpcInvoke.accountsRenewLogin, (_e, id: unknown) => providers.renewLogin(str(id, 'Der Account')))
  handle(IpcInvoke.accountsLogout, (_e, id: unknown) => providers.logout(str(id, 'Der Account')))
  handle(IpcInvoke.usageStats, (_e, days: unknown) => sessions.stats(Math.min(365, Math.max(1, Number(days) || 30))))

  // Projects -----------------------------------------------------------------------------------
  handle(IpcInvoke.projectsList, () => projects.list())
  handle(IpcInvoke.projectsCreate, (_e, input: unknown) => projects.create(input as never))
  handle(IpcInvoke.projectsUpdate, (_e, id: unknown, patch: unknown) => projects.update(str(id, 'Das Projekt'), (patch ?? {}) as never))
  handle(IpcInvoke.projectsPrompt, (_e, target: unknown) => projects.readPrompt(promptTarget(target)))
  handle(IpcInvoke.projectsSetPrompt, (_e, target: unknown, text: unknown) => projects.writePrompt(promptTarget(target), str(text, 'Der Prompt')))
  handle(IpcInvoke.projectsRemove, async (_e, id: unknown) => {
    const projectId = str(id, 'Das Projekt')
    const result = await sessions.removeProject(projectId)
    await projects.remove(projectId)
    return result
  })
  handle(IpcInvoke.projectsArrange, (_e, layout: unknown) => projects.arrange(layoutArg(layout)))
  handle(IpcInvoke.projectsToSection, (_e, id: unknown) => projectToSection(projects, sessions, str(id, 'Das Projekt')))
  handle(IpcInvoke.sectionsList, () => projects.sections())
  handle(IpcInvoke.sectionsCreate, (_e, input: unknown) => projects.createSection(objectArg<SectionCreateInput>(input, 'Der Trenner')))
  handle(IpcInvoke.sectionsUpdate, (_e, id: unknown, patch: unknown) =>
    projects.updateSection(str(id, 'Der Trenner'), objectArg<SectionUpdateInput>(patch, 'Die Änderung')),
  )
  handle(IpcInvoke.sectionsRemove, (_e, id: unknown) => projects.removeSection(str(id, 'Der Trenner')))

  // Sessions -----------------------------------------------------------------------------------
  handle(IpcInvoke.sessionsList, () => sessions.list())
  handle(IpcInvoke.sessionsCreate, (_e, input: unknown) => sessions.create(input as never))
  handle(IpcInvoke.sessionsOpen, (_e, id: unknown) => sessions.open(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsSend, (_e, id: unknown, input: unknown) => sessions.send(str(id, 'Die Session'), input as never))
  handle(IpcInvoke.sessionsEdit, (_e, id: unknown, itemId: unknown, input: unknown) =>
    sessions.edit(str(id, 'Die Session'), str(itemId, 'Der Prompt'), input as never),
  )
  handle(IpcInvoke.sessionsInterrupt, (_e, id: unknown) => sessions.interrupt(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsRespond, (_e, id: unknown, itemId: unknown, response: unknown) =>
    sessions.respond(str(id, 'Die Session'), str(itemId, 'Die Frage'), response as never),
  )
  handle(IpcInvoke.sessionsShellOutput, (_e, id: unknown, itemId: unknown) => sessions.shellOutput(str(id, 'Die Session'), str(itemId, 'Die Shell')))
  handle(IpcInvoke.sessionsStopShell, (_e, id: unknown, itemId: unknown) => sessions.stopShell(str(id, 'Die Session'), str(itemId, 'Die Shell')))
  handle(IpcInvoke.sessionsRunShell, (_e, id: unknown, command: unknown) => sessions.runShell(str(id, 'Die Session'), str(command, 'Der Befehl').slice(0, 100_000)))
  handle(IpcInvoke.sessionsContext, (_e, id: unknown) => sessions.contextDetail(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsMcpServers, (_e, id: unknown) => sessions.mcpServers(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsSetMcp, (_e, id: unknown, name: unknown, enabled: unknown) =>
    sessions.setMcpEnabled(str(id, 'Die Session'), str(name, 'Der Server'), enabled === true),
  )
  handle(IpcInvoke.sessionsReconnectMcp, (_e, id: unknown, name: unknown) => sessions.reconnectMcp(str(id, 'Die Session'), str(name, 'Der Server')))
  handle(IpcInvoke.sessionsAuthenticateMcp, (_e, id: unknown, name: unknown) => sessions.authenticateMcp(str(id, 'Die Session'), str(name, 'Der Server')))
  handle(IpcInvoke.sessionsConfigTarget, (_e, id: unknown) => sessions.configTarget(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsPlugins, (_e, id: unknown) => sessions.plugins(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsSetPlugin, (_e, id: unknown, pluginId: unknown, enabled: unknown) =>
    sessions.setPluginEnabled(str(id, 'Die Session'), str(pluginId, 'Das Plugin'), enabled === true),
  )
  handle(IpcInvoke.sessionsSync, (_e, id: unknown) => sessions.syncCli(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsUpdate, (_e, id: unknown, patch: unknown) => sessions.update(str(id, 'Die Session'), (patch ?? {}) as never))
  handle(IpcInvoke.sessionsRemove, (_e, ids: unknown) => sessions.remove(idList(ids, 'Die Sessions')))
  handle(IpcInvoke.sessionsStorage, () => sessions.storage())
  handle(IpcInvoke.sessionsStop, (_e, id: unknown) => sessions.stop(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsRestart, (_e, id: unknown) => sessions.restart(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsResumeAtReset, (_e, id: unknown, on: unknown) => ctx.autoSwitch.resumeAtReset(str(id, 'Die Session'), on === true))
  handle(IpcInvoke.sessionsSearch, (_e, query: unknown) => sessions.search(typeof query === 'string' ? query.slice(0, 200) : ''))
  handle(IpcInvoke.sessionsMove, (_e, id: unknown, target: unknown) => sessions.move(str(id, 'Die Session'), moveArg(target)))
  handle(IpcInvoke.sessionsCompact, (_e, id: unknown) => sessions.compact(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsFork, (_e, id: unknown) => sessions.fork(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsClear, (_e, id: unknown) => sessions.clear(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsLastAnswer, (_e, id: unknown) => sessions.lastAnswer(str(id, 'Die Session')))
  handle(IpcInvoke.sessionsExportMarkdown, async (event, id: unknown) => {
    const { markdown, fileName } = await sessions.markdown(str(id, 'Die Session'), async (cwd) => (await ctx.git.branch(cwd))?.name ?? null)
    const { canceled, filePath } = await dialog.showSaveDialog(windowOf(event), {
      title: 'Chat als Markdown speichern',
      defaultPath: join(app.getPath('documents'), fileName),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (canceled || !filePath) return null
    await writeFile(filePath, markdown, 'utf8')
    return filePath
  })

  handle(IpcInvoke.apiStatus, () => ctx.api.status())

  // The `nx` command ------------------------------------------------------------------------------
  handle(IpcInvoke.commandStatus, () => ctx.command.status())
  handle(IpcInvoke.commandSetRegistered, (_e, registered: unknown) => {
    if (typeof registered !== 'boolean') throw new Error('Ungültiger Parameter: registered')
    return ctx.command.setRegistered(registered)
  })

  handle(IpcInvoke.notificationsViewing, (_e, sessionId: unknown) =>
    ctx.notifications.setViewing(typeof sessionId === 'string' && sessionId ? sessionId : null),
  )
  handle(IpcInvoke.notificationsTest, () => ctx.notifications.showTest())

  // Events -------------------------------------------------------------------------------------
  settings.on('changed', (next) => broadcast(IpcEvent.settingsChanged, next))
  themes.on('changed', () => broadcast(IpcEvent.themesChanged))
  themes.on('saved', (entry) => broadcast(IpcEvent.themesSaved, entry))
  providers.on('status', (list) => broadcast(IpcEvent.providersChanged, list))
  providers.on('login', (state) => broadcast(IpcEvent.accountsLogin, state))
  accounts.on('changed', (list) => broadcast(IpcEvent.accountsChanged, list))
  providers.on('usage', (list) => broadcast(IpcEvent.usageChanged, list))
  projects.on('changed', (list) => broadcast(IpcEvent.projectsChanged, list))
  projects.on('sections', (list) => broadcast(IpcEvent.sectionsChanged, list))
  sessions.on('changed', (list) => broadcast(IpcEvent.sessionsChanged, list))
  sessions.on('event', (event) => broadcast(IpcEvent.sessionEvent, event))
}

export function forwardWindowState(win: BrowserWindow): void {
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(IpcEvent.windowState, windowState(win))
  }
  for (const event of ['maximize', 'unmaximize', 'focus', 'blur', 'enter-full-screen', 'leave-full-screen'] as const) {
    win.on(event as 'maximize', send)
  }
}
