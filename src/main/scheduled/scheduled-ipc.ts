import { ScheduledEvent, ScheduledInvoke } from '@shared/scheduled-tasks'
import { broadcast, handle } from '../ipc'
import type { ScheduledTasks } from './scheduled-tasks'

function str(value: unknown, what: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${what} fehlt.`)
  return value
}

/** The window's side of the page „Geplant“. What a task may name is checked in ScheduledTasks. */
export function registerScheduledIpc(tasks: ScheduledTasks): void {
  handle(ScheduledInvoke.list, () => tasks.list())
  handle(ScheduledInvoke.save, (_e, input: unknown, id: unknown) => tasks.save(input, typeof id === 'string' && id ? id : undefined))
  handle(ScheduledInvoke.remove, (_e, id: unknown) => tasks.remove(str(id, 'Die Aufgabe')))
  handle(ScheduledInvoke.setEnabled, (_e, id: unknown, enabled: unknown) => tasks.setEnabled(str(id, 'Die Aufgabe'), enabled === true))
  handle(ScheduledInvoke.runNow, (_e, id: unknown) => tasks.runNow(str(id, 'Die Aufgabe')))
  tasks.on('changed', (list) => broadcast(ScheduledEvent.changed, list))
}
