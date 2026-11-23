import type { BrowserCredentials, BrowserDownloadAction } from '@shared/browser'
import { BrowserEvent, BrowserInvoke } from '@shared/browser-ipc'
import { broadcast, handle } from '../ipc'
import { browserDownloads } from '../window/browser-downloads'
import { clearBrowserData, loadFavicon } from '../window/browser-guests'
import { browserLogins } from '../window/browser-logins'
import type { BrowserControl } from './browser-control'
import type { BrowserTabs } from './browser-tabs'

/** A page's icon address; inline icons are data URLs of up to the largest icon (see browser-policy.ts). */
const MAX_FAVICON_URL_LENGTH = 400_000
const MAX_CREDENTIAL_LENGTH = 4096
const MAX_ID_LENGTH = 200
const DOWNLOAD_ACTIONS: ReadonlySet<string> = new Set<BrowserDownloadAction>(['open', 'show', 'cancel', 'remove'])

function requireId(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value || value.length > MAX_ID_LENGTH) throw new Error(`Ungültiger Parameter: ${name}`)
  return value
}

function credentialsOf(value: unknown): BrowserCredentials | null {
  if (value === null || typeof value !== 'object') return null
  const { username, password } = value as Record<string, unknown>
  if (typeof username !== 'string' || typeof password !== 'string') throw new Error('Ungültiger Parameter: credentials')
  if (username.length > MAX_CREDENTIAL_LENGTH || password.length > MAX_CREDENTIAL_LENGTH) throw new Error('Ungültiger Parameter: credentials')
  return { username, password }
}

/** The window's side of the chats' browsers: their tabs, pages, downloads, logins and the agents' control. */
export function registerBrowserIpc(tabs: BrowserTabs, control: BrowserControl, sessionExists: (id: string) => boolean): void {
  handle(BrowserInvoke.tabs, () => tabs.state())
  handle(BrowserInvoke.openTab, (_e, sessionId: unknown, url: unknown, background: unknown) => {
    const session = requireId(sessionId, 'sessionId')
    if (!sessionExists(session)) throw new Error('Den Chat gibt es nicht mehr.')
    return tabs.open(session, { url: typeof url === 'string' ? url : null, background: background === true })
  })
  handle(BrowserInvoke.closeTab, (_e, id: unknown) => tabs.close(requireId(id, 'id')))
  handle(BrowserInvoke.showTab, (_e, sessionId: unknown, id: unknown) => tabs.show(requireId(sessionId, 'sessionId'), requireId(id, 'id')))
  handle(BrowserInvoke.page, (_e, id: unknown, page: unknown) => {
    const { url, title } = (page ?? {}) as Record<string, unknown>
    if (typeof url === 'string' && typeof title === 'string') tabs.setPage(requireId(id, 'id'), { url, title })
  })
  // The sender is the window that holds the page's `<webview>`: only its own guests can be attached.
  handle(BrowserInvoke.attach, (event, id: unknown, contentsId: unknown) => {
    if (typeof contentsId === 'number') control.attach(requireId(id, 'id'), contentsId, event.sender)
  })
  handle(BrowserInvoke.favicon, (_e, url: unknown) => (typeof url === 'string' && url.length <= MAX_FAVICON_URL_LENGTH ? loadFavicon(url) : null))
  handle(BrowserInvoke.log, (_e, id: unknown) => control.log(requireId(id, 'id')))
  handle(BrowserInvoke.clearLog, (_e, id: unknown) => control.clearLog(requireId(id, 'id')))
  handle(BrowserInvoke.takeOver, (_e, id: unknown, takenOver: unknown) => control.takeOver(requireId(id, 'id'), takenOver === true))
  handle(BrowserInvoke.controls, () => control.controls())
  handle(BrowserInvoke.clearData, () => clearBrowserData())
  handle(BrowserInvoke.resetViewport, (_e, id: unknown) => control.resetViewport(requireId(id, 'id')))
  handle(BrowserInvoke.resetEmulation, (_e, id: unknown) => control.resetEmulation(requireId(id, 'id')))
  handle(BrowserInvoke.resetRoutes, (_e, id: unknown) => control.resetRoutes(requireId(id, 'id')))
  handle(BrowserInvoke.downloads, () => browserDownloads.list())
  handle(BrowserInvoke.downloadAction, (_e, id: unknown, action: unknown) => {
    if (typeof action !== 'string' || !DOWNLOAD_ACTIONS.has(action)) throw new Error('Ungültiger Parameter: action')
    return browserDownloads.act(requireId(id, 'id'), action as BrowserDownloadAction)
  })
  handle(BrowserInvoke.clearDownloads, () => browserDownloads.clear())
  handle(BrowserInvoke.loginAnswer, (_e, id: unknown, credentials: unknown) => browserLogins.answer(requireId(id, 'id'), credentialsOf(credentials)))

  tabs.on('changed', (state) => broadcast(BrowserEvent.tabs, state))
  browserDownloads.on('changed', (downloads) => broadcast(BrowserEvent.downloads, downloads))
  browserLogins.on('request', (request) => broadcast(BrowserEvent.login, request))
  browserLogins.on('done', (id) => broadcast(BrowserEvent.loginDone, id))
  control.on('activity', (id, activity) => broadcast(BrowserEvent.activity, id, activity))
  control.on('control', (id, state) => broadcast(BrowserEvent.control, id, state))
  control.on('highlight', (id, highlight) => broadcast(BrowserEvent.highlight, id, highlight))
  control.on('focus', (id) => broadcast(BrowserEvent.focus, id))
  control.on('userClick', (id) => broadcast(BrowserEvent.userClick, id))
}
