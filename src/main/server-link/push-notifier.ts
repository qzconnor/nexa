import { PUSH_TTL_DEFAULT, PUSH_TTL_MAX, type PushUrgency } from '@shared/nexa-server/protocol'
import { PUSH_KIND, pushNotice } from '@shared/push'
import { chatAlert } from '../lib/notification-text'
import type { ProviderService } from '../services/provider-service'
import type { Attention, SessionService } from '../services/session-service'
import type { SettingsService } from '../services/settings-service'
import type { ServerLinkService } from './server-link-service'

/** How long the push service keeps a push for a phone that is offline (s). */
const TTL_SECONDS: Record<Attention['kind'], number> = {
  // A question or a permission still waits tomorrow morning.
  input: PUSH_TTL_MAX,
  // That an answer is done or a limit stopped a chat is old news after an hour.
  done: PUSH_TTL_DEFAULT,
  limit: PUSH_TTL_DEFAULT,
}

export interface PushNotifierDeps {
  sessions: Pick<SessionService, 'on' | 'list'>
  providers: Pick<ProviderService, 'usage'>
  settings: Pick<SettingsService, 'get'>
  link: Pick<ServerLinkService, 'push' | 'pushTargets'>
  /** Whether the user is away from this computer: screen locked, or no input for a while. */
  away: () => boolean
  log?: (message: string) => void
}

/**
 * Sends the notifications of chats (settings `notifications`) also to the phones paired with the web app
 * of the nexa-server, by Web Push and sealed for each (docs/NEXA-SERVER.md, „Push“). The same events and
 * text as on this computer (`chatAlert`); setting `push` says when.
 */
export class PushNotifier {
  private off: (() => void) | null = null

  constructor(private readonly deps: PushNotifierDeps) {}

  init(): void {
    this.off = this.deps.sessions.on('attention', (id, attention) => void this.attention(id, attention))
  }

  dispose(): void {
    this.off?.()
    this.off = null
  }

  /** The pushes of one event, settled once each went or failed (for the tests). */
  async attention(sessionId: string, attention: Attention): Promise<void> {
    const settings = this.deps.settings.get().notifications
    if (settings.push === 'off' || (settings.push === 'away' && !this.deps.away())) return
    const targets = this.deps.link.pushTargets()
    if (!targets.length) return
    const meta = this.deps.sessions.list().find((s) => s.id === sessionId)
    const windows = attention.kind === 'limit' ? (this.deps.providers.usage().find((u) => u.accountId === attention.accountId)?.windows ?? []) : []
    const alert = meta && chatAlert(attention, meta, settings, windows)
    if (!alert) return
    const notice = pushNotice(attention.kind, sessionId, alert.title, alert.body)
    const urgency: PushUrgency = attention.kind === 'input' ? 'high' : 'normal'
    await Promise.all(
      targets.map((to) =>
        this.deps.link.push(to, PUSH_KIND, notice, { urgency, ttl: TTL_SECONDS[attention.kind] }).catch((error: unknown) => {
          this.deps.log?.(`push to ${to} failed: ${error instanceof Error ? error.message : String(error)}`)
        }),
      ),
    )
  }
}
