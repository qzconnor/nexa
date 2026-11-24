import type { WebContents } from 'electron'
import { VoiceEvent, VoiceInvoke, type VoiceStartInput } from '@shared/voice'
import type { AccountService } from '../accounts/account-service'
import { handle } from '../ipc'
import type { VoiceAccounts, VoiceOwner, VoiceService } from './voice-service'

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${what} fehlt.`)
  return value
}

function startInput(value: unknown): VoiceStartInput {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    account: typeof input.account === 'string' && input.account ? input.account : undefined,
    keyterms: Array.isArray(input.keyterms) ? input.keyterms.filter((t): t is string => typeof t === 'string').slice(0, 50) : undefined,
  }
}

function ownerOf(contents: WebContents): VoiceOwner {
  return {
    send: (id, update) => {
      if (!contents.isDestroyed()) contents.send(VoiceEvent.event, id, update)
    },
    onGone: (cb) => {
      contents.once('destroyed', cb)
      return () => contents.removeListener('destroyed', cb)
    },
  }
}

/** The OAuth token of a Claude account's login: a token account's own, else the browser login's (while it holds). */
export function voiceAccounts(accounts: AccountService): VoiceAccounts {
  return {
    list: () => accounts.list(),
    token: (id) => {
      const account = accounts.get(id)
      if (account.provider !== 'claude' || account.kind === 'apiKey') return null
      if (account.kind === 'token') {
        try {
          return accounts.env(id).set.CLAUDE_CODE_OAUTH_TOKEN ?? null
        } catch {
          return null
        }
      }
      return accounts.login(id).accessToken
    },
  }
}

/** The window's side of the voice input in the composer. */
export function registerVoiceIpc(voice: VoiceService): void {
  handle(VoiceInvoke.start, (event, input: unknown) => voice.start(ownerOf(event.sender), startInput(input)))
  handle(VoiceInvoke.audio, (_e, id: unknown, chunk: unknown) => {
    if (chunk instanceof Uint8Array) voice.audio(str(id, 'Die Aufnahme'), chunk)
  })
  handle(VoiceInvoke.stop, (_e, id: unknown) => voice.stop(str(id, 'Die Aufnahme')))
  handle(VoiceInvoke.cancel, (_e, id: unknown) => voice.cancel(str(id, 'Die Aufnahme')))
}
