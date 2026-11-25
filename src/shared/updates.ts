/** Updates of the installed app from the GitHub releases (see main/services/update-service.ts). */

type Unsubscribe = () => void

/** `unsupported`: a development build, or a Linux build that wasn't installed as AppImage, deb or rpm. */
export type UpdateStatus = 'unsupported' | 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'downloaded' | 'error'

export interface UpdateState {
  status: UpdateStatus
  /** Installed version. */
  current: string
  /** Version offered by the last check. */
  next: string | null
  /** Download progress in percent. */
  progress: number
  /** End of the last check (epoch ms). */
  checkedAt: number | null
  error: string | null
  /**
   * `next` came from a check the user started (Settings › Updates), not from the automatic one: they
   * know of it, so the settings button gets no dot for it, neither now nor once it is installed.
   */
  foundByUser: boolean
}

/** A published version with its release notes. */
export interface ReleaseNote {
  version: string
  /** Publication date (ISO). */
  date: string
  /** Notes rendered and sanitized by GitHub. */
  html: string
  url: string
  /** Pull requests (or issues) the notes link to, in order – their descriptions are the details. */
  references: number[]
}

/** A pull request (or issue) from the release notes with its description. */
export interface ReleaseReference {
  number: number
  title: string
  /** Description as written on GitHub (markdown), empty without one. */
  body: string
  url: string
}

export const UpdatesInvoke = {
  state: 'updates:state',
  check: 'updates:check',
  download: 'updates:download',
  install: 'updates:install',
  releases: 'updates:releases',
  reference: 'updates:reference',
} as const

export const UpdatesEvent = {
  changed: 'event:updates-changed',
  /** The update notification was clicked. */
  show: 'event:updates-show',
} as const

export interface UpdatesApi {
  state(): Promise<UpdateState>
  check(): Promise<void>
  download(): Promise<void>
  /** Quits and installs a downloaded update; the new version starts by itself. */
  install(): Promise<void>
  /** Published versions with their notes, newest first. */
  releases(): Promise<ReleaseNote[]>
  /** Title and description of a pull request (or issue) the notes link to. */
  reference(number: number): Promise<ReleaseReference>
  onChanged(cb: (state: UpdateState) => void): Unsubscribe
  onShow(cb: () => void): Unsubscribe
}
