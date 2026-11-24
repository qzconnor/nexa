import { StartCommandsEvent, StartCommandsInvoke } from '@shared/start-commands'
import { broadcast, handle } from '../ipc'
import type { StartCommands } from './start-commands'

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${what} fehlt.`)
  return value
}

/**
 * The window's side of the start commands. The window names them by project and id only: what runs,
 * and where, comes from Nexa's own list of projects.
 */
export function registerStartCommandsIpc(startCommands: StartCommands): void {
  handle(StartCommandsInvoke.runs, () => startCommands.runs())
  handle(StartCommandsInvoke.save, (_e, projectId: unknown, commands: unknown) => startCommands.save(str(projectId, 'Das Projekt'), commands))
  handle(StartCommandsInvoke.start, (_e, projectId: unknown, id: unknown) => startCommands.start(str(projectId, 'Das Projekt'), str(id, 'Der Startbefehl')))
  handle(StartCommandsInvoke.stop, (_e, projectId: unknown, id: unknown) => startCommands.stop(str(projectId, 'Das Projekt'), str(id, 'Der Startbefehl')))
  handle(StartCommandsInvoke.restart, (_e, projectId: unknown, id: unknown) =>
    startCommands.restart(str(projectId, 'Das Projekt'), str(id, 'Der Startbefehl')),
  )
  handle(StartCommandsInvoke.output, (_e, projectId: unknown, id: unknown) => startCommands.output(str(projectId, 'Das Projekt'), str(id, 'Der Startbefehl')))
  handle(StartCommandsInvoke.chatOpened, (_e, projectId: unknown) => startCommands.chatOpened(str(projectId, 'Das Projekt')))
  startCommands.on('changed', (runs) => broadcast(StartCommandsEvent.changed, runs))
}
