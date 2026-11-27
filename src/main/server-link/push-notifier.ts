import { PUSH_TTL_DEFAULT, PUSH_TTL_MAX, type PushUrgency } from '@shared/nexa-server/protocol'
import { PUSH_KIND, pushNotice, pushResolved } from '@shared/push'
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

/** Questions remembered at most; beyond, the oldest go (a chat deleted while it asked never answers). */
const MAX_ASKED = 200

export interface PushNotifierDeps {
  sessions: Pick<SessionService, 'on' | 'list'>
  providers: Pick<ProviderService, 'usage'>
  settings: Pick<SettingsService, 'get'>
  link: Pick<ServerLinkService, 'push' | 'pushTargets' | 'device' | 'silentPush'>
  /** Whether the user is away from this computer: screen locked, or no input for a while. */
  away: () => boolean
  log?: (message: string) => void
}

/** A question pushed to phones, until it is answered or void. */
interface Asked {
  sessionId: string
  /** The phones whose push service took it. */
  phones: string[]
}

/**
 * Sends the notifications of chats (settings `notifications`) also to the phones paired with the web app
 * of the nexa-server, by Web Push and sealed for each (docs/NEXA-SERVER.md, „Push“). The same events and
 * text as on this computer (`chatAlert`); setting `push` says when. Once a question it pushed is answered,
 * here or anywhere, or void, it takes the phones' notification of it away again.
 */
export class PushNotifier {
  private off: (() => void) | null = null
  /** By the question's item id. */
  private readonly asked = new Map<string, Asked>()

  constructor(private readonly deps: PushNotifierDeps) {}

  init(): void {
    const offs = [
      this.deps.sessions.on('attention', (id, attention) => void this.attention(id, attention)),
      this.deps.sessions.on('event', (event) => {
        if (event.type === 'item' && event.item.kind === 'interaction' && event.item.state !== 'pending') void this.resolved(event.sessionId, event.item.id)
      }),
    ]
    this.off = () => {
      for (const off of offs) off()
    }
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
    const took: string[] = []
    await Promise.all(
      targets.map((to) =>
        this.deps.link.push(to, PUSH_KIND, notice, { urgency, ttl: TTL_SECONDS[attention.kind] }).then(
          (pushed) => {
            if (pushed) took.push(to)
          },
          (error: unknown) => this.failed(to, error),
        ),
      ),
    )
    if (attention.kind === 'input' && took.length) this.remember(attention.itemId, { sessionId, phones: took })
  }

  /**
   * Question `itemId` of chat `sessionId` is answered or void: its notification goes from the phones it
   * was pushed to. Not from one with the web app open: that one sees the question go and takes the
   * notification away itself, without a push it would show nothing for.
   */
  async resolved(sessionId: string, itemId: string): Promise<void> {
    const asked = this.asked.get(itemId)
    if (asked?.sessionId !== sessionId) return
    this.asked.delete(itemId)
    const members = new Set(this.deps.link.pushTargets())
    const phones = asked.phones.filter((id) => members.has(id) && !this.deps.link.device(id)?.online)
    // A silent push, which the server keeps from Safari: an older server wouldn't.
    if (!phones.length || !(await this.deps.link.silentPush())) return
    const message = pushResolved(sessionId)
    await Promise.all(
      phones.map((to) =>
        // As long as the question's push: one that waited at the push service may come after this.
        this.deps.link.push(to, PUSH_KIND, message, { urgency: 'normal', ttl: TTL_SECONDS.input, silent: true }).catch((error: unknown) => this.failed(to, error)),
      ),
    )
  }

  private remember(itemId: string, asked: Asked): void {
    this.asked.delete(itemId)
    this.asked.set(itemId, asked)
    for (const oldest of this.asked.keys()) {
      if (this.asked.size <= MAX_ASKED) break
      this.asked.delete(oldest)
    }
  }

  private failed(to: string, error: unknown): void {
    this.deps.log?.(`push to ${to} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
