import { ArtifactsInvoke } from '@shared/artifacts'
import { handle } from '../ipc'
import type { SessionService } from '../services/session-service'
import type { ArtifactService } from './artifact-service'

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${what} fehlt.`)
  return value
}

/** The window's side of the page „Artefakte“. */
export function registerArtifactsIpc(artifacts: ArtifactService, sessions: SessionService): void {
  handle(ArtifactsInvoke.list, (_e, accountId: unknown) => artifacts.list(str(accountId, 'Account')))
  handle(ArtifactsInvoke.thumbnail, (_e, accountId: unknown, id: unknown, dark: unknown) =>
    artifacts.thumbnail(str(accountId, 'Account'), str(id, 'Artefakt'), dark === true),
  )
  handle(ArtifactsInvoke.chats, () => sessions.artifactChats())
}
