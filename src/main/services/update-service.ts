import { app, BrowserWindow, Notification, net } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { splitNoteItems } from '@shared/release-notes'
import type { ReleaseNote, ReleaseNotes, ReleaseReference, UpdateState } from '@shared/updates'
import { compareVersions } from '@shared/version'
import { readJsonSync, writeJsonAtomic } from '../lib/json-file'
import { linuxPackage } from '../lib/linux'
import { TypedEmitter } from '../lib/typed-emitter'
import { openAppWindows, revealWindow } from '../window/main-window'

/**
 * Updates come from the GitHub releases of the repository (published by semantic-release, see
 * `release.config.mjs`). The publish settings in `electron-builder.yml` tell electron-updater where.
 */
const REPO = 'qzconnor/nexa'
const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60_000
/** Releases per page of the notes: the newest page comes with each check, older ones when scrolled to. */
export const NOTES_PAGE = 10

type Events = {
  changed: [state: UpdateState]
  /** The system notification was clicked: the window should show the updates. */
  show: []
  releases: [notes: ReleaseNotes]
}

/** The newest page of the notes as kept on disk, so that the page has them right after the start. */
interface StoredNotes {
  notes: ReleaseNote[]
  complete: boolean
  loadedAt: number
}

/** A page of releases: `full` when GitHub may have older ones. */
interface ReleasePage {
  notes: ReleaseNote[]
  full: boolean
}

interface GitHubRelease {
  tag_name: string
  published_at: string | null
  body_html?: string
  html_url: string
  draft: boolean
  prerelease: boolean
}

/** A pull request through the issues endpoint, which answers for issues as well. */
interface GitHubIssue {
  number: number
  title: string
  body: string | null
  html_url: string
}

/** Links of the notes to a pull request or issue, e.g. `…/qzconnor/nexa/issues/17`. */
const REFERENCE_LINK = new RegExp(`https://github\\.com/${REPO}/(?:issues|pull)/(\\d+)`, 'g')

/**
 * Only an installed app can update itself. On Linux that is the AppImage (it replaces its own file)
 * and the deb and rpm packages (installed by the package manager, which asks for the password).
 */
function canUpdate(): boolean {
  return app.isPackaged && (process.platform !== 'linux' || linuxPackage() !== null)
}

export class UpdateService extends TypedEmitter<Events> {
  private state: UpdateState = {
    status: canUpdate() ? 'idle' : 'unsupported',
    current: app.getVersion(),
    next: null,
    progress: 0,
    checkedAt: null,
    error: null,
    foundByUser: false,
  }
  /** The check running now was started by the user (`check(true)`). */
  private userCheck = false
  private notifiedVersion: string | null = null
  private notes: ReleaseNotes = { notes: [], complete: false, loadedAt: null, loading: false, error: null, loadingMore: false, moreError: null }
  /** Page of the REST API that holds the next older releases. */
  private nextPage = 1
  private refreshing: Promise<void> | null = null
  private fetchingMore: Promise<void> | null = null
  private timers: NodeJS.Timeout[] = []
  private installingUpdate = false

  /** `notesFile`: where the newest page of the release notes is kept across starts (none in tests). */
  constructor(
    private readonly userAgent: string,
    private readonly notesFile: string | null = null,
  ) {
    super()
    const stored = notesFile ? readJsonSync<unknown>(notesFile) : null
    if (isStoredNotes(stored)) {
      this.notes = { ...this.notes, notes: stored.notes, complete: stored.complete, loadedAt: stored.loadedAt }
      if (stored.notes.length) this.nextPage = 2
    }
  }

  /** The app quits for the installer: whatever asks before quitting must let it go. */
  get installing(): boolean {
    return this.installingUpdate
  }

  getState(): UpdateState {
    return this.state
  }

  init(): void {
    // Also where the app can't update itself: the checks bring the release notes along.
    this.timers.push(
      setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS),
      setInterval(() => void this.check(), CHECK_INTERVAL_MS),
    )
    if (!canUpdate()) return
    // Downloading is the user's choice; a downloaded update is also installed when quitting, except
    // for deb and rpm: the package manager asks for the password, which shouldn't come up on quitting.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = linuxPackage() !== 'deb' && linuxPackage() !== 'rpm'
    autoUpdater.logger = null

    autoUpdater.on('checking-for-update', () => this.setState({ status: 'checking', error: null }))
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      // The automatic check that finds again what the user found stays theirs: known already.
      const foundByUser = this.userCheck || (this.state.foundByUser && this.state.next === info.version)
      this.setState({ status: 'available', next: info.version, checkedAt: Date.now(), foundByUser })
      if (!foundByUser) this.notify(info.version)
    })
    autoUpdater.on('update-not-available', () => this.setState({ status: 'up-to-date', next: null, checkedAt: Date.now(), foundByUser: false }))
    autoUpdater.on('download-progress', (progress: ProgressInfo) =>
      this.setState({ status: 'downloading', progress: progress.percent }),
    )
    autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
      this.setState({ status: 'downloaded', next: info.version, progress: 100 }),
    )
    autoUpdater.on('error', (error) => {
      // E.g. the password for the package manager was not given: the app keeps running.
      this.installingUpdate = false
      this.setState({ status: 'error', error: describeError(error) })
    })
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }

  /** `byUser`: asked for in Settings › Updates, not by the timer. The newest release notes come along. */
  async check(byUser = false): Promise<void> {
    const notes = this.refreshReleases()
    if (!['unsupported', 'checking', 'downloading', 'downloaded'].includes(this.state.status)) {
      this.userCheck = byUser
      try {
        await autoUpdater.checkForUpdates()
      } catch (error) {
        this.setState({ status: 'error', error: describeError(error), checkedAt: Date.now() })
      }
    }
    await notes
  }

  async download(): Promise<void> {
    if (!this.state.next || !['available', 'error'].includes(this.state.status)) return
    this.setState({ status: 'downloading', progress: 0, error: null })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.setState({ status: 'error', error: describeError(error) })
    }
  }

  /**
   * Quits, runs the installer and starts the new version afterwards. Silently: the installer has
   * pages, but an update keeps the folder and mode of the installation, and only a silent install
   * starts the app again by itself. The window asks about running chats before.
   */
  install(): void {
    if (this.state.status !== 'downloaded') return
    this.installingUpdate = true
    autoUpdater.quitAndInstall(true, true)
  }

  /** The release notes loaded so far, newest first; asks GitHub nothing. */
  releaseNotes(): ReleaseNotes {
    return this.notes
  }

  /** Asks GitHub for the newest page of the notes: with every check, or when the user asks again. */
  refreshReleases(): Promise<void> {
    this.refreshing ??= this.loadNewest().finally(() => (this.refreshing = null))
    return this.refreshing
  }

  /** Asks GitHub for the next older page of the notes, once the newest page is there. */
  moreReleases(): Promise<void> {
    if (this.notes.complete || !this.notes.notes.length) return Promise.resolve()
    this.fetchingMore ??= this.loadOlder().finally(() => (this.fetchingMore = null))
    return this.fetchingMore
  }

  /** Title and description of a pull request (or issue) the notes link to – the details of a change. */
  async reference(number: number): Promise<ReleaseReference> {
    const response = await net.fetch(`https://api.github.com/repos/${REPO}/issues/${number}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': this.userAgent },
      cache: 'no-cache',
    })
    if (!response.ok) throw new Error(describeStatus(response))
    const issue = (await response.json()) as GitHubIssue
    return { number: issue.number, title: issue.title, body: issue.body?.trim() ?? '', url: issue.html_url }
  }

  private setState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('changed', this.state)
  }

  private setNotes(patch: Partial<ReleaseNotes>): void {
    this.notes = { ...this.notes, ...patch }
    this.emit('releases', this.notes)
  }

  private async loadNewest(): Promise<void> {
    this.setNotes({ loading: true })
    let page: ReleasePage | null = null
    let error: string | null = null
    try {
      page = await this.releasePage(1)
    } catch (e) {
      // E.g. the API's hourly limit – the feed has none.
      error = describeError(e)
    }
    // The API sometimes lists no release for a while (an empty list); then the feed fills in.
    if (!page?.notes.length) {
      try {
        const notes = await this.releasesFromFeed()
        if (notes.length || !page) page = { notes, full: notes.length >= NOTES_PAGE }
        error = null
      } catch (e) {
        error ??= describeError(e)
      }
    }
    if (!page) {
      this.setNotes({ loading: false, error })
      return
    }
    // An empty answer next to notes from before is GitHub's hiccup, not the end of all releases.
    if (!page.notes.length && this.notes.notes.length) {
      this.setNotes({ loading: false, error: null })
      return
    }
    // Older pages loaded before stay: what the newest page doesn't list (any more) goes below it.
    const fresh = new Set(page.notes.map((note) => note.version))
    const notes = [...page.notes, ...this.notes.notes.filter((note) => !fresh.has(note.version))].sort((a, b) =>
      compareVersions(b.version, a.version),
    )
    const complete = this.notes.complete || !page.full
    const loadedAt = Date.now()
    this.nextPage = Math.max(this.nextPage, 2)
    this.setNotes({ notes, complete, loadedAt, loading: false, error: null })
    if (this.notesFile) {
      const stored: StoredNotes = { notes: notes.slice(0, NOTES_PAGE), complete: complete && notes.length <= NOTES_PAGE, loadedAt }
      // Not kept is no harm: the next start loads them again with its first check.
      await writeJsonAtomic(this.notesFile, stored).catch(() => undefined)
    }
  }

  private async loadOlder(): Promise<void> {
    this.setNotes({ loadingMore: true, moreError: null })
    try {
      const page = await this.releasePage(this.nextPage)
      this.nextPage++
      // Releases published since push the pages back: the next one may repeat a few already there.
      const known = new Set(this.notes.notes.map((note) => note.version))
      const older = page.notes.filter((note) => !known.has(note.version))
      this.setNotes({ notes: [...this.notes.notes, ...older], complete: !page.full, loadingMore: false })
    } catch (error) {
      this.setNotes({ loadingMore: false, moreError: describeError(error) })
    }
  }

  /** System notification while the window is in the background – otherwise the page shows a hint. */
  private notify(version: string): void {
    if (this.notifiedVersion === version) return
    this.notifiedVersion = version
    if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return
    const notification = new Notification({
      title: 'Update für Nexa',
      body: `Version ${version} ist verfügbar und lässt sich direkt in der App installieren.`,
    })
    notification.on('click', () => {
      const win = openAppWindows()[0]
      if (!win) return
      revealWindow(win)
      this.emit('show')
    })
    notification.show()
  }

  /** A page of releases from the REST API, with the date of publication. */
  private async releasePage(page: number): Promise<ReleasePage> {
    const response = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=${NOTES_PAGE}&page=${page}`, {
      headers: { Accept: 'application/vnd.github.html+json', 'User-Agent': this.userAgent },
      // Always ask GitHub (cheap with the ETag) instead of answering from the HTTP cache.
      cache: 'no-cache',
    })
    if (!response.ok) throw new Error(describeStatus(response))
    const releases = (await response.json()) as GitHubRelease[]
    const notes = releases
      .filter((release) => !release.draft && !release.prerelease)
      .map((release) => ({
        version: release.tag_name.replace(/^v/, ''),
        date: release.published_at ?? '',
        // One line per change, also in releases whose title named several.
        html: splitNoteItems(release.body_html ?? ''),
        url: release.html_url,
        references: references(release.body_html ?? ''),
      }))
    // Counted before the filter: a page of prereleases only is no end.
    return { notes, full: releases.length >= NOTES_PAGE }
  }

  /**
   * Releases from the Atom feed of the releases page (the one electron-updater reads too): the
   * latest 10, no rate limit. `updated` stands in for the date of publication.
   */
  private async releasesFromFeed(): Promise<ReleaseNote[]> {
    const response = await net.fetch(`https://github.com/${REPO}/releases.atom`, {
      headers: { 'User-Agent': this.userAgent },
      cache: 'no-cache',
    })
    if (!response.ok) throw new Error(`GitHub antwortet mit Status ${response.status}.`)
    const feed = await response.text()
    return [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
      const text = (tag: string) => unescapeXml(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry)?.[1] ?? '')
      const html = splitNoteItems(text('content'))
      return {
        // The id ends with the tag, e.g. `tag:github.com,2008:Repository/123456789/v1.2.3`.
        version: (text('id').split('/').pop() ?? '').replace(/^v/, ''),
        date: text('updated'),
        html,
        url: unescapeXml(/<link[^>]*href="([^"]*)"/.exec(entry)?.[1] ?? ''),
        references: references(html),
      }
    })
  }
}

/** The file of an older version, or a broken one, is no reason to show anything wrong: it's just loaded again. */
function isStoredNotes(value: unknown): value is StoredNotes {
  if (!value || typeof value !== 'object') return false
  const stored = value as Partial<StoredNotes>
  return (
    typeof stored.complete === 'boolean' &&
    typeof stored.loadedAt === 'number' &&
    Array.isArray(stored.notes) &&
    stored.notes.every(
      (note: Partial<ReleaseNote> | null) =>
        !!note &&
        typeof note.version === 'string' &&
        typeof note.date === 'string' &&
        typeof note.html === 'string' &&
        typeof note.url === 'string' &&
        Array.isArray(note.references) &&
        note.references.every((n) => typeof n === 'number'),
    )
  )
}

/** Numbers of the pull requests (or issues) the notes link to, each once. */
function references(html: string): number[] {
  return [...new Set([...html.matchAll(REFERENCE_LINK)].map(([, number]) => Number(number)))]
}

/** The hourly limit without sign-in is 60 requests – the most likely reason for a refusal. */
function describeStatus(response: Response): string {
  const limited =
    response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
  if (limited) return 'GitHub nimmt gerade keine weiteren Anfragen an (Limit pro Stunde). Bitte später noch einmal versuchen.'
  if (response.status === 404) return 'Auf GitHub nicht gefunden.'
  return `GitHub antwortet mit Status ${response.status}.`
}

/** electron-updater appends long HTTP dumps to its errors – the first line is enough. */
function describeError(error: unknown): string {
  const line = (error instanceof Error ? error.message : String(error)).split('\n')[0]
  // Until the first release the releases feed is empty.
  return line.startsWith('No published versions') ? 'Auf GitHub ist noch keine Version veröffentlicht.' : line
}

const XML_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** `&lt;p&gt;` → `<p>` – in a single pass, so `&amp;lt;` correctly becomes `&lt;`. */
function unescapeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== '#') return XML_ENTITIES[entity.toLowerCase()] ?? match
    const hex = entity[1].toLowerCase() === 'x'
    return String.fromCodePoint(parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10))
  })
}
