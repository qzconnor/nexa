/** The window that asks: its contents' id, and the end of the window. */
export interface WindowSender {
  readonly id: number
  once(event: 'destroyed', listener: () => void): unknown
}

/**
 * What each window asks for, joined. A service that takes one whole list (what to watch) gets what
 * all windows ask for together, so the list of a chat's own window doesn't end the main window's; a
 * window that goes takes its part along. Another device (Remote Control) asks as a window of its own
 * (`remoteSender`).
 */
export function perWindow<T, R>(apply: (all: T[]) => R): (sender: WindowSender, list: readonly T[]) => R {
  const lists = new Map<number, readonly T[]>()
  const joined = () => apply([...lists.values()].flat())
  return (sender, list) => {
    if (!lists.has(sender.id)) {
      sender.once('destroyed', () => {
        lists.delete(sender.id)
        void Promise.resolve()
          .then(joined)
          .catch((error) => console.warn('[windows] watch not updated', error))
      })
    }
    lists.set(sender.id, list)
    return joined()
  }
}

/** Stand-ins for other devices, by instance; their ids are negative, apart from the windows' contents. */
const remoteSenders = new Map<string, { sender: WindowSender; ends: (() => void)[] }>()
let nextRemoteId = -1

/**
 * Another device as the window that asks: what it watches is kept apart from this device's windows
 * and goes once it stops watching this device (`endRemoteSender`), as a window's goes with the window.
 */
export function remoteSender(device: string): WindowSender {
  let entry = remoteSenders.get(device)
  if (!entry) {
    const ends: (() => void)[] = []
    entry = { sender: { id: nextRemoteId--, once: (_event, listener) => ends.push(listener) }, ends }
    remoteSenders.set(device, entry)
  }
  return entry.sender
}

/** The device stopped watching (it asked, went, or may no longer read): what it watched goes. */
export function endRemoteSender(device: string): void {
  const entry = remoteSenders.get(device)
  if (!entry) return
  remoteSenders.delete(device)
  for (const end of entry.ends) end()
}
