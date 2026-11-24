import { net } from 'electron'
import type { Account, AccountKind, AuthState } from '@shared/accounts'
import { ARTIFACT_URL, type Artifact, type ArtifactAudience, type ArtifactList, type ArtifactListStatus } from '@shared/artifacts'
import type { AccountService } from '../accounts/account-service'

/**
 * The artifacts of an account's login: the pages and documents Claude Code published on claude.ai
 * with its Artifact tool. Claude Code lists them with the login's OAuth token at this address and
 * with these headers; Nexa does the same (as the Claude Manager's page „Artefakte“ does).
 *
 * The newer list (`/artifacts`) serves only some logins; like Claude Code, Nexa then falls back to
 * the older one (`/frames`), which every login gets.
 */
const API = 'https://api.anthropic.com/api/frame'
const OAUTH_BETA = 'oauth-2025-04-20'
/** Rows per page; the API takes at most 200. */
const PAGE_SIZE = 200
/** Pages per list at most: more than anyone keeps. */
const MAX_PAGES = 10
const TIMEOUT_MS = 15_000
/** An artifact's id as in its link; nothing else goes into a path. */
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/
const AUDIENCES: readonly ArtifactAudience[] = ['owner', 'users', 'org', 'public']
const MAX_TITLE = 300
const MAX_DESCRIPTION = 1000
/** Thumbnails come from the artifacts' own host, with a short-lived token in the link, never with the login's. */
const THUMB_HOST = '.frame.claudeusercontent.com'
const MAX_THUMB_BYTES = 2 * 1024 * 1024

/** What the service needs of the accounts: who they are and the token of their login. */
export interface ArtifactAccounts {
  get(id: string): Account
  /** The OAuth token to list with, or why there is none. */
  token(id: string): { token: string } | { status: ArtifactListStatus; message: string }
}

interface Thumbs {
  light: string | null
  dark: string | null
}

interface Row {
  artifact: Artifact
  thumbs: Thumbs
}

interface Lane {
  rows: Row[]
  truncated: boolean
}

export class ArtifactService {
  /** The thumbnails' links of the last list, per account and artifact: only these are fetched. */
  private readonly thumbs = new Map<string, Thumbs>()

  constructor(
    private readonly accounts: ArtifactAccounts,
    private readonly userAgent: string,
    /** The installed Claude Code's version, which it sends along as its own. */
    private readonly clientVersion: () => string | null,
  ) {}

  /** Own and shared artifacts of the account's login, most recently viewed first. */
  async list(accountId: string): Promise<ArtifactList> {
    const base: ArtifactList = { accountId, status: 'ok', message: null, artifacts: [], truncated: false, fetchedAt: Date.now() }
    if (this.accounts.get(accountId).provider !== 'claude') {
      return { ...base, status: 'unavailable', message: 'Artefakte gibt es nur für Claude-Accounts.' }
    }
    const auth = this.accounts.token(accountId)
    if (!('token' in auth)) return { ...base, ...auth }
    try {
      let lanes: Lane[]
      const own = await this.lane(auth.token, 'all')
      if (typeof own === 'number') {
        const frames = await this.frames(auth.token)
        if (typeof frames === 'number') return { ...base, ...listFailure(frames, this.accounts.get(accountId).kind) }
        lanes = [frames]
      } else {
        // The shared ones are a list of their own; without it the own ones are still worth showing.
        const shared = await this.lane(auth.token, 'shared')
        lanes = typeof shared === 'number' ? [own] : [own, shared]
      }
      const rows = uniqueRows(lanes.flatMap((lane) => lane.rows))
      for (const key of [...this.thumbs.keys()]) if (key.startsWith(`${accountId}\n`)) this.thumbs.delete(key)
      for (const row of rows) this.thumbs.set(`${accountId}\n${row.artifact.id}`, row.thumbs)
      return { ...base, artifacts: rows.map((row) => row.artifact), truncated: lanes.some((lane) => lane.truncated) }
    } catch (error) {
      return { ...base, status: 'error', message: `Die Artefakte ließen sich nicht laden: ${errorText(error)}` }
    }
  }

  /** The thumbnail of the last list as a `data:` URL (the window loads no pictures from elsewhere); null without one. */
  async thumbnail(accountId: string, id: string, dark: boolean): Promise<string | null> {
    const thumbs = this.thumbs.get(`${accountId}\n${id}`)
    const url = (dark ? thumbs?.dark : null) ?? thumbs?.light ?? null
    if (!url) return null
    try {
      const response = await net.fetch(url, {
        headers: { 'User-Agent': this.userAgent },
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (!response.ok || !/^image\/(png|jpeg|webp|gif|avif)$/.test(type)) return null
      if (Number(response.headers.get('content-length')) > MAX_THUMB_BYTES) return null
      const bytes = Buffer.from(await response.arrayBuffer())
      return bytes.length > MAX_THUMB_BYTES ? null : `data:${type};base64,${bytes.toString('base64')}`
    } catch {
      return null
    }
  }

  /** One list page by page (`all`: the own ones and those opened, `shared`: shared with the login). */
  private async lane(token: string, rel: 'all' | 'shared'): Promise<Lane | number> {
    const rows: Row[] = []
    let pageToken: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ rel, kind: 'page,document', sort: 'last_viewed', limit: String(PAGE_SIZE) })
      if (pageToken) query.set('page_token', pageToken)
      const response = await this.request(token, `/artifacts?${query.toString()}`)
      // A later page that fails leaves what was listed so far.
      if (!response.ok) return page === 0 ? response.status : { rows, truncated: true }
      const data = (await response.json().catch(() => null)) as { artifacts?: unknown; next_page_token?: unknown } | null
      if (!data || !Array.isArray(data.artifacts)) return page === 0 ? 502 : { rows, truncated: true }
      for (const raw of data.artifacts) {
        const row = parseRow(raw)
        if (row) rows.push(row)
      }
      pageToken = typeof data.next_page_token === 'string' && data.next_page_token ? data.next_page_token : undefined
      if (!pageToken) return { rows, truncated: false }
    }
    return { rows, truncated: true }
  }

  /** The older list: own artifacts and those shared with the login, at most 200. */
  private async frames(token: string): Promise<Lane | number> {
    const response = await this.request(token, `/frames?limit=${PAGE_SIZE}`)
    if (!response.ok) return response.status
    const data = (await response.json().catch(() => null)) as { frames?: unknown } | null
    if (!data || !Array.isArray(data.frames)) return 502
    const rows = data.frames.map((raw) => parseRow(raw)).filter((row) => row !== null)
    return { rows, truncated: data.frames.length >= PAGE_SIZE }
  }

  private request(token: string, path: string): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': OAUTH_BETA,
      Accept: 'application/json, application/vnd.ant.frame-refusal+json',
      'User-Agent': this.userAgent,
      'X-Frame-CP': 'go',
      'X-Frame-Surface': 'code',
      'X-Frame-Platform': 'cli',
    }
    const version = this.clientVersion()
    if (version) headers['X-Frame-Client-Version'] = version
    return net.fetch(`${API}${path}`, {
      headers,
      // The token goes to this address only, never on to another one.
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  }
}

/** Each artifact once (an own one opened again may be in both lists), most recently seen first. */
function uniqueRows(rows: Row[]): Row[] {
  const byId = new Map<string, Row>()
  for (const row of rows) if (!byId.has(row.artifact.id)) byId.set(row.artifact.id, row)
  return [...byId.values()].sort((a, b) => lastSeen(b.artifact) - lastSeen(a.artifact))
}

/**
 * The token Claude Code would list with: a token account's own, else the browser login's access
 * token. An expired one Nexa leaves to Claude Code, which renews it when it next starts.
 */
export function artifactToken(
  kind: AccountKind,
  login: { authState: AuthState; accessToken: string | null },
  setupToken: string | null,
): { token: string } | { status: ArtifactListStatus; message: string } {
  if (kind === 'apiKey') return { status: 'unavailable', message: 'Artefakte gehören zu einem Login bei claude.ai, nicht zu einem API-Key.' }
  if (kind === 'token') return setupToken ? { token: setupToken } : { status: 'signed-out', message: 'Für diesen Account ist kein Token gespeichert.' }
  if (login.accessToken) return { token: login.accessToken }
  if (login.authState === 'expired') {
    return { status: 'signed-out', message: 'Die Anmeldung ist abgelaufen. Claude Code erneuert sie mit dem nächsten Chat dieses Accounts.' }
  }
  return { status: 'signed-out', message: 'Der Account ist nicht angemeldet.' }
}

/** A row of either list as Nexa shows it; null for anything that isn't a page or document. */
export function parseArtifact(raw: unknown): Artifact | null {
  return parseRow(raw)?.artifact ?? null
}

function parseRow(raw: unknown): Row | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = text(r.id) ?? text(r.slug)
  if (!id || !ID_RE.test(id) || r.soft_deleted === true) return null
  // The older list has no kinds: its rows are pages.
  const kind = r.kind ?? 'page'
  if (kind !== 'page' && kind !== 'document') return null
  const link = openUrl(r.open_url)
  return {
    artifact: {
      id,
      url: link?.url ?? `${ARTIFACT_URL}${id}`,
      shortId: link?.shortId ?? null,
      title: cut(text(r.title)?.trim() || 'Ohne Titel', MAX_TITLE),
      description: nullable(text(r.description)?.trim(), MAX_DESCRIPTION),
      kind,
      mine: r.rel === 'mine',
      external: r.outside_organization === true,
      audience: AUDIENCES.find((audience) => audience === r.audience) ?? null,
      createdAt: isoDate(r.created_at),
      updatedAt: isoDate(r.updated_at) ?? publishedAt(r.live),
      lastViewedAt: isoDate(r.last_viewed_at),
      // Public ones count the views of everyone with the link.
      views: count(r.view_count) ?? count(r.public_view_count),
    },
    // The newer list names them in snake case, the older one in camel case.
    thumbs: { light: thumbUrl(r.thumbnail_url ?? r.thumbImgURL), dark: thumbUrl(r.thumbnail_dark_url ?? r.thumbDarkImgURL) },
  }
}

/** Where claude.ai shows an artifact (`https://claude.ai/artifact/<shortId>`), only on claude.ai itself. */
function openUrl(value: unknown): { url: string; shortId: string } | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    const shortId = /^\/artifact\/([A-Za-z0-9_-]{1,128})$/.exec(url.pathname)?.[1]
    return url.protocol === 'https:' && url.hostname === 'claude.ai' && shortId ? { url: url.href, shortId } : null
  } catch {
    return null
  }
}

/** A thumbnail's link, only from the artifacts' own host. */
export function thumbUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith(THUMB_HOST) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

/** The older list names the version on show as `<seconds>-<hash>`: when it was published. */
function publishedAt(live: unknown): string | null {
  const seconds = typeof live === 'string' ? /^(\d{9,11})-/.exec(live)?.[1] : undefined
  return seconds ? new Date(Number(seconds) * 1000).toISOString() : null
}

export function listFailure(status: number, kind: Account['kind']): { status: ArtifactListStatus; message: string } {
  if (status === 401) {
    return kind === 'token'
      ? { status: 'unavailable', message: 'Der Token ist ungültig oder wurde widerrufen.' }
      : { status: 'signed-out', message: 'Die Anmeldung ist abgelaufen. Ein Chat mit diesem Account erneuert sie, sonst hilft neu anmelden.' }
  }
  if (status === 403 || status === 404) {
    return { status: 'unavailable', message: `Für diesen Login gibt claude.ai keine Artefakte heraus (HTTP ${status}).` }
  }
  if (status === 429) return { status: 'error', message: 'Zu viele Anfragen an claude.ai. Versuche es gleich noch einmal.' }
  return { status: 'error', message: `claude.ai antwortete mit HTTP ${status}.` }
}

/** When it was last looked at or changed, for the order of the list. */
function lastSeen(artifact: Artifact): number {
  return Date.parse(artifact.lastViewedAt ?? artifact.updatedAt ?? artifact.createdAt ?? '') || 0
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function cut(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function nullable(value: string | undefined, max: number): string | null {
  return value ? cut(value, max) : null
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

/** An ISO string or a time in seconds or milliseconds, as ISO string. */
function isoDate(value: unknown): string | null {
  let ms = NaN
  if (typeof value === 'string') ms = Date.parse(value)
  else if (typeof value === 'number' && Number.isFinite(value)) ms = value < 1e12 ? value * 1000 : value
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The accounts as the service needs them: the token of a token account comes from its encrypted store. */
export function artifactAccounts(accounts: AccountService): ArtifactAccounts {
  return {
    get: (id) => accounts.get(id),
    token: (id) => {
      const account = accounts.get(id)
      let setupToken: string | null = null
      if (account.kind === 'token') {
        try {
          setupToken = accounts.env(id).set.CLAUDE_CODE_OAUTH_TOKEN ?? null
        } catch {
          // No token stored: said as such below.
        }
      }
      return artifactToken(account.kind, accounts.login(id), setupToken)
    },
  }
}
