import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { isMenuKey, listMove, openMenuBelow } from '@/lib/list-keys'

/** A row the arrows reach: a chat, the heading of a separator, project or folder, „… weitere“. */
const ROW = '[data-list-row]'
/** What a heading opens and closes: its rows lie inside. */
const GROUP = '[data-list-group]'

/** The rows one can see and focus, top to bottom (a closed group's are gone). */
function rowsIn(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(ROW)].filter((row) => !(row as HTMLButtonElement).disabled && row.getClientRects().length > 0)
}

/** The heading of the group a row lies in; for a heading, the one of the group around its own. */
function parentRow(row: HTMLElement): HTMLElement | null {
  let group = row.closest<HTMLElement>(GROUP)
  if (group && group.querySelector(ROW) === row) group = group.parentElement?.closest<HTMLElement>(GROUP) ?? null
  return group?.querySelector<HTMLElement>(ROW) ?? null
}

/**
 * The keyboard in a tree of rows such as the sidebar's chats: the arrows move it from row to row and
 * open and close groups, Home and End go to the first and the last row (`listMove`). The menu key and
 * Shift+F10 open a row's context menu below it. Tab still reaches every row.
 */
export function useListKeys(list: Ref<HTMLElement | null>): void {
  useEventListener(list, 'keydown', (event: KeyboardEvent) => {
    const el = list.value
    const target = event.target
    if (!el || !(target instanceof HTMLElement) || !target.matches(ROW)) return
    if (isMenuKey(event)) {
      event.preventDefault()
      openMenuBelow(target)
      return
    }
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    const rows = rowsIn(el)
    const expanded = target.getAttribute('aria-expanded')
    const parent = parentRow(target)
    const move = listMove(event.key, {
      index: rows.indexOf(target),
      count: rows.length,
      expanded: expanded === null ? null : expanded === 'true',
      parent: parent ? rows.indexOf(parent) : -1,
    })
    if (!move) return
    event.preventDefault()
    if ('toggle' in move) target.click()
    else rows[move.to]!.focus()
  })
}
