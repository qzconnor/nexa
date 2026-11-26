import { UpdatesEvent, UpdatesInvoke } from '@shared/updates'
import { broadcast, handle } from '../ipc'
import type { UpdateService } from './update-service'

/** The window's side of the updates: state, check, download, install and the release notes. */
export function registerUpdatesIpc(updates: UpdateService): void {
  handle(UpdatesInvoke.state, () => updates.getState())
  handle(UpdatesInvoke.check, () => updates.check(true))
  handle(UpdatesInvoke.download, () => updates.download())
  handle(UpdatesInvoke.install, () => updates.install())
  handle(UpdatesInvoke.releases, () => updates.releaseNotes())
  handle(UpdatesInvoke.reloadReleases, () => updates.refreshReleases())
  handle(UpdatesInvoke.moreReleases, () => updates.moreReleases())
  handle(UpdatesInvoke.reference, (_e, number: unknown) => {
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 1) throw new Error('Ungültiger Parameter: number')
    return updates.reference(number)
  })
  updates.on('changed', (state) => broadcast(UpdatesEvent.changed, state))
  updates.on('show', () => broadcast(UpdatesEvent.show))
  updates.on('releases', (notes) => broadcast(UpdatesEvent.releases, notes))
}
