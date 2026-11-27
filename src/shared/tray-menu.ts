import { availability, type ChoiceContext } from './account-choice'
import { visibleAccounts } from './accounts'
import type { ProviderId, SessionStatus } from './chat'
import { PROVIDERS } from './providers'
import type { AppTheme } from './themes/types'
import type { AppearanceSettings, SessionMeta, UsageWindow } from './types'

/*
 * The menu of the icon in the notification area: on Windows a small window of Nexa's own in the
 * theme's colours instead of the system's menu, which only knows light and dark. Main says what it
 * shows; the page only draws it and reports what the user picks.
 */

/** A chat the menu lists. */
export interface TrayChat {
  id: string
  title: string
  /** The project's name. */
  project: string
  provider: ProviderId
  /** `waiting`: a permission, a question or a plan waits for the user; `working`: a turn runs. */
  status: 'waiting' | 'working'
}

/** An account's plan limits in the menu. */
export interface TrayLimit {
  accountId: string
  provider: ProviderId
  /** The account's name; the CLI's when it is the only account of it the user sees. */
  name: string
  /** The account's dot, when the CLI has several. */
  color?: string
  /** The model new chats of the CLI start with (empty: the CLI's default): the page shows the windows that limit it, as the title bar does. */
  model: string
  windows: UsageWindow[]
  /** At its limit: when it is free again; `estimated` when no CLI said when. */
  freeAt?: number
  estimated?: boolean
}

export interface TrayMenuState {
  /** Counts the states; the page answers `ready` with it once it drew this one. */
  seq: number
  theme: AppTheme
  appearance: AppearanceSettings
  /** The window material shows through the menu (acrylic). */
  translucent: boolean
  /** The first of the chats that wait or work (`TRAY_MENU_CHATS`). */
  chats: TrayChat[]
  /** How many chats wait for the user, also beyond `chats`. */
  waiting: number
  /** How many chats work, also beyond `chats`. */
  working: number
  /** The limits of the accounts of the CLIs that are on, as far as they are known. */
  limits: TrayLimit[]
  /** The main switch of the notifications (the bell in the title bar). */
  notifications: boolean
}

export type TrayMenuAction =
  | { kind: 'open' }
  | { kind: 'chat'; sessionId: string }
  | { kind: 'new' }
  | { kind: 'notifications'; enabled: boolean }
  | { kind: 'quit' }

export const TrayMenuInvoke = {
  /** The state to draw, for the page that just loaded. */
  state: 'tray-menu:state',
  /** The page drew a state and is this tall; main places and shows the menu with it. */
  ready: 'tray-menu:ready',
  /** The user picked an entry; the menu closes first. */
  act: 'tray-menu:act',
  /** Esc: the menu closes without doing anything. */
  close: 'tray-menu:close',
} as const

export const TrayMenuEvent = {
  /** A new state, when the menu opens and while it shows. */
  state: 'event:tray-menu-state',
} as const

/** `window.trayMenu`, the only thing the menu's page gets (src/preload/tray.ts). */
export interface TrayMenuApi {
  state(): Promise<TrayMenuState>
  onState(cb: (state: TrayMenuState) => void): () => void
  /** The page drew state `seq` and its content is `height` CSS pixels tall. */
  ready(seq: number, height: number): Promise<void>
  act(action: TrayMenuAction): Promise<void>
  close(): Promise<void>
}

/** Width of the menu in CSS pixels (at 100 %). */
export const TRAY_MENU_WIDTH = 296
/** Chats the menu lists at most; it names how many more there are. */
export const TRAY_MENU_CHATS = 6

/**
 * The chats the menu lists: those that wait for the user first, then those that work, each the most
 * recently active first. Archived chats too: one that waits needs the user wherever it is.
 */
export function trayChats(
  sessions: readonly Pick<SessionMeta, 'id' | 'title' | 'projectId' | 'provider' | 'updatedAt'>[],
  statusOf: (id: string) => SessionStatus | null,
  projectName: (projectId: string) => string,
  limit = TRAY_MENU_CHATS,
): Pick<TrayMenuState, 'chats' | 'waiting' | 'working'> {
  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const pick = (want: TrayChat['status']): TrayChat[] =>
    recent.flatMap((meta) => {
      const status = statusOf(meta.id)
      const is = status === 'waiting' ? 'waiting' : status === 'starting' || status === 'running' ? 'working' : null
      return is === want ? [{ id: meta.id, title: meta.title, project: projectName(meta.projectId), provider: meta.provider, status: is }] : []
    })
  const waiting = pick('waiting')
  const working = pick('working')
  return { chats: [...waiting, ...working].slice(0, limit), waiting: waiting.length, working: working.length }
}

/**
 * The limits the menu shows: every account the user sees of the CLIs that are on (`providers`), in
 * their order, as far as its windows are known. API keys have no plan limits, signed-out accounts no
 * readings that still count. `models`: the model new chats of each CLI start with.
 */
export function trayLimits(
  ctx: ChoiceContext,
  providers: readonly ProviderId[],
  models: Partial<Record<ProviderId, string>>,
): TrayLimit[] {
  return providers.flatMap((provider) => {
    const shown = visibleAccounts(ctx.accounts, provider)
    return shown.flatMap((account) => {
      const windows = ctx.usage.find((u) => u.accountId === account.id)?.windows ?? []
      const free = availability(account, ctx)
      if (!free || !windows.length) return []
      const limit: TrayLimit = {
        accountId: account.id,
        provider,
        name: shown.length > 1 ? account.name : PROVIDERS[provider].short,
        model: models[provider] ?? '',
        windows,
      }
      if (shown.length > 1) limit.color = account.color
      if (free.at > ctx.now) {
        limit.freeAt = free.at
        if (free.estimated) limit.estimated = true
      }
      return [limit]
    })
  })
}

/** What the page asks for, checked: an unknown kind or a missing chat throws. */
export function parseTrayMenuAction(value: unknown): TrayMenuAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Die Aktion fehlt.')
  const action = value as Record<string, unknown>
  switch (action.kind) {
    case 'open':
    case 'new':
    case 'quit':
      return { kind: action.kind }
    case 'chat':
      if (typeof action.sessionId !== 'string' || !action.sessionId || action.sessionId.length > 200) throw new Error('Der Chat fehlt.')
      return { kind: 'chat', sessionId: action.sessionId }
    case 'notifications':
      if (typeof action.enabled !== 'boolean') throw new Error('An oder aus fehlt.')
      return { kind: 'notifications', enabled: action.enabled }
    default:
      throw new Error('Unbekannte Aktion.')
  }
}
