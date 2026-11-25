/** The window that asks: its contents' id, and the end of the window. */
export interface WindowSender {
  readonly id: number
  once(event: 'destroyed', listener: () => void): unknown
}

/**
 * What each window asks for, joined. A service that takes one whole list (what to watch) gets what
 * all windows ask for together, so the list of a chat's own window doesn't end the main window's; a
 * window that goes takes its part along.
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
